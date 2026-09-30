import type {DailyMilkResult,DailyThermalResult,DailyWeather,Device,Layout,PointResult,Project,RoofSettings,SimulationResult,View,WaterSystem} from '../domain/project.js';
import {activeScenario,devices,isFan} from '../domain/project.js';
import {ProjectStore} from '../state/store.js';
import {buildLayout} from '../template/layout.js';
import {areaOfProbe,buildAreas} from '../template/faces.js';
import {comparisonStats} from '../model/comparisonStats.js';
import {inputHash} from '../model/simulation.js';
import {mergeDaily} from '../model/dailySimulation.js';
import {describeModel} from '../model/modelInfo.js';
import {summarizeDay,worsenedCount,checkConstraints,improvesPriorityArea,rankCandidates} from '../model/candidateComparison.js';
import type {CandidateConstraints,RankingMode} from '../model/candidateComparison.js';

/** Runtime UI/worker state owned by main.ts; injected so commands stay testable. */
export interface CommandStatus{pendingInput:boolean;invalidInput:boolean;calculating:boolean;workerError:string|null}
/** One-off simulation of a hypothetical project; `daily` is null when not requested. */
export interface EvalJob{thermal:SimulationResult;daily:Record<string,DailyMilkResult>|null;dailyThermal:Record<string,DailyThermalResult>|null;dailyMilkStatus:'complete'|'error'}
export interface CommandDeps{
 store:ProjectStore;
 /** Latest worker result, already filtered by ResultGate. May still be stale vs committed input. */
 currentResult:()=>SimulationResult|null;
 status:()=>CommandStatus;
 stopPlayback:()=>void;
 /** Runs the same worker simulation on a cloned project. Must not touch live state. */
 evaluate:(project:Project,opts:{daily:boolean})=>Promise<EvalJob>;
}

export type ResultStatus='editing'|'calculating'|'thermal_ready'|'ready'|'error';
export interface EditArgs{operation:string;scenarioId?:string;deviceId?:string;systemId?:string;kind?:string;x?:number;y?:number;patch?:Record<string,unknown>}
export interface EvaluateArgs{operations:EditArgs[];scenarioId?:string;includeDaily?:boolean}
export interface SetViewArgs{mode?:View['mode'];metric?:View['metric'];selectedProbeId?:string;selectedDeviceId?:string|null;selectedAreaId?:string|null;analysis?:boolean;realistic?:boolean;heatmap?:boolean;roof?:boolean;flow?:boolean;particles?:boolean;timeSec?:number}
export interface GetResultsArgs{scenarioId?:string;probeId?:string}
export interface CompareArgs{scenarioId?:string;candidates:{id:string;operations:EditArgs[]}[];constraints?:Partial<CandidateConstraints>;ranking?:RankingMode}

const CONFIRM_INPUT='Confirm the on-screen input first';

