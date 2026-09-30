import type {Project,Scenario,Layout,Probe,DailyMilkResult,DailyThermalResult,DailyThermalPoint,DailyThermalArea,Environment,Resources,Profile,MilkSimulation,SimulationResult} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {buildAreas} from '../template/faces.js';
import type {AreaGroup} from '../template/faces.js';
import {world,insideBox,windAt,captureFraction} from './geometry.js';
import {mistAir,heatTerms,filmStep,saturationPressure} from './physics.js';
import {solveRoof,roofArea} from './roof.js';
import {mistDistribution,scenarioInput,stableStringify} from './simulation.js';
import {fanOn,waterOn,roofSprayOn,secondsToNextToggle,DAY_SEC} from './dailySchedule.js';
import {envAt,weatherIndexAt,secondsToWeatherBoundary} from './dailyWeather.js';
import {occupancyWeights,deficitW,dailyFromDeficit,sensitivityYields,deltaYield,validateMilkSettings} from './milk.js';

export interface DailySimulationOutput {status:'complete'|'error';error?:string;daily:Record<string,DailyMilkResult>;thermal:Record<string,DailyThermalResult>;probeQ:Record<string,Map<string,number>>;probeQSeries:Record<string,Map<string,Float64Array>>;states:Record<string,DailyState>}
/** Water/film state that crosses the day boundary. Roof mass is per m2; film per probe (layout order). */
export interface DailyState {roofMassKgM2:number;filmKg:number[]}
type MistAir={temperatureC:number;rhPct:number;evaporatedKgs:number};
interface ProbeRun {probe:Probe;weight:number;cellId:string;cellAreaM2:number;capturedKgs:number;mass:number;memoSeq:number;baseQ:number;condensing:boolean;lastTerms:ReturnType<typeof heatTerms>|null;lastWind:ReturnType<typeof windAt>|null;lastAir:MistAir|null;windMemo:Map<string,ReturnType<typeof windAt>>;evalFilmStartKg:number;capturedKg:number;condensedKg:number;evaporatedKg:number;runoffKg:number;sumQWs:number;qSeries:Float64Array|null;
 /** Evaluation-day per-point aggregates (W·s / s); converted to means after the loop. */
 defWs:number;spdWs:number;tmpWs:number;rhWs:number;convWs:number;radWs:number;evapWs:number;condWs:number;soakEvapWs:number;fanS:number;soakS:number;mistSupS:number;mistEvapS:number}

const blankDaily=(ms:MilkSimulation,status:DailyMilkResult['status'],reasons:string[]):DailyMilkResult=>({
  status,reasons,modelId:ms.modelId,mode:ms.mode,weatherMode:ms.weatherMode,operationPolicy:ms.operationPolicy,
  warmupDurationSec:ms.warmupDurationSec,evaluationDurationSec:ms.evaluationDurationSec,timeStepSec:ms.timeStepSec,
  potentialMilkKgPerCowDay:ms.potentialMilkKgPerCowDay,referenceCoolingWPerCow:ms.referenceCoolingWPerCow,
  responseKgPerCowDayPerW:ms.responseKgPerCowDayPerW,maxLossFraction:ms.maxLossFraction,
  lagWeights:[...ms.lagWeights],occupancyFractions:{...ms.occupancyFractions},zoneCounts:{stall:0,feeding:0,waiting:0},
  dailyDeficitWPerCow:null,laggedDeficitWPerCow:null,lossKgPerCowDay:null,yieldKgPerCowDay:null,deltaKgPerCowDay:null,
  lossCapped:false,sensitivities:ms.responseSensitivityKgPerCowDayPerW.map(beta=>({beta,yieldKgPerCowDay:null,deltaKgPerCowDay:null,lossCapped:false})),
  resources:null,waterCheck:null});

