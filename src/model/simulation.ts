import type {Project,Scenario,Resources,SimulationResult,ScenarioResult,PointResult,Profile,Layout,HeatComponents,FilmLedger,PointSample} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {world,insideBox,windAt,sprayDirections,rayAtHeight,blocked,captureFraction} from './geometry.js';
import {onTotalSeconds,isOn,mistAir,heatTerms,filmStep,saturationPressure} from './physics.js';
import {roofTimeline,roofArea} from './roof.js';
import {milkReference,fertilityReference} from './references.js';

export function resources(s:Scenario,p?:Project):Resources {
  const fanKwhPerDay=s.fans.reduce((sum,f)=>sum+(f.enabled?f.powerKw*f.hoursPerDay:0),0);
  const systems:Resources['systems']=s.waterSystems.map(w=>{
    const flow=w.nozzles.reduce((sum,n)=>sum+(n.enabled?n.flowLpm:0),0),onTotalSec=w.enabled&&flow>0?onTotalSeconds(w.hoursPerDay,w.onSec,w.offSec):0;
    return {kind:w.kind,waterL:flow*onTotalSec/60,pumpKwh:w.pumpPowerKw*onTotalSec/3600,onTotalSec};
  });
  if(p){const r=s.roof,onTotalSec=r.sprayEnabled&&r.flowLpmM2>0?onTotalSeconds(r.hoursPerDay,r.onSec,r.offSec):0;systems.push({kind:'roof',waterL:roofArea(p)*r.flowLpmM2*onTotalSec/60,pumpKwh:r.pumpPowerKw*onTotalSec/3600,onTotalSec})}
  const waterLPerDay=systems.reduce((a,w)=>a+w.waterL,0),pumpKwhPerDay=systems.reduce((a,w)=>a+w.pumpKwh,0);
  return {fanKwhPerDay,pumpKwhPerDay,waterLPerDay,totalKwhPerDay:fanKwhPerDay+pumpKwhPerDay,systems};
}
export function trialResources(s:Scenario,p:Project){
  const clone=structuredClone(s);clone.fans.forEach(f=>f.hoursPerDay=Math.min(1,f.hoursPerDay));clone.waterSystems.forEach(w=>w.hoursPerDay=Math.min(1,w.hoursPerDay));clone.roof.hoursPerDay=Math.min(1,clone.roof.hoursPerDay);
  const r=resources(clone,p);return {trialWaterL:r.waterLPerDay,trialKwh:r.totalKwhPerDay};
}
export function stableStringify(v:unknown):string {
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(stableStringify).join(',')+']';
  return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableStringify((v as Record<string,unknown>)[k])).join(',')+'}';
}
const deviceInput=(d:any)=>Object.fromEntries(Object.entries(d).filter(([k])=>!['label','anchor'].includes(k)));
export const scenarioInput=(s:Scenario)=>({roof:s.roof,fans:s.fans.map(deviceInput),waterSystems:s.waterSystems.map(w=>({...w,nozzles:w.nozzles.map(deviceInput)}))});
export function inputHash(p:Project){
  const input=stableStringify({schema:p.schemaVersion,template:p.template,environment:p.environment,model:p.model,references:p.references,baselineScenarioId:p.baselineScenarioId,scenarios:p.scenarios.map(s=>({id:s.id,...scenarioInput(s)}))});let h=0xcbf29ce484222325n;
  for(let i=0;i<input.length;i++){h^=BigInt(input.charCodeAt(i));h=BigInt.asUintN(64,h*0x100000001b3n)}return h.toString(16).padStart(16,'0');
}
function mistDistribution(p:Project,s:Scenario,layout:Layout,rays:number){
  const water=new Map<string,number>(),mist=s.waterSystems.find(w=>w.kind==='mist')!;
  if(mist.enabled)for(const n of mist.nozzles){
    if(!n.enabled||n.flowLpm<=0)continue;const origin=world(n);
    for(const ray of sprayDirections(n,rays)){
      const pt=rayAtHeight(origin,ray,1.5);
      if(!pt||pt[0]<0||pt[2]<0||pt[0]>=p.template.lengthM||pt[2]>=p.template.widthM||blocked(origin,pt,layout.solids))continue;
      const id=`cell-${Math.floor(pt[0]/2)}-${Math.floor(pt[2]/2)}`;water.set(id,(water.get(id)??0)+n.flowLpm/60/rays);
    }
  }
  return water;
}
/** Geometry and film physics are v0.4 reuse; this orchestrator connects v0.5/6/7. */
function runScenario(p:Project,s:Scenario,layout:Layout,profile:Profile,dt:number,rays:number,hash:string,roof:ReturnType<typeof roofTimeline>):ScenarioResult {
  const e=p.environment,m=p.model,soaker=s.waterSystems.find(w=>w.kind==='soaker')!,mist=s.waterSystems.find(w=>w.kind==='mist')!;
  const invalidDevices=[...s.fans.filter(f=>f.enabled&&f.hoursPerDay>0),...s.waterSystems.filter(w=>w.enabled&&w.hoursPerDay>0&&w.onSec>0).flatMap(w=>w.nozzles.filter(n=>n.enabled&&n.flowLpm>0))].filter(d=>layout.solids.some(box=>insideBox(world(d),box)));
  const warnings:string[]=[];
  if(soaker.enabled)warnings.push('牛体散水の水蒸気は、牛舎全体の湿度へ戻さない仮定です。');
  if(invalidDevices.length)warnings.push('稼働設備が管理室内にあります。移動するまで地点の計算は無効です。');
  if(soaker.enabled&&soaker.nozzles.some(n=>n.enabled&&n.y<4))warnings.push('飼料帯への散水配置があります。');
  const mistWater=mistDistribution(p,s,layout,rays),pv=e.relativeHumidityPct/100*saturationPressure(e.temperatureC);
  const n=roof.states.length;
  // Share air states across points in the same cell. Exact numeric keys; no model rounding.
  const airCache=new Map<string,ReturnType<typeof mistAir>>();
  const points=layout.probes.map((q):PointResult=>{
    const cellId=`cell-${Math.min(Math.floor(q.x/2),Math.ceil(p.template.lengthM/2)-1)}-${Math.min(Math.floor(q.y/2),Math.ceil(p.template.widthM/2)-1)}`;
    const blank:PointResult={probeId:q.id,inputHash:hash,modelVersion:m.version,meanSpeedMps:null,meanAirTemperatureC:null,meanRelativeHumidityPct:null,meanQrefW:null,deltaQrefW:null,components:null,parameterEnvelopeW:null,profileDeltas:{},status:'invalid',warnings:[],cellId,captureFraction:0,film:null,meanRadiantC:null,meanFeelsLikeC:null,milk:{status:'out_of_scope',ratioPct:null,kgPerDay:null,reasons:['地点の計算が無効です']},fertility:fertilityReference(p.references.fertility,null,null),series:[]};
    if(invalidDevices.length){blank.warnings.push('管理室内の設備を移動してください');return blank}
    let capturedFlow=0,maxFraction=0;
    if(soaker.enabled)for(const nozzle of soaker.nozzles){if(!nozzle.enabled||nozzle.flowLpm<=0)continue;const f=captureFraction(nozzle,q,m,layout.solids,rays);capturedFlow+=nozzle.flowLpm/60*f;maxFraction=Math.max(maxFraction,f)}
    const cell=layout.cells.find(c=>c.id===cellId)!;
    const windCache=new Map<string,ReturnType<typeof windAt>>(),termsCache=new Map<string,ReturnType<typeof heatTerms>>();
    const comp:HeatComponents={convectionW:0,radiationW:0,baseEvaporationW:0,soakerEvaporationW:0,condensationW:0};
    const filmLedger:FilmLedger={capturedKg:0,condensedKg:0,evaporatedKg:0,runoffKg:0,finalKg:0,maxResidualKg:0};
    let mass=0,speedSum=0,tempSum=0,rhSum=0,feelSum=0;
    let firstT=0,firstRH=0,firstSpeed=0,staticInputs=true;
    const series:PointSample[]=[];
    for(let i=0;i<n;i++){
      const t=i*dt,st=roof.states[i],soakerOn=soaker.enabled&&isOn(t,soaker.onSec,soaker.offSec,soaker.hoursPerDay),mistOn=mist.enabled&&isOn(t,mist.onSec,mist.offSec,mist.hoursPerDay);
      const windKey=s.fans.map(f=>+(f.enabled&&t<f.hoursPerDay*3600)).join('');
      let wind=windCache.get(windKey);if(!wind){wind=windAt(s.fans,world(q),e,m,profile,layout.solids,t);windCache.set(windKey,wind)}
      if(wind.interference&&!blank.warnings.length)blank.warnings.push('対向噴流の干渉は未解析です');
      const flow=mistOn?(mistWater.get(cellId)??0):0,airKey=`${cellId}:${st.airC}:${flow}`;
      let air=airCache.get(airKey);
      if(!air){const rh=100*pv/saturationPressure(st.airC);air=mistAir(st.airC,rh,e.pressurePa,cell.areaM2*e.ventilationM3sPerM2,flow,profile.mistEfficiency);airCache.set(airKey,air)}
      const ta=air.temperatureC,rh=air.rhPct,speed=wind.speed;
      const termsKey=`${ta}:${rh}:${speed}:${st.radiantC}`;let terms=termsCache.get(termsKey);
      if(!terms){terms=heatTerms(ta,rh,speed,st.radiantC,m,profile);termsCache.set(termsKey,terms)}
      const film=filmStep(mass,soakerOn?capturedFlow:0,terms,m,profile,dt);mass=film.mass;
      filmLedger.capturedKg+=film.capturedKg;filmLedger.condensedKg+=film.condensedKg;filmLedger.evaporatedKg+=film.evaporatedKg;filmLedger.runoffKg+=film.runoffKg;filmLedger.maxResidualKg=Math.max(filmLedger.maxResidualKg,Math.abs(film.residualKg));
      comp.convectionW+=terms.components.convectionW*dt;comp.radiationW+=terms.components.radiationW*dt;comp.baseEvaporationW+=terms.components.baseEvaporationW*dt;comp.condensationW+=terms.components.condensationW*dt;comp.soakerEvaporationW+=film.evaporatedKg*m.latentHeatJkg;
      speedSum+=speed*dt;tempSum+=ta*dt;rhSum+=rh*dt;feelSum+=(ta-6*Math.sqrt(speed))*dt;
      if(i===0){firstT=ta;firstRH=rh;firstSpeed=speed}else if(Math.abs(ta-firstT)>1e-9||Math.abs(rh-firstRH)>1e-9||Math.abs(speed-firstSpeed)>1e-9)staticInputs=false;
      if(profile.id==='reference'&&(i===0||(i+1)*dt%60===0))series.push({timeSec:(i+1)*dt,temperatureC:ta,relativeHumidityPct:rh,speedMps:speed,filmKg:mass,qW:terms.components.convectionW+terms.components.radiationW+terms.components.baseEvaporationW+terms.components.condensationW+film.heatW,deltaW:null,soakerOn,mistOn});
    }
    for(const key of Object.keys(comp) as (keyof HeatComponents)[])comp[key]/=3600;
    filmLedger.finalKg=mass;
    return {...blank,status:'valid',meanSpeedMps:speedSum/3600,meanAirTemperatureC:tempSum/3600,meanRelativeHumidityPct:rhSum/3600,meanQrefW:Object.values(comp).reduce((a,b)=>a+b,0),meanRadiantC:roof.result.meanRadiantC,meanFeelsLikeC:feelSum/3600,components:comp,film:filmLedger,captureFraction:maxFraction,series,milk:milkReference(firstT,firstRH,firstSpeed,p.references.baselineMilkKgPerDay,staticInputs),fertility:fertilityReference(p.references.fertility,tempSum/3600,rhSum/3600)};
  });
  return {id:s.id,points,resources:resources(s,p),warnings,roof:roof.result,...trialResources(s,p)};
}
export function simulate(p:Project,opts:{dt?:number;rays?:number;envelope?:boolean}={}):SimulationResult{
  const dt=opts.dt??1,rays=opts.rays??256;if(dt!==1&&dt!==.5)throw Error('時間刻みは1秒または0.5秒です');if(![256,1024].includes(rays))throw Error('積分レイ数は256または1024です');
  const hash=inputHash(p),layout=buildLayout(p.template),profiles=opts.envelope===false?p.model.profiles.filter(x=>x.id==='reference'):[...p.model.profiles].sort((a,b)=>a.id==='reference'?-1:b.id==='reference'?1:0);
  const roofCache=new Map<string,ReturnType<typeof roofTimeline>>(),cache=new Map<string,ScenarioResult>(),all=new Map<string,ScenarioResult[]>();
  for(const profile of profiles){
    const results=p.scenarios.map(s=>{
      const key=profile.id+stableStringify(scenarioInput(s));let result=cache.get(key);
      if(!result){const rk=stableStringify(s.roof);let roof=roofCache.get(rk);if(!roof){roof=roofTimeline(p,s,dt);roofCache.set(rk,roof)}result=runScenario(p,s,layout,profile,dt,rays,hash,roof);cache.set(key,result)}
      return {...result,id:s.id,points:result.points.map(q=>({...q,profileDeltas:{},series:q.series.map(st=>({...st}))}))};
    });
    const base=results.find(s=>s.id===p.baselineScenarioId)!;
    for(const s of results)for(let i=0;i<s.points.length;i++){
      const q=s.points[i],b=base.points[i];q.deltaQrefW=q.meanQrefW!==null&&b.meanQrefW!==null?q.meanQrefW-b.meanQrefW:null;
      q.series.forEach((st,j)=>st.deltaW=b.series[j]?st.qW-b.series[j].qW:null);
    }
    all.set(profile.id,results);
  }
  const reference=all.get('reference')!;
  for(const s of reference)for(let i=0;i<s.points.length;i++){
    const q=s.points[i],deltas:Record<string,number>={};
    for(const profile of profiles){const d=all.get(profile.id)!.find(x=>x.id===s.id)!.points[i].deltaQrefW;if(d!==null)deltas[profile.id]=d}
    q.profileDeltas=deltas;const vals=Object.values(deltas);if(vals.length===3)q.parameterEnvelopeW=[Math.min(...vals),Math.max(...vals)];
    if(q.parameterEnvelopeW&&q.parameterEnvelopeW[0]<0&&q.parameterEnvelopeW[1]>0)q.warnings.push('仮定を変えると増減が逆転');
  }
  return {inputHash:hash,modelVersion:p.model.version,scenarios:reference,profiles:profiles.map(x=>x.id),timeStepSec:dt,rayCount:rays,durationSec:3600};
}
