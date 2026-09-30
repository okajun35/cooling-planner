import type {Project,Model,Scenario,Fan,Nozzle,WaterSystem} from '../domain/project.js';
import {buildLayout,anchorPose} from '../template/layout.js';
import {DEFAULT_MILK_SIMULATION} from '../model/milk.js';
export const APP_VERSION='0.10.0-preview.1';
export const MODEL:Model={version:'cooling-integrated-v0.10',roof:{version:'cooling-thermal-v0.5-assumptions-1',backgroundSensibleW:10000,bareResistance:.02,conductivity:.035,hOutConv:10,hOutRad:5,hInConv:3,hInRad:5,viewFactor:.35,waterCapacityKgM2:.05},surfaceTemperatureC:35,areaM2:4.5,wetAreaM2:2,patchLengthM:2,patchWidthM:.6,baseWetFraction:.06,emissivity:.95,radiantOffsetC:2,kSpread:.1,kDecay:4,latentHeatJkg:2430000,airDensityKgM3:1.2,airCpJkgK:1006,vaporGasConstant:461.5,hcIntercept:3.5,hcSlope:4,profiles:[
 {id:'low',name:'Low-side assumption',outletMultiplier:.8,hcMultiplier:.8,mistEfficiency:.4,maxFilmKg:.15},
 {id:'reference',name:'Reference assumption',outletMultiplier:1,hcMultiplier:1,mistEfficiency:.6,maxFilmKg:.3},
 {id:'high',name:'High-side assumption',outletMultiplier:1.2,hcMultiplier:1.2,mistEfficiency:.8,maxFilmKg:.45}
]};
export function createProject():Project{
 const template:Project['template']={id:'fs-amr1-50-guided-reference',version:1,lengthM:36.4,widthM:23.5,eaveHeightM:4,ridgeHeightM:8.7},layout=buildLayout(template);
 const fans:Fan[]=[];
 for(const zoneId of ['feeding','stall-A','stall-B','stall-C','stall-D']){
  const z=layout.zones.find(z=>z.id===zoneId)!;
  for(const [i,u]of [.1,.6].entries())fans.push({id:`fan-${zoneId}-${i+1}`,label:`${z.name} fan ${i+1}`,enabled:true,x:z.x+u*z.widthM,y:z.y+z.depthM/2,heightM:3,yawDeg:0,pitchDownDeg:10,diameterM:1,outletSpeedMps:5,powerKw:.4,hoursPerDay:16,dailyStartHour:8,anchor:{zoneId,u,v:.5}});
 }
 const waterSystems:WaterSystem[]=(['soaker','mist'] as const).map(kind=>({id:`water-${kind}`,kind,enabled:kind==='soaker',onSec:kind==='soaker'?120:60,offSec:kind==='soaker'?600:240,hoursPerDay:8,dailyStartHour:8,pumpPowerKw:kind==='soaker'?.25:1,nozzles:layout.probes.filter(p=>p.kind==='feeding').map((p,i):Nozzle=>({id:`${kind}-${i+1}`,label:`${kind==='soaker'?'Soaker':'Mist'} ${i+1}`,enabled:true,x:p.x,y:p.y,heightM:2.5,yawDeg:0,pitchDownDeg:90,halfAngleDeg:kind==='soaker'?25:60,flowLpm:kind==='soaker'?1.3:.1,anchor:anchorPose(p,template,layout)}))}));
 const baseline:Scenario={id:'baseline',name:'Baseline',readOnly:true,roof:{reflectance:.2,insulationM:0,sprayEnabled:false,flowLpmM2:.05,onSec:120,offSec:480,hoursPerDay:8,dailyStartHour:8,pumpPowerKw:.25},fans,waterSystems};
 const soaker:Scenario={...structuredClone(baseline),id:'working-soaker',name:'Draft A',readOnly:false};
 const mist:Scenario={...structuredClone(baseline),id:'working-mist',name:'Draft B',readOnly:false};
 mist.waterSystems.forEach(w=>w.enabled=w.kind==='mist');
 return {schemaVersion:10,dailyWeather:{mode:'constant',hours:[]},references:{milkModel:'milk-table-cowbell178-v1',baselineMilkKgPerDay:35,fertility:{model:'fertility-thi-period-or-baccouri2025-v1',p0:.4,mode:'manual',exposureAssumed:true,temperatureC:26,relativeHumidityPct:70,profileVersion:1}},milkSimulation:structuredClone(DEFAULT_MILK_SIMULATION),appVersion:APP_VERSION,template,environment:{temperatureC:32,relativeHumidityPct:70,pressurePa:101325,backgroundSpeedMps:.2,ventilationM3sPerM2:.015,solarRoofWm2:800},model:structuredClone(MODEL),baselineScenarioId:'baseline',activeScenarioId:'working-soaker',scenarios:[baseline,soaker,mist],view:{mode:'3d',metric:'deficit',timeSec:0,selectedProbeId:'feed-07',selectedDeviceId:null,roof:false,flow:true,particles:true,camera:null,analysis:false,selectedAreaId:null},prices:{electricityYenKwh:27,waterYenM3:300},provenance:[
 {id:'dimensions',classification:'adapted-reference',note:'Outer dimensions (36.4×23.5 m, 70 cows) adapted from the reference barn; the interior was rearranged into an original 50-stall layout. Not a design recommendation.',url:'https://holstein.pl/nowoczesna-obora-w-gospodarstwie-rodzinnym/'},
 {id:'layout',classification:'adapted-reference',note:'Original layout informed by the spatial relation of feeding, resting and milking zones. No original drawings or manufacturer 3D data are bundled.',url:'https://www.orionkikai.co.jp/rakuno/how_to/auto-milking-system/'},
 {id:'psychrometrics',classification:'source-based',note:'SI relations of saturation vapour pressure, humidity ratio, enthalpy and specific volume. Does not guarantee the assumed ventilation rate is sound.',url:'https://psychrometrics.github.io/psychrolib/api_docs.html'},
 {id:'milk',classification:'source-based',note:'Fan-aided feels-like formula from JDLA COWBELL No.178 (Oct 2025) p.6 and the milk table on p.8. Excerpt from Japanese Feeding Standard 2017 and Shibata et al. 1984. Milk covers only the 6 published conditions at RH 60–70%.'},
 {id:'milk-daily',classification:'design-assumption',note:'Coefficients of the milk hypothesis model milk-heat-deficit-v0.1 are demo_assumption-grade assumptions: Y0=40kg, Qref=630W, beta=0.010, cap 25%, lag 0.2/0.5/0.3, occupancy 14/6/4 h equivalent. Neither a literature regression nor a confidence interval.'},
 {id:'roof',classification:'design-assumption',note:'Roof coefficients and background heat are fixed assumptions of thermal model v0.5: reflective coating reflectance 0.7, insulation 20mm. Radiation, wind and spray effects are not converted to THI or core body temperature.'},
 {id:'fertility',classification:'source-based',note:'5-period OR from Baccouri et al. (2025) Table 2. Hypothetical baseline probability 40%. Applying outdoor THI to local THI is an added assumption of this app.',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC12249091/'},
 {id:'model',classification:'design-assumption',note:'Wind-speed curve, heat-transfer coefficient, skin 35°C, area 4.5m², ventilation, evaporation rate and film capacity are implementation assumptions of spec v0.4. Not validated in the field.'},
 {id:'calculation',classification:'derived',note:'The 70 points are independent trials; heat loss (W) is not summed over the herd. Daily milk is the herd mean of hypothesis model v0.1; conception is a separate 52-day representative scenario. The published milk table is kept as reference material.'}
 ]};
}
