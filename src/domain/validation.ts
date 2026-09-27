import type {Project,Device,Pose} from './project.js';
import {buildLayout,positionFromAnchor} from '../template/layout.js';
import {MODEL} from '../data/defaults.js';
const fail=(path:string,message:string):never=>{throw new Error(`${path}: ${message}`)};
const record=(v:unknown,path:string):Record<string,any>=>{if(v===null||typeof v!=='object'||Array.isArray(v))fail(path,'オブジェクトが必要です');return v as Record<string,any>};
const number=(v:unknown,lo:number,hi:number,path:string)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)fail(path,`${lo}〜${hi}の有限数が必要です`)};
const bool=(v:unknown,path:string)=>{if(typeof v!=='boolean')fail(path,'true/falseが必要です')};
const text=(v:unknown,path:string,max=160)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail(path,'文字列が不正です')};
const id=(v:unknown,path:string)=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_.-]{1,90}$/.test(v))fail(path,'IDが不正です')};
function safeTree(v:unknown,depth=0){if(depth>24)fail('JSON','階層が深すぎます');if(v&&typeof v==='object'){if(Array.isArray(v)&&v.length>2000)fail('JSON','配列が大きすぎます');for(const [k,x]of Object.entries(v)){if(['__proto__','prototype','constructor'].includes(k))fail('JSON','禁止されたキーです');safeTree(x,depth+1)}}}
export function validateProject(input:unknown):asserts input is Project{
 safeTree(input);const p=record(input,'Project');
 if(p.schemaVersion!==8)fail('schemaVersion','この提出版では旧形式・未知の形式は未対応です。現在の案は保持します');
 text(p.appVersion,'appVersion',80);const t=record(p.template,'template');
 if(t.id!=='fs-amr1-50-guided-reference'||t.version!==1)fail('template','対応していないテンプレートです');
 number(t.lengthM,32,48,'牛舎の長さ');number(t.widthM,23.5,30,'牛舎の幅');if(t.eaveHeightM!==4||t.ridgeHeightM!==8.7)fail('屋根','本版は軒4m・棟8.7m固定です');
 const e=record(p.environment,'environment');number(e.temperatureC,20,40,'気温');number(e.relativeHumidityPct,0,100,'湿度');number(e.pressurePa,50000,110000,'気圧');number(e.backgroundSpeedMps,0,10,'背景風速');number(e.ventilationM3sPerM2,.0001,1,'換気量');
 number(e.solarRoofWm2,0,1200,'屋根面日射');
 const m=record(p.model,'model');if(m.version!==MODEL.version)fail('model','未対応のモデル版です');
 for(const [key,value]of Object.entries(MODEL))if(typeof value==='number')number(m[key],key==='radiantOffsetC'?-20:0,key==='latentHeatJkg'?5e6:key==='vaporGasConstant'?1000:key==='airCpJkgK'?10000:100,`model.${key}`);
 if(m.areaM2<=0||m.wetAreaM2>m.areaM2||m.baseWetFraction>1||m.emissivity>1||m.kDecay<=0||m.airDensityKgM3<=0||m.airCpJkgK<=0||m.vaporGasConstant<=0||m.patchLengthM<=0||m.patchWidthM<=0)fail('model','面積・係数の関係が不正です');
 const rm=record(m.roof,'model.roof');if(rm.version!==MODEL.roof.version)fail('roof.model','未対応の屋根モデルです');for(const [k,value] of Object.entries(MODEL.roof))if(typeof value==='number'){number(rm[k],0,k==='backgroundSensibleW'?1e6:100,`roof.${k}`);if(k!=='backgroundSensibleW'&&k!=='viewFactor'&&rm[k]<=0)fail('roof','係数は正数です')}if(rm.viewFactor>1)fail('roof.viewFactor','0〜1です');
 const refs=record(p.references,'references');if(refs.milkModel!=='milk-table-cowbell178-v1')fail('references','未対応の乳量表');if(refs.baselineMilkKgPerDay!==null)number(refs.baselineMilkKgPerDay,0,100,'基準乳量');const f=record(refs.fertility,'references.fertility');if(f.model!=='fertility-thi-period-or-baccouri2025-v1'||f.profileVersion!==1)fail('fertility','未対応モデル');number(f.p0,.001,.999,'基準受胎率');if(!['manual','simulation'].includes(f.mode))fail('fertility.mode','未対応入力');bool(f.exposureAssumed,'fertility.exposureAssumed');number(f.temperatureC,-20,50,'代表気温');number(f.relativeHumidityPct,0,100,'代表湿度');
 if(!Array.isArray(m.profiles)||m.profiles.length!==3)fail('model.profiles','3プロファイルが必要です');
 const profileIds=new Set<string>();for(const x of m.profiles){record(x,'profile');if(!['low','reference','high'].includes(x.id)||profileIds.has(x.id))fail('profile.id','重複または未知のID');profileIds.add(x.id);text(x.name,'profile.name');number(x.outletMultiplier,.01,5,'outletMultiplier');number(x.hcMultiplier,.01,5,'hcMultiplier');number(x.mistEfficiency,0,1,'mistEfficiency');number(x.maxFilmKg,.001,5,'maxFilmKg')}
 if(!Array.isArray(p.scenarios)||p.scenarios.length!==3)fail('scenarios','基準と2編集案が必要です');
 const layout=buildLayout(t as Project['template']),ids=new Set<string>();
 for(const s of p.scenarios){
  record(s,'scenario');id(s.id,'scenario.id');if(ids.has(s.id))fail('scenario.id','重複しています');ids.add(s.id);text(s.name,'scenario.name');bool(s.readOnly,'readOnly');
  if(!Array.isArray(s.fans)||s.fans.length>40)fail('fans','最大40台です');if(!Array.isArray(s.waterSystems)||s.waterSystems.length!==2)fail('waterSystems','ソーカーとミストの2系統が必要です');
  const roof=record(s.roof,'scenario.roof');number(roof.reflectance,0,1,'屋根反射率');number(roof.insulationM,0,.1,'断熱材厚さ');bool(roof.sprayEnabled,'屋根散水');number(roof.flowLpmM2,0,1,'屋根流量');number(roof.onSec,0,86400,'屋根ON');number(roof.offSec,0,86400,'屋根OFF');if(roof.onSec+roof.offSec<=0)fail('屋根周期','両方0は不可');number(roof.hoursPerDay,0,24,'屋根運転時間');number(roof.pumpPowerKw,0,20,'屋根ポンプ');
  const deviceIds=new Set<string>(),systemIds=new Set<string>(),kinds=new Set<string>();let nozzleCount=0;
  const pose=(d:any,isFan:boolean)=>{
   record(d,'device');id(d.id,'device.id');if(deviceIds.has(d.id))fail('device.id','案内でIDが重複しています');deviceIds.add(d.id);text(d.label,'device.label');bool(d.enabled,'device.enabled');
   number(d.x,0,t.lengthM,`${d.label}.x`);number(d.y,0,t.widthM,`${d.label}.y`);number(d.heightM,isFan?d.diameterM/2:1.8,4,`${d.label}.高さ`);number(d.yawDeg,0,360,`${d.label}.向き`);number(d.pitchDownDeg,isFan?0:30,90,`${d.label}.下向き角`);
   const a=record(d.anchor,'anchor');if(a.zoneId!=='barn'&&!layout.zones.some(z=>z.id===a.zoneId))fail('anchor.zoneId','未知のゾーンです');number(a.u,0,1,'anchor.u');number(a.v,0,1,'anchor.v');
   const xy=positionFromAnchor(d,t as Project['template'],layout);if(Math.abs(xy.x-d.x)>1e-6||Math.abs(xy.y-d.y)>1e-6)fail('anchor','座標とアンカーが一致していません');
  };
  for(const f of s.fans){number(f.diameterM,.2,3,'ファン径');number(f.outletSpeedMps,0,30,'出口風速');number(f.powerKw,0,20,'ファン電力');number(f.hoursPerDay,0,24,'ファン運転時間');pose(f,true)}
  for(const w of s.waterSystems){record(w,'waterSystem');id(w.id,'waterSystem.id');if(systemIds.has(w.id))fail('waterSystem.id','重複');systemIds.add(w.id);if(!['soaker','mist'].includes(w.kind)||kinds.has(w.kind))fail('waterSystem.kind','方式は各1系統です');kinds.add(w.kind);bool(w.enabled,'waterSystem.enabled');number(w.onSec,0,86400,'散水ON秒');number(w.offSec,0,86400,'散水OFF秒');if(w.onSec+w.offSec<=0)fail('散水周期','ON/OFFの両方0は不可');number(w.hoursPerDay,0,24,'散水運転時間');number(w.pumpPowerKw,0,20,'ポンプ電力');if(!Array.isArray(w.nozzles))fail('nozzles','配列が必要です');nozzleCount+=w.nozzles.length;for(const n of w.nozzles){number(n.flowLpm,0,20,'ノズル流量');number(n.halfAngleDeg,1,85,'噴霧半角');pose(n,false)}}
  if(nozzleCount>100)fail('nozzles','各案の全系統合計で最大100個です');
 }
 if(p.baselineScenarioId!=='baseline'||!ids.has(p.baselineScenarioId)||!ids.has(p.activeScenarioId)||!ids.has('working-soaker')||!ids.has('working-mist'))fail('scenario','案ID・参照先が不正です');
 for(const s of p.scenarios)if(s.readOnly!==(s.id===p.baselineScenarioId))fail('readOnly','基準だけを読取専用にしてください');
 const v=record(p.view,'view');if(!['2d','3d'].includes(v.mode)||!['delta','speed','temperature'].includes(v.metric))fail('view','表示設定が不正です');for(const k of ['roof','flow','particles'])bool(v[k],`view.${k}`);
 number(v.timeSec,0,3600,'view.timeSec');
 if(!layout.probes.some(q=>q.id===v.selectedProbeId))fail('selectedProbeId','地点がありません');if(v.selectedDeviceId!==null){id(v.selectedDeviceId,'selectedDeviceId');const s=p.scenarios.find((s:any)=>s.id===p.activeScenarioId);if(!s.fans.concat(s.waterSystems.flatMap((w:any)=>w.nozzles)).some((d:any)=>d.id===v.selectedDeviceId))fail('selectedDeviceId','設備がありません')}
 if(v.camera!==null){const c=record(v.camera,'camera');number(c.azimuth,-100,100,'camera.azimuth');number(c.elevation,.1,1.56,'camera.elevation');number(c.distance,8,160,'camera.distance');if(!Array.isArray(c.target)||c.target.length!==3)fail('camera.target','3座標が必要です');c.target.forEach((n:any)=>number(n,-100,200,'camera.target'))}
 const prices=record(p.prices,'prices');for(const k of ['electricityYenKwh','waterYenM3'])if(prices[k]!==null)number(prices[k],0,1e6,`prices.${k}`);
 if(!Array.isArray(p.provenance)||p.provenance.length<1||p.provenance.length>30)fail('provenance','根拠・仮定が必要です');for(const item of p.provenance){record(item,'provenance');text(item.id,'provenance.id');text(item.note,'provenance.note',3000);if(!['source-based','adapted-reference','design-assumption','derived'].includes(item.classification))fail('provenance.classification','分類が不正です');if(item.url!==undefined){text(item.url,'provenance.url',2000);if(!/^https:\/\//.test(item.url))fail('provenance.url','HTTPSのみです')}}
}
export function parseProject(text:string):Project{
 if(new TextEncoder().encode(text).byteLength>2*1024*1024)fail('JSON','最大2MiBです');let p:unknown;try{p=JSON.parse(text)}catch{fail('JSON','読めないJSONです。現在の案は保持します')}
 validateProject(p);return p;
}
