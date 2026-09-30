import type {Project,Model,Scenario,Fan,Nozzle,WaterSystem} from '../domain/project.js';
import {buildLayout,anchorPose} from '../template/layout.js';
import {DEFAULT_MILK_SIMULATION} from '../model/milk.js';
export const APP_VERSION='0.10.0-preview.1';
export const MODEL:Model={version:'cooling-integrated-v0.10',roof:{version:'cooling-thermal-v0.5-assumptions-1',backgroundSensibleW:10000,bareResistance:.02,conductivity:.035,hOutConv:10,hOutRad:5,hInConv:3,hInRad:5,viewFactor:.35,waterCapacityKgM2:.05},surfaceTemperatureC:35,areaM2:4.5,wetAreaM2:2,patchLengthM:2,patchWidthM:.6,baseWetFraction:.06,emissivity:.95,radiantOffsetC:2,kSpread:.1,kDecay:4,latentHeatJkg:2430000,airDensityKgM3:1.2,airCpJkgK:1006,vaporGasConstant:461.5,hcIntercept:3.5,hcSlope:4,profiles:[
 {id:'low',name:'低値側の仮定',outletMultiplier:.8,hcMultiplier:.8,mistEfficiency:.4,maxFilmKg:.15},
 {id:'reference',name:'基準の仮定',outletMultiplier:1,hcMultiplier:1,mistEfficiency:.6,maxFilmKg:.3},
 {id:'high',name:'高値側の仮定',outletMultiplier:1.2,hcMultiplier:1.2,mistEfficiency:.8,maxFilmKg:.45}
]};
export function createProject():Project{
 const template:Project['template']={id:'fs-amr1-50-guided-reference',version:1,lengthM:36.4,widthM:23.5,eaveHeightM:4,ridgeHeightM:8.7},layout=buildLayout(template);
 const fans:Fan[]=[];
 for(const zoneId of ['feeding','stall-A','stall-B','stall-C','stall-D']){
  const z=layout.zones.find(z=>z.id===zoneId)!;
  for(const [i,u]of [.1,.6].entries())fans.push({id:`fan-${zoneId}-${i+1}`,label:`${z.name} ファン ${i+1}`,enabled:true,x:z.x+u*z.widthM,y:z.y+z.depthM/2,heightM:3,yawDeg:0,pitchDownDeg:10,diameterM:1,outletSpeedMps:5,powerKw:.4,hoursPerDay:16,dailyStartHour:8,anchor:{zoneId,u,v:.5}});
 }
 const waterSystems:WaterSystem[]=(['soaker','mist'] as const).map(kind=>({id:`water-${kind}`,kind,enabled:kind==='soaker',onSec:kind==='soaker'?120:60,offSec:kind==='soaker'?600:240,hoursPerDay:8,dailyStartHour:8,pumpPowerKw:kind==='soaker'?.25:1,nozzles:layout.probes.filter(p=>p.kind==='feeding').map((p,i):Nozzle=>({id:`${kind}-${i+1}`,label:`${kind==='soaker'?'ソーカー':'ミスト'} ${i+1}`,enabled:true,x:p.x,y:p.y,heightM:2.5,yawDeg:0,pitchDownDeg:90,halfAngleDeg:kind==='soaker'?25:60,flowLpm:kind==='soaker'?1.3:.1,anchor:anchorPose(p,template,layout)}))}));
 const baseline:Scenario={id:'baseline',name:'基準案',readOnly:true,roof:{reflectance:.2,insulationM:0,sprayEnabled:false,flowLpmM2:.05,onSec:120,offSec:480,hoursPerDay:8,dailyStartHour:8,pumpPowerKw:.25},fans,waterSystems};
 const soaker:Scenario={...structuredClone(baseline),id:'working-soaker',name:'編集案 A',readOnly:false};
 const mist:Scenario={...structuredClone(baseline),id:'working-mist',name:'編集案 B',readOnly:false};
 mist.waterSystems.forEach(w=>w.enabled=w.kind==='mist');
 return {schemaVersion:10,dailyWeather:{mode:'constant',hours:[]},references:{milkModel:'milk-table-cowbell178-v1',baselineMilkKgPerDay:35,fertility:{model:'fertility-thi-period-or-baccouri2025-v1',p0:.4,mode:'manual',exposureAssumed:true,temperatureC:26,relativeHumidityPct:70,profileVersion:1}},milkSimulation:structuredClone(DEFAULT_MILK_SIMULATION),appVersion:APP_VERSION,template,environment:{temperatureC:32,relativeHumidityPct:70,pressurePa:101325,backgroundSpeedMps:.2,ventilationM3sPerM2:.015,solarRoofWm2:800},model:structuredClone(MODEL),baselineScenarioId:'baseline',activeScenarioId:'working-soaker',scenarios:[baseline,soaker,mist],view:{mode:'3d',metric:'deficit',timeSec:0,selectedProbeId:'feed-07',selectedDeviceId:null,roof:false,flow:true,particles:true,camera:null,analysis:false,selectedAreaId:null},prices:{electricityYenKwh:27,waterYenM3:300},provenance:[
 {id:'dimensions',classification:'adapted-reference',note:'原事例36.4×23.5m・70頭の外形を参考に、内部を50床の独自配置へ変更。設計推奨ではない。',url:'https://holstein.pl/nowoczesna-obora-w-gospodarstwie-rodzinnym/'},
 {id:'layout',classification:'adapted-reference',note:'採食・休息・搾乳の区画関係を参考にした独自配置。原図やメーカー3Dデータは同梱しない。',url:'https://www.orionkikai.co.jp/rakuno/how_to/auto-milking-system/'},
 {id:'psychrometrics',classification:'source-based',note:'SIの飽和蒸気圧・湿度比・エンタルピー・比体積の関係。仮換気量の妥当性を保証するものではない。',url:'https://psychrometrics.github.io/psychrolib/api_docs.html'},
 {id:'milk',classification:'source-based',note:'全酪連COWBELL No.178（2025年10月）p.6の送風体感温度式、p.8の乳量表。日本飼養標準2017・柴田ら1984の抜粋。乳量は掲載6条件・RH60〜70%のみ。'},
 {id:'milk-daily',classification:'design-assumption',note:'乳量仮説モデル milk-heat-deficit-v0.1 の係数は demo_assumption に相当する仮定。Y0=40kg、Qref=630W、beta=0.010、上限25%、遅れ0.2/0.5/0.3、滞在14/6/4時間相当。文献からの回帰係数ではなく、信頼区間でもない。'},
 {id:'roof',classification:'design-assumption',note:'屋根の係数と背景熱は熱モデルv0.5の固定仮定。遮熱反射率0.7・断熱20mm。放射・風・散水の効果をTHIや深部体温へ換算しない。'},
 {id:'fertility',classification:'source-based',note:'Baccouri et al. (2025) Table 2の5期間OR。仮の基準確率40%。屋外THIから局所THIへの適用はアプリの追加仮定。',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC12249091/'},
 {id:'model',classification:'design-assumption',note:'風速曲線、熱伝達係数、体表35℃、面積4.5m²、換気量、蒸発率、保持水量は仕様v0.4の実装仮定。現場未検証。'},
 {id:'calculation',classification:'derived',note:'70地点は独立試行。放熱Wを牛群へ合算しない。日乳量は仮説モデルv0.1の牛群平均、受胎は別の52日代表シナリオ。乳量の掲載表は資料として保持。'}
 ]};
}