/** Short guidance also embedded in the MCP server instructions and tool descriptions. */
export const MODEL_NOTES=[
 'Call get_state first to check the current state, IDs and selection. "This cow" is interpreted as the selected point.',
 'Coordinates: x is along the barn length, y is the width, heightM is height. Lengths in m, angles in deg.',
 'Edits apply to the current scenario. The baseline is read-only. update_environment affects all scenarios.',
 'To keep the state before a change, use copy_to_other. It overwrites the other editable scenario.',
 'Explain numbers using get_results. Never describe "not calculated", null or invalid as zero.',
 'meanQrefW is a point\'s net heat loss. referenceCoolingWPerCow is an assumed value used for the deficit.',
 'deltaQrefW is the heat-loss difference from baseline. meanDeficitW is the 60-min mean of per-second deficits.',
 'Area means are simple averages of representative points. They differ from the herd-mean / occupancy-weighted milk values.',
 'comparison and areas diagnose 60-min mean deficits. deficitReductionW is baseline minus scenario deficit (positive = improvement); unchangedOrWorseDeficitCount counts points whose deficit did not shrink. "No local action" is separate from roof effects. Do not pick a scenario on the mean alone.',
 'evaluate\'s project contains layout, shared weather, model coefficients and the baseline. Passing the whole reply or its project as JSON to Load / "Import MCP scenario JSON" restores and recalculates it.',
 'resources are in L/day and kWh/day. trialWaterL/trialKwh cover the 60-min trial. Daily-milk resources are in dailyMilk.resources.',
 'Mean values returned without per-point series do not change when timeSec changes.',
 'Each face shows the value of its representative point - not a CFD or whole-face calculation.',
 'Daily milk is a hypothesis-model reference value. Its coefficients are explicit assumptions, not a guaranteed real-farm effect.',
 'Explain "why" via wind speed, radiation, the heat-loss breakdown and device action. When unsure, say it is a hypothesis and change one condition at a time.',
 'To compare outcomes of changed conditions, use evaluate - not edit, get_results, undo. It tries several hypotheses without touching the view state or the Undo history.',
 'describe_model returns the model structure, assumptions and limits. Call it before explaining results.',
 'Model coefficients change via update_model (physics) / update_milk (milk hypothesis) / update_references (reference settings). Combine sensitivity trials with evaluate and describe changed-coefficient results as a different model input from the defaults.',
 'Set representative-day hourly weather via update_daily_weather. mode:"hourly" requires 24 rows with hour=0-23, ascending and unique. Pressure, background wind and ventilation share the environment values across all hours.',
 'dailyThermal is the evaluation-day (24 h) per-second-integrated mean deficit per point/area. The 60-min evaluation (points) always uses fixed environment weather. The time-weighted daily load (dailyMilk.dailyDeficitWPerCow) and the point mean (dailyThermal.all.meanDeficitW) differ by definition and will not match.',
 'compare_candidates applies 1-3 candidate operation lists separately to the same starting project and returns daily results, constraint verdicts and ranks. Candidate operations are operation tweaks only (update_device enabled/position/direction/daily schedule, update_system onoff/daily schedule, update_roof explicit settings). Performance coefficients, weather and scenario switching cannot be candidate ops. Ranks are valid only within that call.',
] as const;

const DEVICE_COMMON=['x','y','heightM','yawDeg','pitchDownDeg','enabled'];
const PATCH_FIELDS={
 fan:new Set([...DEVICE_COMMON,'diameterM','outletSpeedMps','powerKw','hoursPerDay','dailyStartHour']),
 nozzle:new Set([...DEVICE_COMMON,'flowLpm','halfAngleDeg']),
 roof:new Set(['reflectance','insulationM','sprayEnabled','flowLpmM2','onSec','offSec','hoursPerDay','dailyStartHour','pumpPowerKw'] satisfies (keyof RoofSettings)[]),
 system:new Set(['enabled','onSec','offSec','hoursPerDay','dailyStartHour','pumpPowerKw'] satisfies (keyof Omit<WaterSystem,'id'|'kind'|'nozzles'>)[]),
 environment:new Set(['temperatureC','relativeHumidityPct','pressurePa','backgroundSpeedMps','ventilationM3sPerM2','solarRoofWm2'] satisfies (keyof Project['environment'])[]),
 model:new Set(['surfaceTemperatureC','areaM2','wetAreaM2','patchLengthM','patchWidthM','baseWetFraction','emissivity','radiantOffsetC','kSpread','kDecay','latentHeatJkg','airDensityKgM3','airCpJkgK','vaporGasConstant','hcIntercept','hcSlope','roof','profiles'] satisfies (keyof Omit<Project['model'],'version'>)[]),
 modelRoof:new Set<string>(['backgroundSensibleW','bareResistance','conductivity','hOutConv','hOutRad','hInConv','hInRad','viewFactor','waterCapacityKgM2'] satisfies (keyof Omit<Project['model']['roof'],'version'>)[]),
 profile:new Set<string>(['outletMultiplier','hcMultiplier','mistEfficiency','maxFilmKg'] satisfies (keyof Omit<Project['model']['profiles'][number],'id'|'name'>)[]),
 milk:new Set(['potentialMilkKgPerCowDay','referenceCoolingWPerCow','responseKgPerCowDayPerW','maxLossFraction','lagWeights','occupancyFractions','responseSensitivityKgPerCowDayPerW','warmupDurationSec','evaluationDurationSec','timeStepSec'] satisfies (keyof Omit<Project['milkSimulation'],'modelId'|'mode'|'weatherMode'|'operationPolicy'|'assumptionClass'>)[]),
 dailyWeather:new Set(['mode','hours'] satisfies (keyof DailyWeather)[]),
 references:new Set(['baselineMilkKgPerDay','fertility']),
 fertility:new Set(['p0','mode','exposureAssumed','temperatureC','relativeHumidityPct']),
};

