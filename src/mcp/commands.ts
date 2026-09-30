import type {DailyMilkResult,Device,Layout,PointResult,Project,RoofSettings,SimulationResult,View,WaterSystem} from '../domain/project.js';
import {activeScenario,devices,isFan} from '../domain/project.js';
import {ProjectStore} from '../state/store.js';
import {buildLayout} from '../template/layout.js';
import {areaOfProbe,buildAreas} from '../template/faces.js';
import {areaStats} from '../model/areaStats.js';
import {inputHash} from '../model/simulation.js';
import {mergeDaily} from '../model/dailySimulation.js';
import {describeModel} from '../model/modelInfo.js';

/** Runtime UI/worker state owned by main.ts; injected so commands stay testable. */
export interface CommandStatus{pendingInput:boolean;invalidInput:boolean;calculating:boolean;workerError:string|null}
/** One-off simulation of a hypothetical project; `daily` is null when not requested. */
export interface EvalJob{thermal:SimulationResult;daily:Record<string,DailyMilkResult>|null;dailyMilkStatus:'complete'|'error'}
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

const CONFIRM_INPUT='画面の入力を確定してください';

/** Short guidance also embedded in the MCP server instructions and tool descriptions. */
export const MODEL_NOTES=[
 '最初にget_stateで現状・ID・選択対象を確認する。「この牛」は選択地点として解釈する。',
 '座標はx=牛舎の長さ方向、y=幅方向、heightM=高さ。長さはm、向きはdeg。',
 '編集は現在の案へ適用する。基準案は読取専用。update_environmentは全案に効く。',
 '変更前を残す依頼はcopy_to_otherを使う。コピー先は既存の別案を上書きする。',
 '数値説明はget_resultsの計算結果を使う。未計算・null・invalidをゼロと説明しない。',
 'meanQrefWは地点の正味放熱量。referenceCoolingWPerCowは不足計算に用いる仮定値。',
 'deltaQrefWは基準案からの放熱差。meanDeficitWは秒ごとの不足を積算した60分平均。',
 '区画平均は代表地点の単純平均。乳量の牛群平均・滞在時間加重とは異なる。',
 'resourcesの単位はL/day、kWh/day。trialWaterL/trialKwhは60分試行分。日乳量の資源量はdailyMilk.resources。',
 '地点のseriesを省いて返す平均値は、timeSecを変えても変化しない。',
 '各面は代表地点の値。CFDや面内全域の計算ではない。',
 '日乳量は仮説モデルの参考値。係数は明示的な仮定で、実牛舎での効果保証ではない。',
 '「なぜ」の説明は風速・放射・放熱内訳・設備作用等を根拠にする。断定が難しいときは仮説と伝え、1条件だけ変えて比較する。',
 '条件を変えた結果の比較にはedit→get_results→undoではなくevaluateを使う。画面の状態・Undo履歴を変えずに複数の仮説を試せる。',
 'モデルの計算構造・仮定・限界はdescribe_modelで取得できる。結果を説明する前に呼んでおく。',
 'モデル係数はupdate_model(物理)/update_milk(乳量仮説)/update_references(参照)で変更する。仮定の感度試行はevaluateと組み合わせ、係数を変えた結果は既定値とは別モデル入力として説明する。',
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
 references:new Set(['baselineMilkKgPerDay','fertility']),
 fertility:new Set(['p0','mode','exposureAssumed','temperatureC','relativeHumidityPct']),
};

function ensureEditable(d:CommandDeps){
 const s=d.status();
 if(s.invalidInput||s.pendingInput||d.store.isDraft)throw Error(CONFIRM_INPUT);
}
function checkPatch(patch:Record<string,unknown>|undefined,allowed:Set<string>,label:string){
 if(!patch||!Object.keys(patch).length)throw Error('patchに変更対象のフィールドがありません');
 const bad=Object.keys(patch).filter(k=>!allowed.has(k));
 if(bad.length)throw Error(`${label}のpatchに許可されないフィールドがあります: ${bad.join(', ')}`);
 return patch!;
}
function layout(p:Project):Layout{return buildLayout(p.template)}
function scenarioDevices(p:Project){return devices(activeScenario(p))}
function deviceById(p:Project,id:string|undefined){
 const d=scenarioDevices(p).find(d=>d.id===id);
 if(!d)throw Error(`設備が見つかりません: ${id}`);
 return d;
}
function stripPoint(q:PointResult){const{series,qSeries,...rest}=q;return rest}

