import type {Project} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {MODEL} from '../data/defaults.js';
import {DEFAULT_MILK_SIMULATION} from './milk.js';

/** Paths where the project's assumptions differ from the shipped defaults — i.e. a
 *  sensitivity experiment, not the documented/reference coefficients. */
const diffFields=(cur:Record<string,unknown>,def:Record<string,unknown>,prefix:string,skip:readonly string[]=[])=>
 Object.keys(def).filter(k=>!skip.includes(k)&&JSON.stringify(cur[k])!==JSON.stringify(def[k]))
 .map(k=>`${prefix}.${k}=${JSON.stringify(cur[k])}（既定 ${JSON.stringify(def[k])}）`);

/** Structured, LLM-facing description of what the simulation computes and assumes.
 *  Values are read from the supplied project so they stay truthful after
 *  update_model/update_milk edits or evaluate runs — modifiedFromDefaults marks
 *  which coefficients are no longer the documented defaults.
 *  Kept next to the model so the MCP `describe_model` tool and tests share one source.
 *  Reference docs: reference/thermal/MODEL.md (v0.5 heat), docs/MILK_HEAT_MODEL_V0_1.md (daily milk). */
export function describeModel(p:Project){
 const l=buildLayout(p.template),m=p.model,roof=m.roof,ms=p.milkSimulation,occ=ms.occupancyFractions;
 const stall=l.probes.filter(q=>q.kind==='stall').length;
 const feed=l.probes.filter(q=>q.kind==='feeding').length;
 const wait=l.probes.filter(q=>q.kind==='waiting').length;
 const hours=(f:number)=>`${Math.round(f*240)/10}h`;
 const modifiedFromDefaults=[
  ...diffFields(m as unknown as Record<string,unknown>,MODEL as unknown as Record<string,unknown>,'model',['version','roof','profiles']),
  ...diffFields(roof as unknown as Record<string,unknown>,MODEL.roof as unknown as Record<string,unknown>,'model.roof',['version']),
  ...m.profiles.flatMap(pr=>{const d=MODEL.profiles.find(x=>x.id===pr.id);return d?diffFields(pr as unknown as Record<string,unknown>,d as unknown as Record<string,unknown>,`model.profiles.${pr.id}`,['id','name']):[`model.profiles.${pr.id}: 既定セットに存在しないプロファイル`]}),
  ...diffFields(ms as unknown as Record<string,unknown>,DEFAULT_MILK_SIMULATION as unknown as Record<string,unknown>,'milkSimulation',['modelId','mode','weatherMode','operationPolicy','assumptionClass']),
 ];
 return {
  modelVersion:p.model.version,
  roofModel:p.model.roof.version,
  milkModel:p.milkSimulation.modelId,
  purpose:'設備配置・屋根条件・共通気象を変え、代表牛の正味放熱量・不足・資源消費を案（scenario）間で比較する縮約モデル。実牛舎の温度・乳量・受胎の確定予測やCFDではない',
  timeBase:'60分試行を1秒刻みで積分。設備はONから開始、保持水は0から開始。日乳量は別途24時間の代表日集計（warmup→評価日）。timeSecの再生は表示のみで物理を変えない',
  space:{
   barn:`長さ${p.template.lengthM}m×幅${p.template.widthM}m、軒4.0m・棟8.7mの切妻`,
   probes:`${l.probes.length}個の独立した代表地点（牛床${stall}・採食${feed}・待機${wait}）。各地点は「そこに1頭いる牛」の独立した比較で、同時存在の頭数負荷を牛舎収支へ合算・フィードバックしない`,
  },
  inputs:{
   environment:'共通気象 temperatureC/relativeHumidityPct/pressurePa/backgroundSpeedMps/ventilationM3sPerM2/solarRoofWm2。update_environmentは全案に効く',
   roof:'reflectance日射反射率/insulationM断熱厚さ/sprayEnabled散水・flowLpmM2・onSec/offSec周期/hoursPerDay日運転・dailyStartHour開始時刻/pumpPowerKw',
   fan:'x,y,heightM位置・yawDeg,pitchDownDeg向き・diameterM/outletSpeedMps/powerKw・運転予定',
   nozzle:'kind=soaker(牛体に濡れる)/mist(空気蒸発)、flowLpm/halfAngleDeg・運転予定。所属はwaterSystems(kind別)の系統設定に従う',
  },
  computation:[
   '屋根: 日射・反射・熱抵抗・内外対流/線形放射・散水の水分収支で外面/下面/舎内気温/輻射温度を秒積算',
   `風: 背景風速+各ファンの噴流をレイキャスト(256/1024線)で重ね、拡散kSpread=${m.kSpread}・減衰kDecay=${m.kDecay}で地点風速へ。ファン運転予定の短時間運転は60分平均に反映`,
   `ソーカー: 捕捉率で牛体保持水へ溜め、蒸発・結露・流出を台帳化(保持水上限はプロファイルのmaxFilmKg)`,
   'ミスト: 供給量と蒸発作用は別指標。湿度飽和で蒸発・冷却は止まる',
   `牛体収支: 対流(hc=${m.hcIntercept}+${m.hcSlope}×√v)+放射+基礎蒸発+ソーカー蒸発+結露(負)を秒ごとに計算し3600秒平均=meanQrefW`,
   `空気: 顕熱・潜熱を1つの集中気塊として集約。換気量${p.environment.ventilationM3sPerM2}m³/s/m²×床面積、背景顕熱${roof.backgroundSensibleW}W`,
   `日集計: 代表地点へ滞在時間の重み(牛床${hours(occ.stall)}/採食${hours(occ.feeding)}/その他${hours(occ.waiting)})を掛け、放熱不足を24時間積算して乳量仮説へ接続`,
   `日気象: dailyWeather.mode="hourly"なら0〜23時の行で気温・湿度・屋根面日射を時刻別に供給し、日シミュレーションの屋根熱収支・空気・地点放熱へ反映（気象区切りで屋根・熱項キャッシュを無効化）。"constant"はenvironmentを全日固定`,
  ],
  outputs:{
   meanQrefW:'地点の正味放熱量[W]。components内訳=convectionW/radiationW/baseEvaporationW/soakerEvaporationW/condensationW',
   deltaQrefW:'基準案の同地点との放熱差[W]。正=改善',
   meanDeficitW:`秒ごとのmax(0, Qref−Q)を積算した60分平均[W]。Qref=${ms.referenceCoolingWPerCow}Wは仮定値`,
   'action系':'fanActionFraction/soakerArrivalFraction/mistEvaporationActionFraction=作用した時間割合、mistSupplyFraction=供給割合(蒸発とは別)',
   meanFilmKg:'保持水の平均質量。film台帳=captured/condensed/evaporated/runoff/final/maxResidual',
   resources:'系統別・合計のwaterLPerDay/fanKwhPerDay/pumpKwhPerDay/totalKwhPerDay。trialWaterL/trialKwhは60分試行分',
   roof:'meanOuterC/meanUnderC/meanAirC/meanRadiantCと散水収支suppliedL/evaporatedKg/runoffL',
   dailyMilk:'仮説モデルの日乳量。Y=Y0−min(Y0×maxLossFraction, beta×不足積算E)。resourcesは日集計の水量・電力量',
   dailyThermal:'評価日(24h)の地点別・区画別平均（meanDeficitW/meanQrefW/気温/風速/湿度/放熱内訳/作用割合）。weatherModeで使用気象を明示。不足は秒ごとにmax(0,Qref−Q)で積算（日平均を後で切るのではない）',
  },
  keyAssumptions:{
   referenceCoolingWPerCow:ms.referenceCoolingWPerCow,
   cow:`体表${m.surfaceTemperatureC}℃固定・有効面積${m.areaM2}m²・濡れ面積${m.wetAreaM2}m²・基礎濡れ割合${m.baseWetFraction}・放射率${m.emissivity}・牛→屋根形態係数${roof.viewFactor}`,
   roof:`熱抵抗${roof.bareResistance}m²K/W・熱伝導率${roof.conductivity}W/mK・外対流${roof.hOutConv}・外放射${roof.hOutRad}・内対流${roof.hInConv}・内放射${roof.hInRad}W/m²K・保水容量${roof.waterCapacityKgM2}kg/m²`,
   air:`換気量${p.environment.ventilationM3sPerM2}m³/s/m²×床面積、背景顕熱${roof.backgroundSensibleW}W、壁・床の放射背景温度=外気`,
   milk:`Y0=${ms.potentialMilkKgPerCowDay}kg, beta=${ms.responseKgPerCowDayPerW}kg/頭/日/W, 損失上限${Math.round(ms.maxLossFraction*1000)/10}%, 遅れ${ms.lagWeights.join('/')}, 滞在=牛床${hours(occ.stall)}/採食${hours(occ.feeding)}/その他${hours(occ.waiting)}, warmup${ms.warmupDurationSec/3600}h+評価${ms.evaluationDurationSec/3600}h・刻み${ms.timeStepSec}s — 回帰係数ではなくdemo_assumption`,
   profiles:`感度の幅であって95%信頼区間ではない。現在値: ${m.profiles.map(pr=>`${pr.id}(出口×${pr.outletMultiplier},hc×${pr.hcMultiplier},ミスト効率${pr.mistEfficiency},保持水上限${pr.maxFilmKg}kg)`).join(' / ')}`,
  },
  modifiedFromDefaults,
  modifiedNote:'modifiedFromDefaultsに列がある場合、その係数は文書化された既定値から変更された感度実験値(update_model/update_milk経由)。既定モデルへの検証・出典はその変更値へは適用されない',
  limits:[
   '代表地点の値であって面内全域やCFD解ではない。区画平均は地点の単純平均(滞在・頭数加重ではない)',
   '牛体散水の水蒸気は舎内湿度へ戻さない仮定(結果warningsにも明記)',
   '屋根の放射・日射・散水はモデル仮定の縮約。実測校正なし',
   '日乳量・受胎は別の仮説/参照モデルで熱結果の延長ではない。W→THI→深部体温の換算はしない',
   'null/invalid/未計算は0と別物。有効点が1つでも欠けると区画平均は未評価',
   '完全に不足0は、設備の冷却能力が外気条件を超えられない場合は到達しない',
  ],
  validation:'reference/thermal(v0.5 Python参照との数値一致テスト V08-PY*)、reference/fertility(v0.7)。モデル式・係数はこれらで固定',
  docs:['reference/thermal/MODEL.md','docs/MILK_HEAT_MODEL_V0_1.md','docs/cooling_planner_decisions_v0_6.md','docs/DECISIONS_v0_8.md'],
 };
}