function ensureEditable(d:CommandDeps){
 const s=d.status();
 if(s.invalidInput||s.pendingInput||d.store.isDraft)throw Error(CONFIRM_INPUT);
}
function checkPatch(patch:Record<string,unknown>|undefined,allowed:Set<string>,label:string){
 if(!patch||!Object.keys(patch).length)throw Error('patch has no fields to change');
 const bad=Object.keys(patch).filter(k=>!allowed.has(k));
 if(bad.length)throw Error(`${label} patch contains disallowed fields: ${bad.join(', ')}`);
 return patch!;
}
function layout(p:Project):Layout{return buildLayout(p.template)}
function scenarioDevices(p:Project){return devices(activeScenario(p))}
function deviceById(p:Project,id:string|undefined){
 const d=scenarioDevices(p).find(d=>d.id===id);
 if(!d)throw Error(`device not found: ${id}`);
 return d;
}
function stripPoint(q:PointResult){const{series,qSeries,...rest}=q;return rest}

/** Editable/calculating/result readiness shared by get_state and get_results. */
function resultStatus(d:CommandDeps):{status:ResultStatus;reason?:string}{
 const s=d.status();
 if(s.invalidInput)return{status:'editing',reason:'there is an input error'};
 if(d.store.isDraft)return{status:'editing',reason:'layout editing in progress'};
 if(s.pendingInput)return{status:'editing',reason:'an input is unconfirmed'};
 const r=d.currentResult();
 // Never serve a result computed for a different committed input.
 if(r&&r.inputHash===inputHash(d.store.committed))return{status:r.dailyMilkStatus==='pending'?'thermal_ready':'ready'};
 if(s.workerError)return{status:'error',reason:s.workerError};
 return{status:'calculating'};
}

/** Applies one edit operation to the given store. Shared by `edit` (live store),
 * `evaluate` (throwaway clone), and the AWS Lambda adapters (aws/lambda/core.ts). */