/** Daily resources integrated from the same operation masks the thermal loop uses. */
export function dailyResources(p:Project,s:Scenario):Resources{
  const evalStart=DAY_SEC;
  const systems:{kind:string;waterL:number;pumpKwh:number;onTotalSec:number}[]=s.waterSystems.map(w=>{
    const flow=w.nozzles.reduce((a,n)=>a+(n.enabled?n.flowLpm:0),0);let waterL=0,pumpKwh=0,onTotalSec=0;
    for(let t=evalStart;t<evalStart+DAY_SEC;t++)if(waterOn(t,w)&&flow>0){waterL+=flow/60;pumpKwh+=w.pumpPowerKw/3600;onTotalSec++}
    return {kind:w.kind,waterL,pumpKwh,onTotalSec};
  });
  const r=s.roof;let roofWaterL=0,roofPumpKwh=0,roofOnSec=0;
  for(let t=evalStart;t<evalStart+DAY_SEC;t++)if(roofSprayOn(t,r)&&r.flowLpmM2>0){roofWaterL+=roofArea(p)*r.flowLpmM2/60;roofPumpKwh+=r.pumpPowerKw/3600;roofOnSec++}
  systems.push({kind:'roof',waterL:roofWaterL,pumpKwh:roofPumpKwh,onTotalSec:roofOnSec});
  let fanKwhPerDay=0;
  for(let t=evalStart;t<evalStart+DAY_SEC;t++)for(const f of s.fans)if(fanOn(t,f))fanKwhPerDay+=f.powerKw/3600;
  const waterLPerDay=systems.reduce((a,w)=>a+w.waterL,0),pumpKwhPerDay=systems.reduce((a,w)=>a+w.pumpKwh,0);
  return {waterLPerDay,fanKwhPerDay,pumpKwhPerDay,totalKwhPerDay:fanKwhPerDay+pumpKwhPerDay,systems};
}

/**
 * Representative-day thermal state evolution for the milk hypothesis model.
 * t in [0, warmup+eval): constant environment repeated; state (roof water, film mass,
 * cycle phase) carries across the day boundary. Only the reference profile is used.
 * Seconds where masks and roof state cannot change are processed as one stretch.
 */
