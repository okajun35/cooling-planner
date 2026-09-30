import type {Project,Device,Pose} from './project.js';
import {buildLayout,positionFromAnchor} from '../template/layout.js';
import {MODEL} from '../data/defaults.js';
import {validateMilkSettings} from '../model/milk.js';
import {validDailyStartHour} from '../model/dailySchedule.js';
import {dailyWeatherReasons,weatherModeOf} from '../model/dailyWeather.js';
const fail=(path:string,message:string):never=>{throw new Error(`${path}: ${message}`)};
const record=(v:unknown,path:string):Record<string,any>=>{if(v===null||typeof v!=='object'||Array.isArray(v))fail(path,'an object is required');return v as Record<string,any>};
const number=(v:unknown,lo:number,hi:number,path:string)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)fail(path,`a finite number in ${lo}–${hi} is required`)};
const bool=(v:unknown,path:string)=>{if(typeof v!=='boolean')fail(path,'true/false is required')};
const text=(v:unknown,path:string,max=160)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail(path,'invalid string')};
const id=(v:unknown,path:string)=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_.-]{1,90}$/.test(v))fail(path,'invalid ID')};
function safeTree(v:unknown,depth=0){if(depth>24)fail('JSON','nesting is too deep');if(v&&typeof v==='object'){if(Array.isArray(v)&&v.length>2000)fail('JSON','array is too large');for(const [k,x]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))fail('JSON','forbidden key');safeTree(x,depth+1)}}}
export function validateProject(input:unknown):asserts input is Project{
 safeTree(input);const p=record(input,'Project');
 // v9→v10 in-place migration: old files carried only the constant environment.
 if(p.schemaVersion===9){
  if(p.model&&typeof p.model==='object'&&!Array.isArray(p.model))(p.model as Record<string,unknown>).version=MODEL.version;
  if(p.milkSimulation&&typeof p.milkSimulation==='object'&&!Array.isArray(p.milkSimulation))(p.milkSimulation as Record<string,unknown>).weatherMode='constant-environment';
  p.dailyWeather={mode:'constant',hours:[]};
  p.schemaVersion=10;
 }
 if(p.schemaVersion!==10)fail('schemaVersion','This build supports save format 10 only (v9 is converted automatically). Older or unknown formats are unsupported and cannot be loaded. The current scenario is kept');
 text(p.appVersion,'appVersion',80);const t=record(p.template,'template');
 if(t.id!=='fs-amr1-50-guided-reference'||t.version!==1)fail('template','unsupported template');
 number(t.lengthM,32,48,'barn length');number(t.widthM,23.5,30,'barn width');if(t.eaveHeightM!==4||t.ridgeHeightM!==8.7)fail('roof','this build fixes eave 4m and ridge 8.7m');
 const e=record(p.environment,'environment');number(e.temperatureC,20,40,'temperature');number(e.relativeHumidityPct,0,100,'humidity');number(e.pressurePa,50000,110000,'pressure');number(e.backgroundSpeedMps,0,10,'background wind');number(e.ventilationM3sPerM2,.0001,1,'ventilation');
 number(e.solarRoofWm2,0,1200,'roof solar');
 const dwObj=p.dailyWeather as Record<string,unknown>|undefined;
 if(dwObj&&typeof dwObj==='object'&&!Array.isArray(dwObj)&&dwObj.hours===undefined)dwObj.hours=[];
 const dwReasons=dailyWeatherReasons(p.dailyWeather);if(dwReasons.length)fail('dailyWeather',dwReasons[0]);
 const m=record(p.model,'model');if(m.version!==MODEL.version)fail('model','unsupported model version');
 for(const [key,value]of Object.entries(MODEL))if(typeof value==='number')number(m[key],key==='radiantOffsetC'?-20:0,key==='latentHeatJkg'?5e6:key==='vaporGasConstant'?1000:key==='airCpJkgK'?10000:100,`model.${key}`);
 if(m.areaM2<=0||m.wetAreaM2>m.areaM2||m.baseWetFraction>1||m.emissivity>1||m.kDecay<=0||m.airDensityKgM3<=0||m.airCpJkgK<=0||m.vaporGasConstant<=0||m.patchLengthM<=0||m.patchWidthM<=0)fail('model','invalid relation between areas or coefficients');
 const rm=record(m.roof,'model.roof');if(rm.version!==MODEL.roof.version)fail('roof.model','unsupported roof model');for(const [k,value] of Object.entries(MODEL.roof))if(typeof value==='number'){number(rm[k],0,k==='backgroundSensibleW'?1e6:100,`roof.${k}`);if(k!=='backgroundSensibleW'&&k!=='viewFactor'&&rm[k]<=0)fail('roof','coefficients must be positive')}if(rm.viewFactor>1)fail('roof.viewFactor','must be 0–1');
 const refs=record(p.references,'references');if(refs.milkModel!=='milk-table-cowbell178-v1')fail('references','unsupported milk table');if(refs.baselineMilkKgPerDay!==null)number(refs.baselineMilkKgPerDay,0,100,'baseline milk');const f=record(refs.fertility,'references.fertility');if(f.model!=='fertility-thi-period-or-baccouri2025-v1'||f.profileVersion!==1)fail('fertility','unsupported model');number(f.p0,.001,.999,'baseline conception');if(!['manual','simulation'].includes(f.mode))fail('fertility.mode','unsupported input');bool(f.exposureAssumed,'fertility.exposureAssumed');number(f.temperatureC,-20,50,'reference temperature');number(f.relativeHumidityPct,0,100,'reference humidity');
 const ms=record(p.milkSimulation,'milkSimulation');const milkReasons=validateMilkSettings(ms as Project['milkSimulation']);if(milkReasons.length)fail('milkSimulation',milkReasons[0]);
 if(ms.weatherMode!==weatherModeOf(p.dailyWeather as Project['dailyWeather']))fail('milkSimulation.weatherMode','does not match the daily-weather mode');
 if(!Array.isArray(m.profiles)||m.profiles.length!==3)fail('model.profiles','3 profiles are required');
 const profileIds=new Set<string>();for(const x of m.profiles){record(x,'profile');if(!['low','reference','high'].includes(x.id)||profileIds.has(x.id))fail('profile.id','duplicate or unknown ID');profileIds.add(x.id);text(x.name,'profile.name');number(x.outletMultiplier,.01,5,'outletMultiplier');number(x.hcMultiplier,.01,5,'hcMultiplier');number(x.mistEfficiency,0,1,'mistEfficiency');number(x.maxFilmKg,.001,5,'maxFilmKg')}
 if(!Array.isArray(p.scenarios)||p.scenarios.length!==3)fail('scenarios','a baseline plus two editable scenarios are required');
 const layout=buildLayout(t as Project['template']),ids=new Set<string>();
 for(const s of p.scenarios){
  record(s,'scenario');id(s.id,'scenario.id');if(ids.has(s.id))fail('scenario.id','duplicate');ids.add(s.id);text(s.name,'scenario.name');bool(s.readOnly,'readOnly');
  if(!Array.isArray(s.fans)||s.fans.length>40)fail('fans','max 40 units');if(!Array.isArray(s.waterSystems)||s.waterSystems.length!==2)fail('waterSystems','exactly two systems (soaker and mist) are required');
  const roof=record(s.roof,'scenario.roof');number(roof.reflectance,0,1,'roof reflectance');number(roof.insulationM,0,.1,'insulation thickness');bool(roof.sprayEnabled,'roof sprinkling');number(roof.flowLpmM2,0,1,'roof flow');number(roof.onSec,0,86400,'roof ON');number(roof.offSec,0,86400,'roof OFF');if(roof.onSec+roof.offSec<=0)fail('roof cycle','both cannot be 0');number(roof.hoursPerDay,0,24,'roof hours');number(roof.pumpPowerKw,0,20,'roof pump');if(!validDailyStartHour(roof.dailyStartHour))fail('roof start','must be in 0–24 in 0.25-hour steps');
  const deviceIds=new Set<string>(),systemIds=new Set<string>(),kinds=new Set<string>();let nozzleCount=0;
  const pose=(d:any,isFan:boolean)=>{
   record(d,'device');id(d.id,'device.id');if(deviceIds.has(d.id))fail('device.id','duplicate ID within a scenario');deviceIds.add(d.id);text(d.label,'device.label');bool(d.enabled,'device.enabled');
   number(d.x,0,t.lengthM,`${d.label}.x`);number(d.y,0,t.widthM,`${d.label}.y`);number(d.heightM,isFan?d.diameterM/2:1.8,4,`${d.label}.height`);number(d.yawDeg,0,360,`${d.label}.yaw`);number(d.pitchDownDeg,isFan?0:30,90,`${d.label}.downward angle`);
   const a=record(d.anchor,'anchor');if(a.zoneId!=='barn'&&!layout.zones.some(z=>z.id===a.zoneId))fail('anchor.zoneId','unknown zone');number(a.u,0,1,'anchor.u');number(a.v,0,1,'anchor.v');
   const xy=positionFromAnchor(d,t as Project['template'],layout);if(Math.abs(xy.x-d.x)>1e-6||Math.abs(xy.y-d.y)>1e-6)fail('anchor','coordinates and anchor do not match');
  };
  for(const f of s.fans){number(f.diameterM,.2,3,'fan diameter');number(f.outletSpeedMps,0,30,'outlet speed');number(f.powerKw,0,20,'fan power');number(f.hoursPerDay,0,24,'fan hours');if(!validDailyStartHour(f.dailyStartHour))fail(`${f.id}.dailyStartHour`,'start must be in 0–24 in 0.25-hour steps');pose(f,true)}
  for(const w of s.waterSystems){record(w,'waterSystem');id(w.id,'waterSystem.id');if(systemIds.has(w.id))fail('waterSystem.id','duplicate');systemIds.add(w.id);if(!['soaker','mist'].includes(w.kind)||kinds.has(w.kind))fail('waterSystem.kind','one system per kind');kinds.add(w.kind);bool(w.enabled,'waterSystem.enabled');number(w.onSec,0,86400,'spray ON sec');number(w.offSec,0,86400,'spray OFF sec');if(w.onSec+w.offSec<=0)fail('spray cycle','ON/OFF cannot both be 0');number(w.hoursPerDay,0,24,'spray hours');if(!validDailyStartHour(w.dailyStartHour))fail('spray start','must be in 0–24 in 0.25-hour steps');number(w.pumpPowerKw,0,20,'pump power');if(!Array.isArray(w.nozzles))fail('nozzles','an array is required');nozzleCount+=w.nozzles.length;for(const n of w.nozzles){number(n.flowLpm,0,20,'nozzle flow');number(n.halfAngleDeg,1,85,'spray half-angle');pose(n,false)}}
  if(nozzleCount>100)fail('nozzles','max 100 nozzles across all systems per scenario');
 }
 if(p.baselineScenarioId!=='baseline'||!ids.has(p.baselineScenarioId)||!ids.has(p.activeScenarioId)||!ids.has('working-soaker')||!ids.has('working-mist'))fail('scenario','invalid scenario IDs or references');
 for(const s of p.scenarios)if(s.readOnly!==(s.id===p.baselineScenarioId))fail('readOnly','only the baseline may be read-only');
 const v=record(p.view,'view');if(!['2d','3d'].includes(v.mode)||!['delta','deficit','speed','temperature'].includes(v.metric))fail('view','invalid display settings');for(const k of ['roof','flow','particles'])bool(v[k],`view.${k}`);
 if(v.analysis!==undefined)bool(v.analysis,'view.analysis');for(const k of ['realistic','heatmap'])if(v[k]!==undefined)bool(v[k],`view.${k}`);if(v.selectedAreaId!==undefined&&v.selectedAreaId!==null)id(v.selectedAreaId,'view.selectedAreaId');
 number(v.timeSec,0,3600,'view.timeSec');
 if(!layout.probes.some(q=>q.id===v.selectedProbeId))fail('selectedProbeId','point does not exist');if(v.selectedDeviceId!==null){id(v.selectedDeviceId,'selectedDeviceId');const s=p.scenarios.find((s:any)=>s.id===p.activeScenarioId);if(!s.fans.concat(s.waterSystems.flatMap((w:any)=>w.nozzles)).some((d:any)=>d.id===v.selectedDeviceId))fail('selectedDeviceId','device does not exist')}
 if(v.camera!==null){const c=record(v.camera,'camera');number(c.azimuth,-100,100,'camera.azimuth');number(c.elevation,.1,1.56,'camera.elevation');number(c.distance,8,160,'camera.distance');if(!Array.isArray(c.target)||c.target.length!==3)fail('camera.target','3 coordinates are required');c.target.forEach((n:any)=>number(n,-100,200,'camera.target'))}
 const prices=record(p.prices,'prices');for(const k of ['electricityYenKwh','waterYenM3'])if(prices[k]!==null)number(prices[k],0,1e6,`prices.${k}`);
 if(!Array.isArray(p.provenance)||p.provenance.length<1||p.provenance.length>30)fail('provenance','evidence/assumptions are required');for(const item of p.provenance){record(item,'provenance');text(item.id,'provenance.id');text(item.note,'provenance.note',3000);if(!['source-based','adapted-reference','design-assumption','derived'].includes(item.classification))fail('provenance.classification','invalid classification');if(item.url!==undefined){text(item.url,'provenance.url',2000);if(!/^https:\/\//.test(item.url))fail('provenance.url','HTTPS only')}}
}
export function parseProject(text:string):Project{
 if(new TextEncoder().encode(text).byteLength>2*1024*1024)fail('JSON','max 2MiB');let p:unknown;try{p=JSON.parse(text)}catch{fail('JSON','Unreadable JSON. The current scenario is kept')}
 // MCP evaluate and result exports carry a full Project under `project`.
 // Only inputs are restored; supplied calculation results are never trusted.
 safeTree(p);
 if(p&&typeof p==='object'&&!Array.isArray(p)&&!Object.hasOwn(p,'schemaVersion')&&Object.hasOwn(p,'project'))p=(p as Record<string,unknown>).project;
 validateProject(p);return p;
}