export function applyOperation(s:ProjectStore,args:EditArgs):Record<string,unknown>{
 const p=()=>s.committed;
 switch(args.operation){
  case'switch_scenario':{
   if(!args.scenarioId)throw Error('scenarioId is required');
   s.switchScenario(args.scenarioId);
   return{scenario:activeScenario(p()).id};
  }
  case'copy_to_other':{
   s.copyActiveToOther();
   return{scenario:activeScenario(p()).id,name:activeScenario(p()).name};
  }
  case'update_device':{
   const dev=deviceById(p(),args.deviceId);
   const patch=checkPatch(args.patch,isFan(dev)?PATCH_FIELDS.fan:PATCH_FIELDS.nozzle,isFan(dev)?'fan':'nozzle');
   s.updateDevice(dev.id,patch as Partial<Device>);
   return{deviceId:dev.id,applied:deviceById(p(),dev.id)};
  }
  case'update_roof':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.roof,'roof');
   s.updateRoof(patch as Partial<RoofSettings>);
   return{applied:activeScenario(p()).roof};
  }
  case'update_system':{
   if(!activeScenario(p()).waterSystems.some(w=>w.id===args.systemId))throw Error(`system not found: ${args.systemId}`);
   const patch=checkPatch(args.patch,PATCH_FIELDS.system,'water system');
   s.updateSystem(args.systemId!,patch);
   return{systemId:args.systemId,applied:activeScenario(p()).waterSystems.find(w=>w.id===args.systemId)};
  }
  case'update_environment':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.environment,'shared weather');
   s.updateEnvironment(patch);
   return{applied:p().environment};
  }
  case'update_model':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.model,'model');
   const roof=patch.roof as Record<string,unknown>|undefined;
   if(roof){const bad=Object.keys(roof).filter(k=>!PATCH_FIELDS.modelRoof.has(k));if(bad.length)throw Error(`model roof patch contains disallowed fields: ${bad.join(', ')}`)}
   const profiles=patch.profiles as Record<string,Record<string,unknown>>|undefined;
   if(profiles)for(const[id,sub]of Object.entries(profiles)){
    if(!p().model.profiles.some(x=>x.id===id))throw Error(`profile not found: ${id}`);
    const bad=Object.keys(sub).filter(k=>!PATCH_FIELDS.profile.has(k));if(bad.length)throw Error(`profile ${id} patch contains disallowed fields: ${bad.join(', ')}`)}
   s.updateModel(patch);
   return{applied:p().model};
  }
  case'update_daily_weather':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.dailyWeather,'dailyWeather');
   s.updateDailyWeather(patch as unknown as DailyWeather);
   return{applied:p().dailyWeather};
  }
  case'update_milk':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.milk,'milk model');
   s.updateMilk(patch as Partial<Project['milkSimulation']>);
   return{applied:p().milkSimulation};
  }
  case'update_references':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.references,'references');
   const{fertility,...flat}=patch;
   const merged:Record<string,unknown>={...flat};
   if(fertility){
    const bad=Object.keys(fertility).filter(k=>!PATCH_FIELDS.fertility.has(k));if(bad.length)throw Error(`fertility reference patch contains disallowed fields: ${bad.join(', ')}`);
    merged.fertility={...p().references.fertility,...fertility};
   }
   s.updateReferences(merged);
   return{applied:p().references};
  }
  case'add_device':{
   if(args.kind!=='fan'&&args.kind!=='soaker'&&args.kind!=='mist')throw Error(`unknown device kind: ${args.kind}`);
   if((args.x!=null)!==(args.y!=null))throw Error('x and y must be given together');
   const pose=args.x!=null?{x:args.x,y:args.y!}:undefined;
   const id=args.kind==='fan'?s.addFan(pose):s.addNozzle(args.kind,pose);
   return{deviceId:id,applied:deviceById(p(),id)};
  }
  case'duplicate_device':{
   deviceById(p(),args.deviceId);
   const id=s.duplicateDevice(args.deviceId!);
   return{deviceId:id,applied:deviceById(p(),id)};
  }
  case'remove_device':{
   deviceById(p(),args.deviceId);
   s.removeDevice(args.deviceId!);
   return{removedDeviceId:args.deviceId};
  }
  default:throw Error(`unknown operation: ${args.operation}`);
 }
}

/** Stateless core of `evaluate`: applies ops to a clone of the given project,
 * simulates via the injected runner, and returns the result plus the clone so
 * callers (e.g. aws/lambda/core.ts) can chain further edits with consistent
 * operation-generated ids. */