function dailyAreaStats(points:DailyThermalPoint[],area:Pick<AreaGroup,'id'|'label'|'probeIds'>):DailyThermalArea{
 const members=area.probeIds.map(id=>points.find(q=>q.probeId===id)).filter((q):q is DailyThermalPoint=>!!q);
 const allValid=members.length===area.probeIds.length&&members.length>0;
 return{id:area.id,label:area.label,probeCount:area.probeIds.length,validCount:members.length,
  meanDeficitW:allValid?members.reduce((a,q)=>a+q.meanDeficitW,0)/members.length:null,
  maxDeficitW:members.length?Math.max(...members.map(q=>q.meanDeficitW)):null,
  topDeficit:[...members].sort((a,b)=>b.meanDeficitW-a.meanDeficitW||a.probeId.localeCompare(b.probeId)).filter(q=>q.meanDeficitW>1e-6).slice(0,3).map(q=>({probeId:q.probeId,value:q.meanDeficitW}))};
}
function blankThermal(p:Project,ms:MilkSimulation,status:DailyThermalResult['status'],reasons:string[],resources:Resources|null):DailyThermalResult{
 return{status,reasons,evaluationDurationSec:ms.evaluationDurationSec,weatherMode:p.dailyWeather.mode,modelVersion:p.model.version,points:[],areas:[],all:null,resources};
}
function runDaily(p:Project,s:Scenario,layout:Layout,profile:Profile,rays:number,zw:ReturnType<typeof occupancyWeights>,ms:MilkSimulation,opts:{warmupSec?:number;evalSec?:number;collectQ?:boolean;collectQSeries?:boolean;initialState?:DailyState;returnState?:boolean}):DailyMilkResult&{probeQ?:Map<string,number>;probeQSeries?:Map<string,Float64Array>;stateAtWarmupEnd?:DailyState;thermal?:DailyThermalResult}{
  const e=p.environment,m=p.model,soaker=s.waterSystems.find(w=>w.kind==='soaker')!,mist=s.waterSystems.find(w=>w.kind==='mist')!;
  const invalidDevices=[...s.fans.filter(f=>f.enabled&&f.hoursPerDay>0),...s.waterSystems.filter(w=>w.enabled&&w.hoursPerDay>0&&w.onSec>0).flatMap(w=>w.nozzles.filter(n=>n.enabled&&n.flowLpm>0))].filter(d=>layout.solids.some(box=>insideBox(world(d),box)));
  const reasons:string[]=[];
  if(invalidDevices.length)reasons.push('稼働設備が管理室内にあります。移動するまで日乳量は計算できません。');
  const weights='error' in zw?null:zw.weights;
  if('error' in zw)reasons.push(zw.error);
  const resources=dailyResources(p,s);
  const counts='error' in zw?{stall:0,feeding:0,waiting:0}:zw.counts;
  if(reasons.length)return {...blankDaily(ms,'invalid_input',reasons),resources,zoneCounts:counts,thermal:blankThermal(p,ms,'invalid_input',reasons,resources)};

  const warmup=opts.warmupSec??ms.warmupDurationSec,evalLen=opts.evalSec??ms.evaluationDurationSec,total=warmup+evalLen;
  const mistWater=mistDistribution(p,s,layout,rays);
  const cap=m.roof.waterCapacityKgM2,area=roofArea(p);
  // Hourly weather refreshes env/pv/dryRoof at each clock-hour boundary.
  const hourly=p.dailyWeather.mode==='hourly';
  let wIdx=-2,env:Environment=e,pv=e.relativeHumidityPct/100*saturationPressure(e.temperatureC),dryRoof=solveRoof(p,s,0,1);
  // Static per-probe capture rate (kg/s while the soaker system is ON).
  const probes:ProbeRun[]=layout.probes.map(q=>{
    let capturedKgs=0;
    for(const n of soaker.nozzles)if(n.enabled&&n.flowLpm>0)capturedKgs+=n.flowLpm/60*captureFraction(n,q,m,layout.solids,rays);
    const cellId=`cell-${Math.min(Math.floor(q.x/2),Math.ceil(p.template.lengthM/2)-1)}-${Math.min(Math.floor(q.y/2),Math.ceil(p.template.widthM/2)-1)}`;
    const cell=layout.cells.find(c=>c.id===cellId)!;
    return {probe:q,weight:weights!.get(q.id)!,cellId,cellAreaM2:cell.areaM2,capturedKgs,mass:0,memoSeq:-1,baseQ:0,condensing:false,lastTerms:null,lastWind:null,lastAir:null,windMemo:new Map(),evalFilmStartKg:0,capturedKg:0,condensedKg:0,evaporatedKg:0,runoffKg:0,sumQWs:0,qSeries:opts.collectQSeries?new Float64Array(evalLen):null,defWs:0,spdWs:0,tmpWs:0,rhWs:0,convWs:0,radWs:0,evapWs:0,condWs:0,soakEvapWs:0,fanS:0,soakS:0,mistSupS:0,mistEvapS:0};
  });
  let roofMass=0,prevAvail=-1,roofState=dryRoof,prevRoofState:typeof dryRoof|null=null;
  if(opts.initialState){roofMass=opts.initialState.roofMassKgM2;opts.initialState.filmKg.forEach((m,i)=>{if(probes[i])probes[i].mass=m})}
  // The evaluation day starts at t=warmup; when warmup is skipped its start state is the injected one.
  let roofEvalStartKg=warmup===0?roofMass*area:0,roofSuppliedKg=0,roofEvaporatedKg=0,roofRunoffKg=0;
  if(warmup===0)for(const pr of probes)pr.evalFilmStartKg=pr.mass;
  let warmupState:DailyState|undefined=warmup===0?{roofMassKgM2:roofMass,filmKg:probes.map(pr=>pr.mass)}:undefined;
  let deficitSum=0,seq=0,prevMaskKey='';
  let t=0;
  while(t<total){
    const evalMode=t>=warmup;
    // Hourly weather boundary: refresh environment, vapor pressure and the dry-roof
    // solve; cached roof/heat-term results from the previous hour are invalid.
    const wi=weatherIndexAt(p,t);
    if(wi!==wIdx){wIdx=wi;env=envAt(p,t);pv=env.relativeHumidityPct/100*saturationPressure(env.temperatureC);dryRoof=solveRoof(p,s,0,1,env);prevAvail=-1}
    // Masks at t
    const fanMask=s.fans.map(f=>fanOn(t,f)),fanKey=fanMask.map(b=>b?1:0).join('');
    const soakerOn=waterOn(t,soaker),mistOn=waterOn(t,mist),roofFlow=roofSprayOn(t,s.roof)&&s.roof.flowLpmM2>0?s.roof.flowLpmM2/60:0;
    const maskKey=fanKey+'|'+(soakerOn?1:0)+(mistOn?1:0)+'|'+wi;
    // Roof water and state for this second
    let spill=0;
    if(roofMass>0||roofFlow>0){
      const received=roofMass+roofFlow;spill=Math.max(0,received-cap);const avail=Math.min(cap,received);
      roofState=avail===prevAvail?roofState:solveRoof(p,s,avail,1,env);prevAvail=avail;
      roofMass=Math.max(0,avail-roofState.evaporatedKgsM2);
      if(evalMode){roofSuppliedKg+=roofFlow*area;roofEvaporatedKg+=roofState.evaporatedKgsM2*area;roofRunoffKg+=spill*area}
    }else {roofState=dryRoof;prevAvail=0}
    // Stretch length: masks constant until the next toggle; roof evolves only while wet/supplied.
    let dur=total-t;
    for(const f of s.fans)if(f.enabled&&f.hoursPerDay>0)dur=Math.min(dur,secondsToNextToggle(t,{...f,onSec:0,offSec:0},false));
    for(const w of s.waterSystems)if(w.enabled&&w.hoursPerDay>0)dur=Math.min(dur,secondsToNextToggle(t,w,true));
    if(s.roof.sprayEnabled&&s.roof.hoursPerDay>0)dur=Math.min(dur,secondsToNextToggle(t,{...s.roof,enabled:s.roof.sprayEnabled},true));
    if(hourly)dur=Math.min(dur,secondsToWeatherBoundary(t));
    if(roofMass>0||roofFlow>0)dur=1;
    if(t<warmup&&t+dur>warmup)dur=warmup-t;
    if(maskKey!==prevMaskKey||roofState!==prevRoofState){seq++;prevMaskKey=maskKey;prevRoofState=roofState}
    const st=roofState;
    const maskedFans=s.fans.map((f,i)=>({...f,enabled:fanMask[i]}));
    // Air per cell only when mist supplies water this stretch; otherwise air follows the roof state.
    const mistAirMemo=new Map<string,MistAir>();
    const airAt=(cellId:string):MistAir=>{
      const flow=mistOn?(mistWater.get(cellId)??0):0;
      const rh=100*pv/saturationPressure(st.airC);
      if(flow<=0)return {temperatureC:st.airC,rhPct:rh,evaporatedKgs:0};
      let a=mistAirMemo.get(cellId);
      if(!a){const cell=layout.cells.find(c=>c.id===cellId)!;const res=mistAir(st.airC,rh,env.pressurePa,cell.areaM2*env.ventilationM3sPerM2,flow,profile.mistEfficiency);a={temperatureC:res.temperatureC,rhPct:res.rhPct,evaporatedKgs:res.evaporatedKgs};mistAirMemo.set(cellId,a)}
      return a;
    };
    const evalOverlap=Math.max(0,Math.min(t+dur,total)-Math.max(t,warmup));
    for(const pr of probes){
      const captured=soakerOn?pr.capturedKgs:0;
      if(pr.memoSeq!==seq){
        let wind=pr.windMemo.get(fanKey);
        if(!wind){wind=windAt(maskedFans,world(pr.probe),env,m,profile,layout.solids,0);pr.windMemo.set(fanKey,wind)}
        const air=airAt(pr.cellId);
        const terms=heatTerms(air.temperatureC,air.rhPct,wind.speed,st.radiantC,m,profile);
        pr.memoSeq=seq;pr.baseQ=terms.components.convectionW+terms.components.radiationW+terms.components.baseEvaporationW+terms.components.condensationW;
        pr.condensing=terms.condensationKgs>0;pr.lastTerms=terms;pr.lastWind=wind;pr.lastAir=air;
      }
      const wind=pr.lastWind!,air=pr.lastAir!,terms=pr.lastTerms!;
      if(evalOverlap>0){
        // Evaluation-day means for the daily-thermal contract (same definitions as
        // the 60-minute aggregates; integrated once per constant stretch).
        pr.spdWs+=wind.speed*evalOverlap;pr.tmpWs+=air.temperatureC*evalOverlap;pr.rhWs+=air.rhPct*evalOverlap;
        pr.convWs+=terms.components.convectionW*evalOverlap;pr.radWs+=terms.components.radiationW*evalOverlap;
        pr.evapWs+=terms.components.baseEvaporationW*evalOverlap;pr.condWs+=terms.components.condensationW*evalOverlap;
        if(wind.speed-env.backgroundSpeedMps>1e-6)pr.fanS+=evalOverlap;
        if(captured>1e-12)pr.soakS+=evalOverlap;
        if(mistOn&&(mistWater.get(pr.cellId)??0)>0)pr.mistSupS+=evalOverlap;
        if(air.evaporatedKgs>1e-12)pr.mistEvapS+=evalOverlap;
      }
      if(evalMode&&evalOverlap>0&&pr.mass===0&&captured===0&&!pr.condensing){
        deficitSum+=pr.weight*deficitW(pr.baseQ,ms.referenceCoolingWPerCow)*evalOverlap;
        pr.defWs+=deficitW(pr.baseQ,ms.referenceCoolingWPerCow)*evalOverlap;
        pr.sumQWs+=pr.baseQ*evalOverlap;
        if(pr.qSeries)pr.qSeries.fill(pr.baseQ,Math.max(t,warmup)-warmup,Math.min(t+dur,total)-warmup);
      }
      if(pr.mass>0||captured>0||pr.condensing){
        // film evolves each second within this constant stretch
        const from=Math.max(t,warmup),to=t+dur;
        for(let tt=t;tt<to;tt++){
          const f=filmStep(pr.mass,captured,pr.lastTerms!,m,profile,1);
          pr.mass=f.mass;
          if(tt>=from){pr.capturedKg+=f.capturedKg;pr.condensedKg+=f.condensedKg;pr.evaporatedKg+=f.evaporatedKg;pr.runoffKg+=f.runoffKg;const dW=deficitW(pr.baseQ+f.heatW,ms.referenceCoolingWPerCow);deficitSum+=pr.weight*dW;pr.defWs+=dW;pr.soakEvapWs+=f.evaporatedKg*m.latentHeatJkg;pr.sumQWs+=(pr.baseQ+f.heatW);if(pr.qSeries)pr.qSeries[tt-warmup]=pr.baseQ+f.heatW}
        }
      }
    }
    if(t<warmup&&t+dur>=warmup){roofEvalStartKg=roofMass*area;for(const pr of probes)pr.evalFilmStartKg=pr.mass;warmupState={roofMassKgM2:roofMass,filmKg:probes.map(pr=>pr.mass)}}
    t+=dur;
  }
  // Water balance check over the evaluation day: start + inflow - evaporated - runoff - end.
  const roofResidualKg=roofEvalStartKg+roofSuppliedKg-roofEvaporatedKg-roofRunoffKg-roofMass*area;
  const filmResidualKg=probes.reduce((a,pr)=>a+pr.evalFilmStartKg+pr.capturedKg+pr.condensedKg-pr.evaporatedKg-pr.runoffKg-pr.mass,0);
  const filmStartKg=probes.reduce((a,pr)=>a+pr.evalFilmStartKg,0);
  const dailyDeficitWPerCow=deficitSum/evalLen;
  const thermalPoints:DailyThermalPoint[]=probes.map(pr=>({probeId:pr.probe.id,
   meanDeficitW:pr.defWs/evalLen,meanQrefW:pr.sumQWs/evalLen,
   meanSpeedMps:pr.spdWs/evalLen,meanAirTemperatureC:pr.tmpWs/evalLen,meanRelativeHumidityPct:pr.rhWs/evalLen,
   components:{convectionW:pr.convWs/evalLen,radiationW:pr.radWs/evalLen,baseEvaporationW:pr.evapWs/evalLen,soakerEvaporationW:pr.soakEvapWs/evalLen,condensationW:pr.condWs/evalLen},
   fanActionFraction:pr.fanS/evalLen,soakerArrivalFraction:pr.soakS/evalLen,mistEvaporationActionFraction:pr.mistEvapS/evalLen,mistSupplyFraction:pr.mistSupS/evalLen}));
  const thermal:DailyThermalResult={status:'complete',reasons:[],evaluationDurationSec:evalLen,weatherMode:p.dailyWeather.mode,modelVersion:m.version,points:thermalPoints,
   areas:buildAreas(layout).map(a=>dailyAreaStats(thermalPoints,a)),
   all:dailyAreaStats(thermalPoints,{id:'all',label:'全地点',probeIds:layout.probes.map(q=>q.id)}),resources};
  const calc=dailyFromDeficit(dailyDeficitWPerCow,ms);
  const out:DailyMilkResult={
    ...blankDaily(ms,'available',[]),zoneCounts:counts,resources,
    dailyDeficitWPerCow,laggedDeficitWPerCow:calc.laggedDeficitWPerCow,
    lossKgPerCowDay:calc.lossKgPerCowDay,yieldKgPerCowDay:calc.yieldKgPerCowDay,lossCapped:calc.lossCapped,
    sensitivities:sensitivityYields(dailyDeficitWPerCow,ms).map(r=>({beta:r.beta,yieldKgPerCowDay:r.yieldKgPerCowDay,deltaKgPerCowDay:null,lossCapped:r.lossCapped})),
    waterCheck:{roofStartKg:roofEvalStartKg,filmStartKg,roofResidualKg,filmResidualKg}
  };
  const result:DailyMilkResult&{probeQ?:Map<string,number>;probeQSeries?:Map<string,Float64Array>;stateAtWarmupEnd?:DailyState;thermal:DailyThermalResult}={...out,thermal};
  if(opts.collectQ)result.probeQ=new Map(probes.map(pr=>[pr.probe.id,pr.sumQWs/evalLen]));
  if(opts.collectQSeries)result.probeQSeries=new Map(probes.map(pr=>[pr.probe.id,pr.qSeries!]));
  if(opts.returnState)result.stateAtWarmupEnd=warmupState;
  return result;
}