/** Editable/calculating/result readiness shared by get_state and get_results. */
function resultStatus(d:CommandDeps):{status:ResultStatus;reason?:string}{
 const s=d.status();
 if(s.invalidInput)return{status:'editing',reason:'入力エラーがあります'};
 if(d.store.isDraft)return{status:'editing',reason:'配置を編集中です'};
 if(s.pendingInput)return{status:'editing',reason:'入力が未確定です'};
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
   if(!args.scenarioId)throw Error('scenarioIdが必要です');
   s.switchScenario(args.scenarioId);
   return{scenario:activeScenario(p()).id};
  }
  case'copy_to_other':{
   s.copyActiveToOther();
   return{scenario:activeScenario(p()).id,name:activeScenario(p()).name};
  }
  case'update_device':{
   const dev=deviceById(p(),args.deviceId);
   const patch=checkPatch(args.patch,isFan(dev)?PATCH_FIELDS.fan:PATCH_FIELDS.nozzle,isFan(dev)?'ファン':'ノズル');
   s.updateDevice(dev.id,patch as Partial<Device>);
   return{deviceId:dev.id,applied:deviceById(p(),dev.id)};
  }
  case'update_roof':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.roof,'屋根');
   s.updateRoof(patch as Partial<RoofSettings>);
   return{applied:activeScenario(p()).roof};
  }
  case'update_system':{
   if(!activeScenario(p()).waterSystems.some(w=>w.id===args.systemId))throw Error(`系統が見つかりません: ${args.systemId}`);
   const patch=checkPatch(args.patch,PATCH_FIELDS.system,'水系統');
   s.updateSystem(args.systemId!,patch);
   return{systemId:args.systemId,applied:activeScenario(p()).waterSystems.find(w=>w.id===args.systemId)};
  }
  case'update_environment':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.environment,'共通気象');
   s.updateEnvironment(patch);
   return{applied:p().environment};
  }
  case'update_model':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.model,'モデル');
   const roof=patch.roof as Record<string,unknown>|undefined;
   if(roof){const bad=Object.keys(roof).filter(k=>!PATCH_FIELDS.modelRoof.has(k));if(bad.length)throw Error(`モデル屋根のpatchに許可されないフィールドがあります: ${bad.join(', ')}`)}
   const profiles=patch.profiles as Record<string,Record<string,unknown>>|undefined;
   if(profiles)for(const[id,sub]of Object.entries(profiles)){
    if(!p().model.profiles.some(x=>x.id===id))throw Error(`プロファイルが見つかりません: ${id}`);
    const bad=Object.keys(sub).filter(k=>!PATCH_FIELDS.profile.has(k));if(bad.length)throw Error(`プロファイル${id}のpatchに許可されないフィールドがあります: ${bad.join(', ')}`)}
   s.updateModel(patch);
   return{applied:p().model};
  }
  case'update_milk':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.milk,'乳量モデル');
   s.updateMilk(patch as Partial<Project['milkSimulation']>);
   return{applied:p().milkSimulation};
  }
  case'update_references':{
   const patch=checkPatch(args.patch,PATCH_FIELDS.references,'参照');
   const{fertility,...flat}=patch;
   const merged:Record<string,unknown>={...flat};
   if(fertility){
    const bad=Object.keys(fertility).filter(k=>!PATCH_FIELDS.fertility.has(k));if(bad.length)throw Error(`受胎参照のpatchに許可されないフィールドがあります: ${bad.join(', ')}`);
    merged.fertility={...p().references.fertility,...fertility};
   }
   s.updateReferences(merged);
   return{applied:p().references};
  }
  case'add_device':{
   if(args.kind!=='fan'&&args.kind!=='soaker'&&args.kind!=='mist')throw Error(`不明な設備種別です: ${args.kind}`);
   if((args.x!=null)!==(args.y!=null))throw Error('xとyは両方指定してください');
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
  default:throw Error(`不明なoperationです: ${args.operation}`);
 }
}