export async function evaluateOnProject(project:Project,args:EvaluateArgs,runEval:(p:Project,o:{daily:boolean})=>Promise<EvalJob>){
 if(!args||!Array.isArray(args.operations))throw Error('operations must be an array of operations');
 const tmp=new ProjectStore(structuredClone(project));
 if(args.scenarioId&&args.scenarioId!==tmp.committed.activeScenarioId)tmp.switchScenario(args.scenarioId);
 const applied=args.operations.map(op=>applyOperation(tmp,op));
 const job=await runEval(tmp.committed,{daily:args.includeDaily===true});
 if(job.daily)mergeDaily(job.thermal,job.daily,job.dailyThermal??{},job.dailyMilkStatus);
 const p=tmp.committed,areas=buildAreas(layout(p));
 const scenarioOf=(id:string)=>{
  const sr=job.thermal.scenarios.find(s=>s.id===id);
  if(!sr)return null;
  const meta=p.scenarios.find(s=>s.id===id)!,{series:_,...roof}=sr.roof;
  return{id,name:meta.name,readOnly:meta.readOnly,warnings:sr.warnings,comparison:comparisonStats(sr.points,job.thermal.scenarios.find(s=>s.id===p.baselineScenarioId)?.points??[],{id:'all',label:'All points',probeIds:layout(p).probes.map(q=>q.id)}),areas:areas.map(a=>comparisonStats(sr.points,job.thermal.scenarios.find(s=>s.id===p.baselineScenarioId)?.points??[],a)),resources:sr.resources,trialWaterL:sr.trialWaterL,trialKwh:sr.trialKwh,roof,dailyMilk:job.daily?sr.dailyMilk:undefined,dailyThermal:job.daily?sr.dailyThermal:undefined};
 };
 return{
  scenarioId:p.activeScenarioId,inputHash:inputHash(p),operations:applied,
  result:scenarioOf(p.activeScenarioId),baseline:scenarioOf(p.baselineScenarioId),
  dailyIncluded:!!job.daily,project:p,
 };
}

/** Candidate ops are restricted to operation-schedule/placement tweaks; model
 * coefficients, weather, scenario switching and structural add/remove are not
 * candidate knobs (they would let a candidate "win" by changing the rules). */
const CANDIDATE_OPS:{
 update_device:{fan:Set<string>;nozzle:Set<string>};
 update_system:Set<string>;
 update_roof:Set<string>;
}={
 update_device:{fan:new Set(['enabled','x','y','heightM','yawDeg','pitchDownDeg','hoursPerDay','dailyStartHour']),nozzle:new Set(['enabled','x','y','heightM','yawDeg','pitchDownDeg'])},
 update_system:new Set(['enabled','onSec','offSec','hoursPerDay','dailyStartHour']),
 update_roof:new Set(['reflectance','insulationM','sprayEnabled','flowLpmM2','onSec','offSec','hoursPerDay','dailyStartHour']),
};
function assertCandidateOp(p:Project,op:EditArgs){
 const allowed=(CANDIDATE_OPS as Record<string,unknown>)[op.operation];
 if(!allowed)throw Error(`operation not allowed in candidate comparison: ${op.operation} (only update_device/update_system/update_roof are allowed; coefficients, weather, scenario switching and add/remove are not)`);
 if(op.operation==='update_device'){const dev=deviceById(p,op.deviceId);checkPatch(op.patch,isFan(dev)?CANDIDATE_OPS.update_device.fan:CANDIDATE_OPS.update_device.nozzle,'candidate device')}
 else checkPatch(op.patch,allowed as Set<string>,'candidate');
}
function normalizeConstraints(c:Partial<CandidateConstraints>|undefined,p:Project):CandidateConstraints{
 const ids=new Set([...buildAreas(layout(p)).map(a=>a.id),'all']);
 const priorityArea=c?.priorityArea??'stalls';
 if(!ids.has(priorityArea))throw Error(`unknown priorityArea: ${priorityArea} (usable IDs: ${[...ids].join(', ')})`);
 const protectAreas=c?.protectAreas??['stalls','feeding','waiting'];
 for(const a of protectAreas)if(!ids.has(a))throw Error(`protectAreas contains an unknown area: ${a}`);
 return{maxWaterLPerDay:c?.maxWaterLPerDay,maxElectricityKwhPerDay:c?.maxElectricityKwhPerDay,priorityArea,protectAreas,protectWorst:c?.protectWorst??true};
}
/** Stateless core of `compare_candidates`: evaluates the start scenario once,
 * applies each candidate's ops to a fresh clone, and returns day-scale results,
 * constraint verdicts and a deterministic order. Never cumulative. */