export function simulateDaily(p:Project,opts:{rays?:number;warmupSec?:number;evalSec?:number;collectQ?:boolean;collectQSeries?:boolean;initialState?:DailyState;returnState?:boolean}={}):DailySimulationOutput{
  const ms=p.milkSimulation,layout=buildLayout(p.template),profile=p.model.profiles.find(x=>x.id==='reference')!;
  const settingReasons=validateMilkSettings(ms);
  const zw=settingReasons.length?{error:settingReasons[0]}:occupancyWeights(layout.probes,ms.occupancyFractions);
  const daily:Record<string,DailyMilkResult>={},thermal:Record<string,DailyThermalResult>={},probeQ:Record<string,Map<string,number>>={},probeQSeries:Record<string,Map<string,Float64Array>>={},states:Record<string,DailyState>={};
  interface CacheEntry {result:DailyMilkResult;thermal?:DailyThermalResult;probeQ?:Map<string,number>;probeQSeries?:Map<string,Float64Array>;state?:DailyState}
  const cache=new Map<string,CacheEntry>();
  let status:DailySimulationOutput['status']='complete',error:string|undefined;
  for(const s of p.scenarios){
    // Weather is project-level, so it must be part of the scenario cache key.
    const key=stableStringify({w:p.dailyWeather,...scenarioInput(s)}),cached=cache.get(key);
    if(cached){daily[s.id]=structuredClone(cached.result);if(cached.thermal)thermal[s.id]=cached.thermal;if(cached.probeQ)probeQ[s.id]=cached.probeQ;if(cached.probeQSeries)probeQSeries[s.id]=cached.probeQSeries;if(cached.state)states[s.id]=cached.state;continue}
    try{
      const r=settingReasons.length?{...blankDaily(ms,'invalid_input',settingReasons),resources:dailyResources(p,s),thermal:blankThermal(p,ms,'invalid_input',settingReasons,dailyResources(p,s))}:runDaily(p,s,layout,profile,opts.rays??256,zw,ms,opts);
      const {probeQ:pq,probeQSeries:pqs,stateAtWarmupEnd:st,thermal:th,...clean}=r;
      daily[s.id]=clean;if(th)thermal[s.id]=th;cache.set(key,{result:clean,thermal:th,probeQ:pq,probeQSeries:pqs,state:st});
      if(pq)probeQ[s.id]=pq;if(pqs)probeQSeries[s.id]=pqs;if(st)states[s.id]=st;
    }catch(err){
      status='error';error=err instanceof Error?err.message:String(err);
      daily[s.id]={...blankDaily(ms,'calculation_error',['日乳量の計算に失敗しました']),resources:dailyResources(p,s)};
      thermal[s.id]=blankThermal(p,ms,'calculation_error',['日熱集計に失敗しました'],dailyResources(p,s));
    }
  }
  const base=daily[p.baselineScenarioId];
  for(const s of p.scenarios){
    const r=daily[s.id];
    if(r.status==='available'&&base?.status==='available')r.deltaKgPerCowDay=deltaYield({yieldKgPerCowDay:r.yieldKgPerCowDay!},{yieldKgPerCowDay:base.yieldKgPerCowDay!});
    for(const sen of r.sensitivities){const bb=base?.sensitivities.find(x=>x.beta===sen.beta);sen.deltaKgPerCowDay=sen.yieldKgPerCowDay!=null&&bb?.yieldKgPerCowDay!=null?sen.yieldKgPerCowDay-bb.yieldKgPerCowDay:null}
  }
  return {status,error,daily,thermal,probeQ,probeQSeries,states};
}

/** Merge a daily-stage reply into the matching 60-minute result. Only called when
 * the gate already accepted the message (same jobId+inputHash). */
export function mergeDaily(result:SimulationResult,daily:Record<string,DailyMilkResult>,thermal:Record<string,DailyThermalResult>,status:'complete'|'error'){
  for(const s of result.scenarios){s.dailyMilk=daily[s.id]??null;s.dailyThermal=thermal[s.id]??null}
  result.dailyMilkStatus=status;
}