/** Stateless core of `evaluate`: applies ops to a clone of the given project,
 * simulates via the injected runner, and returns the result plus the clone so
 * callers (e.g. aws/lambda/core.ts) can chain further edits with consistent
 * operation-generated ids. */
export async function evaluateOnProject(project:Project,args:EvaluateArgs,runEval:(p:Project,o:{daily:boolean})=>Promise<EvalJob>){
 if(!args||!Array.isArray(args.operations))throw Error('operationsに操作の配列が必要です');
 const tmp=new ProjectStore(structuredClone(project));
 if(args.scenarioId&&args.scenarioId!==tmp.committed.activeScenarioId)tmp.switchScenario(args.scenarioId);
 const applied=args.operations.map(op=>applyOperation(tmp,op));
 const job=await runEval(tmp.committed,{daily:args.includeDaily===true});
 if(job.daily)mergeDaily(job.thermal,job.daily,job.dailyMilkStatus);
 const p=tmp.committed,areas=buildAreas(layout(p));
 const scenarioOf=(id:string)=>{
  const sr=job.thermal.scenarios.find(s=>s.id===id);
  if(!sr)return null;
  const meta=p.scenarios.find(s=>s.id===id)!,{series:_,...roof}=sr.roof;
  return{id,name:meta.name,readOnly:meta.readOnly,warnings:sr.warnings,areas:areas.map(a=>areaStats(sr.points,a)),resources:sr.resources,trialWaterL:sr.trialWaterL,trialKwh:sr.trialKwh,roof,dailyMilk:job.daily?sr.dailyMilk:undefined};
 };
 return{
  scenarioId:p.activeScenarioId,inputHash:inputHash(p),operations:applied,
  result:scenarioOf(p.activeScenarioId),baseline:scenarioOf(p.baselineScenarioId),
  dailyIncluded:!!job.daily,project:p,
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
   template:p.template,environment:p.environment,view:p.view,milkSimulation:p.milkSimulation,
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
  const{project:_,...rest}=r;
  return{...rest,note:'仮の複製へ操作を適用して計算した結果です。画面の案・設備・Undo履歴は変わっていません'};
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
   if(args.selectedAreaId!==null&&!buildAreas(l).some(a=>a.id===args.selectedAreaId))throw Error(`区画が見つかりません: ${args.selectedAreaId}`);
   patch.selectedAreaId=args.selectedAreaId;
  }
  if(args.selectedProbeId!==undefined){
   const q=l.probes.find(q=>q.id===args.selectedProbeId);
   if(!q)throw Error(`地点が見つかりません: ${args.selectedProbeId}`);
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
  if(!probe)throw Error(`地点が見つかりません: ${probeId}`);
  const wanted=args.scenarioId?[args.scenarioId]:p.scenarios.map(s=>s.id);
  for(const id of wanted)if(!p.scenarios.some(s=>s.id===id))throw Error(`案が見つかりません: ${id}`);
  const st=resultStatus(d);
  if(st.status!=='ready'&&st.status!=='thermal_ready')return{status:st.status,reason:st.reason,result:null};
  const r=d.currentResult()!,areas=buildAreas(l);
  const scenarios=wanted.map(id=>{
   const sr=r.scenarios.find(s=>s.id===id)!,{series:_,...roof}=sr.roof;
   const meta=p.scenarios.find(s=>s.id===id)!;
   return{id,name:meta.name,readOnly:meta.readOnly,warnings:sr.warnings,areas:areas.map(a=>areaStats(sr.points,a)),resources:sr.resources,trialWaterL:sr.trialWaterL,trialKwh:sr.trialKwh,roof,dailyMilk:sr.dailyMilk};
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

 return{get_state:getState,edit,evaluate,set_view:setView,get_results:getResults,undo,describe_model:describe} as const;
}
export type CommandMap=ReturnType<typeof createCommands>;