export async function compareOnProject(project:Project,args:CompareArgs,runEval:(p:Project,o:{daily:boolean})=>Promise<EvalJob>){
 if(!args||!Array.isArray(args.candidates)||!args.candidates.length)throw Error('candidates needs 1-3 operation lists');
 if(args.candidates.length>3)throw Error('at most 3 candidates can be compared per call. Split into multiple calls with the same project and constraints');
 const seen=new Set<string>();
 for(const c of args.candidates){
  if(!c||typeof c.id!=='string'||!c.id)throw Error('a candidate id is required');
  if(seen.has(c.id))throw Error(`duplicate candidate id: ${c.id}`);
  seen.add(c.id);
  if(!Array.isArray(c.operations))throw Error(`candidate ${c.id} needs an operations array`);
 }
 const k=normalizeConstraints(args.constraints,project);
 const targetId=args.scenarioId??project.activeScenarioId;
 const meta=project.scenarios.find(s=>s.id===targetId);
 if(!meta)throw Error(`scenario not found: ${targetId}`);
 if(meta.readOnly)throw Error('candidate comparison targets an editable scenario. The baseline cannot be changed');
 const startJob=await runEval(structuredClone(project),{daily:true});
 if(startJob.daily)mergeDaily(startJob.thermal,startJob.daily,startJob.dailyThermal??{},startJob.dailyMilkStatus);
 const startSr=startJob.thermal.scenarios.find(s=>s.id===targetId);
 const startSum=summarizeDay(startSr);
 const ranking=args.ranking??'deficit';
 if(!['deficit','water','worst'].includes(ranking))throw Error(`ranking must be deficit/water/worst: ${ranking}`);
 interface CandidateOut{id:string;status:string;error?:string;operations:Record<string,unknown>[];inputHash?:string;reasons?:string[];coolingWaterLPerDay?:number|null;electricityKwhPerDay?:number|null;areaMeanDeficitW?:Record<string,number|null>;allMaxDeficitW?:number|null;worsenedPoints?:number|null;violations:string[];constraintsSatisfied:boolean;improvesPriorityArea:boolean;dailyMilkYieldKgPerCowDay?:number|null}
 const candidates:CandidateOut[]=[];
 for(const c of args.candidates){
  const tmp=new ProjectStore(structuredClone(project));
  tmp.switchScenario(targetId);
  let applied:Record<string,unknown>[];
  try{applied=c.operations.map(op=>{assertCandidateOp(tmp.committed,op);return applyOperation(tmp,op)})}
  catch(e){candidates.push({id:c.id,status:'invalid_input',error:e instanceof Error?e.message:String(e),operations:[],constraintsSatisfied:false,improvesPriorityArea:false,violations:['operations could not be applied']});continue}
  const job=await runEval(tmp.committed,{daily:true});
  if(job.daily)mergeDaily(job.thermal,job.daily,job.dailyThermal??{},job.dailyMilkStatus);
  const sr=job.thermal.scenarios.find(s=>s.id===targetId),sum=summarizeDay(sr);
  sum.worsenedPoints=worsenedCount(sr,startSr);
  const violations=checkConstraints(sum,startSum,k);
  candidates.push({id:c.id,operations:applied,inputHash:inputHash(tmp.committed),status:sum.status,reasons:sum.reasons,
   coolingWaterLPerDay:sum.coolingWaterLPerDay,electricityKwhPerDay:sum.electricityKwhPerDay,
   areaMeanDeficitW:sum.areaMean,allMaxDeficitW:sum.allMax,worsenedPoints:sum.worsenedPoints,
   violations,constraintsSatisfied:!violations.length,improvesPriorityArea:improvesPriorityArea(sum,startSum,k.priorityArea),
   dailyMilkYieldKgPerCowDay:sr?.dailyMilk?.yieldKgPerCowDay??null});
 }
 const pool=candidates.filter(c=>c.constraintsSatisfied).map(c=>({id:c.id,s:{areaMean:c.areaMeanDeficitW??{},allMax:c.allMaxDeficitW??null,coolingWaterLPerDay:c.coolingWaterLPerDay??null,electricityKwhPerDay:c.electricityKwhPerDay??null},improves:c.improvesPriorityArea}));
 const order=rankCandidates(pool,k.priorityArea,ranking);
 return{
  start:{scenarioId:targetId,inputHash:startJob.thermal.inputHash,coolingWaterLPerDay:startSum.coolingWaterLPerDay,electricityKwhPerDay:startSum.electricityKwhPerDay,areaMeanDeficitW:startSum.areaMean,allMaxDeficitW:startSum.allMax,valid:startSum.valid,reasons:startSum.reasons},
  constraints:k,ranking:{mode:ranking,order,note:'these ranks hold only within this call. To compare against candidates from another call, re-rank under the same rules'},
  candidates,
  note:order.length?`${order.length} candidate(s) satisfy the constraints`:`none of the evaluated candidates satisfy the constraints (this is not an exhaustive search, so feasibility is not disproven). Check violations for the exclusion conditions`,
 };
}
export function createCommands(d:CommandDeps){
 const store=d.store;

 function getState(){
  const p=store.committed,l=layout(p),s=d.status();
  return{
   appVersion:p.appVersion,schemaVersion:p.schemaVersion,inputHash:inputHash(p),
   baselineScenarioId:p.baselineScenarioId,activeScenarioId:p.activeScenarioId,
   scenarios:p.scenarios.map(s=>({id:s.id,name:s.name,readOnly:s.readOnly,roof:s.roof,fans:s.fans,waterSystems:s.waterSystems})),
   template:p.template,environment:p.environment,dailyWeather:p.dailyWeather,view:p.view,milkSimulation:p.milkSimulation,
   probes:l.probes.map(q=>({id:q.id,label:q.label,kind:q.kind,x:q.x,y:q.y,heightM:q.heightM})),
   areas:buildAreas(l).map(a=>({id:a.id,label:a.label,probeIds:a.probeIds,subtotal:a.subtotal??false})),
   undoCount:store.undoCount,redoCount:store.redoCount,
   draft:store.isDraft,pendingInput:s.pendingInput,invalidInput:s.invalidInput,
   calculation:resultStatus(d).status,
   modelNotes:MODEL_NOTES,
  };
 }

 function edit(args:EditArgs){
  ensureEditable(d);
  const applied=applyOperation(store,args);
  return{operation:args.operation,activeScenarioId:store.committed.activeScenarioId,inputHash:inputHash(store.committed),undoCount:store.undoCount,...applied};
 }

 /** Applies ops to a cloned project, simulates it, and returns results. Never touches the live store. */
 async function evaluate(args:EvaluateArgs){
  const r=await evaluateOnProject(store.committed,args,d.evaluate);
  return{...r,note:'Result of applying the operations to a throwaway clone. The view is unchanged. Save the whole reply or its project as JSON and restore it via Load / "Import MCP scenario JSON" in the view'};
 }

 function setView(args:SetViewArgs){
  const p=store.committed,l=layout(p),patch:Partial<View>={};
  if(args.mode!==undefined)patch.mode=args.mode;
  if(args.metric!==undefined)patch.metric=args.metric;
  if(args.analysis!==undefined)patch.analysis=args.analysis;
  if(args.realistic!==undefined)patch.realistic=args.realistic;
  if(args.heatmap!==undefined)patch.heatmap=args.heatmap;
  if(args.roof!==undefined)patch.roof=args.roof;
  if(args.flow!==undefined)patch.flow=args.flow;
  if(args.particles!==undefined)patch.particles=args.particles;
  if(args.selectedAreaId!==undefined){
   if(args.selectedAreaId!==null&&!buildAreas(l).some(a=>a.id===args.selectedAreaId))throw Error(`area not found: ${args.selectedAreaId}`);
   patch.selectedAreaId=args.selectedAreaId;
  }
  if(args.selectedProbeId!==undefined){
   const q=l.probes.find(q=>q.id===args.selectedProbeId);
   if(!q)throw Error(`point not found: ${args.selectedProbeId}`);
   patch.selectedProbeId=q.id;
   patch.selectedAreaId=areaOfProbe(l,q.id)?.id??null;
  }
  if(args.selectedDeviceId!==undefined){
   patch.selectedDeviceId=args.selectedDeviceId===null?null:deviceById(p,args.selectedDeviceId).id;
  }
  if(args.timeSec!==undefined){d.stopPlayback();patch.timeSec=args.timeSec}
  store.setView(patch);
  return store.committed.view;
 }

 function describe(){return{model:describeModel(store.committed),modelNotes:MODEL_NOTES}}

 function getResults(args:GetResultsArgs={}){
  const p=store.committed,l=layout(p);
  const probeId=args.probeId??p.view.selectedProbeId;
  const probe=l.probes.find(q=>q.id===probeId);
  if(!probe)throw Error(`point not found: ${probeId}`);
  const wanted=args.scenarioId?[args.scenarioId]:p.scenarios.map(s=>s.id);
  for(const id of wanted)if(!p.scenarios.some(s=>s.id===id))throw Error(`scenario not found: ${id}`);
  const st=resultStatus(d);
  if(st.status!=='ready'&&st.status!=='thermal_ready')return{status:st.status,reason:st.reason,result:null};
  const r=d.currentResult()!,areas=buildAreas(l);
  const scenarios=wanted.map(id=>{
   const sr=r.scenarios.find(s=>s.id===id)!,{series:_,...roof}=sr.roof;
   const meta=p.scenarios.find(s=>s.id===id)!;
   return{id,name:meta.name,readOnly:meta.readOnly,warnings:sr.warnings,comparison:comparisonStats(sr.points,r.scenarios.find(s=>s.id===p.baselineScenarioId)?.points??[],{id:'all',label:'All points',probeIds:l.probes.map(q=>q.id)}),areas:areas.map(a=>comparisonStats(sr.points,r.scenarios.find(s=>s.id===p.baselineScenarioId)?.points??[],a)),resources:sr.resources,trialWaterL:sr.trialWaterL,trialKwh:sr.trialKwh,roof,dailyMilk:sr.dailyMilk,dailyThermal:sr.dailyThermal};
  });
  const points=Object.fromEntries(wanted.map(id=>{
   const q=r.scenarios.find(s=>s.id===id)!.points.find(q=>q.probeId===probe.id);
   return[id,q?stripPoint(q):null];
  }));
  const area=areaOfProbe(l,probe.id);
  return{status:st.status,result:{
   inputHash:r.inputHash,modelVersion:r.modelVersion,durationSec:r.durationSec,dailyMilkStatus:r.dailyMilkStatus,baselineScenarioId:p.baselineScenarioId,
   scenarios,
   probe:{id:probe.id,label:probe.label,kind:probe.kind,areaId:area?.id??null,points},
  }};
 }

 function undo(){
  ensureEditable(d);
  const changed=store.undoCount>0;
  store.undo();
  return{changed,activeScenarioId:store.committed.activeScenarioId,inputHash:inputHash(store.committed),undoCount:store.undoCount};
 }

 return{get_state:getState,edit,evaluate,set_view:setView,get_results:getResults,undo,describe_model:describe,compare_candidates:(args:CompareArgs)=>compareOnProject(store.committed,args,d.evaluate)} as const;
}
export type CommandMap=ReturnType<typeof createCommands>;
