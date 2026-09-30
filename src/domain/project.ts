/** All coordinates: x = barn length, y = barn width; heightM = elevation. */
export type Vec3 = [number, number, number];
export interface Template {id:'fs-amr1-50-guided-reference';version:1;lengthM:number;widthM:number;eaveHeightM:4;ridgeHeightM:8.7}
export interface Environment {temperatureC:number;relativeHumidityPct:number;pressurePa:number;backgroundSpeedMps:number;ventilationM3sPerM2:number;solarRoofWm2:number}
/** Representative-day hourly weather. `hour` is the 0-23 clock hour; the same 24
 * rows repeat on the warmup and evaluation days. Constant mode ignores `hours`. */
export interface DailyWeatherHour {hour:number;temperatureC:number;relativeHumidityPct:number;solarRoofWm2:number}
export interface DailyWeather {mode:'constant'|'hourly';hours:DailyWeatherHour[]}
export interface Pose {x:number;y:number;heightM:number;yawDeg:number;pitchDownDeg:number;anchor:{zoneId:string;u:number;v:number}}
export interface Fan extends Pose {id:string;label:string;enabled:boolean;diameterM:number;outletSpeedMps:number;powerKw:number;hoursPerDay:number;dailyStartHour:number}
export interface Nozzle extends Pose {id:string;label:string;enabled:boolean;flowLpm:number;halfAngleDeg:number}
export interface WaterSystem {id:string;kind:'soaker'|'mist';enabled:boolean;onSec:number;offSec:number;hoursPerDay:number;dailyStartHour:number;pumpPowerKw:number;nozzles:Nozzle[]}
export interface Scenario {id:string;name:string;readOnly:boolean;roof:RoofSettings;fans:Fan[];waterSystems:WaterSystem[]}
export interface Profile {id:string;name:string;outletMultiplier:number;hcMultiplier:number;mistEfficiency:number;maxFilmKg:number}
export interface Model {version:'cooling-integrated-v0.10';roof:RoofModel;surfaceTemperatureC:number;areaM2:number;wetAreaM2:number;patchLengthM:number;patchWidthM:number;baseWetFraction:number;emissivity:number;radiantOffsetC:number;kSpread:number;kDecay:number;latentHeatJkg:number;airDensityKgM3:number;airCpJkgK:number;vaporGasConstant:number;hcIntercept:number;hcSlope:number;profiles:Profile[]}
/** Milk heat-deficit hypothesis model v0.1 settings (demo assumptions, not measured values). */
export interface MilkSimulation {
  modelId:'milk-heat-deficit-v0.1';
  mode:'repeated-day';
  /** Mirrors dailyWeather.mode — synced on write, validated on load. */
  weatherMode:'constant-environment'|'hourly-representative-day';
  operationPolicy:'daily-window-reset-v1';
  potentialMilkKgPerCowDay:number;
  referenceCoolingWPerCow:number;
  responseKgPerCowDayPerW:number;
  maxLossFraction:number;
  lagWeights:[number,number,number];
  occupancyFractions:{stall:number;feeding:number;waiting:number};
  responseSensitivityKgPerCowDayPerW:[number,number,number];
  warmupDurationSec:number;evaluationDurationSec:number;timeStepSec:number;
  assumptionClass:'demo_assumption';
}
export interface MilkSensitivityResult {beta:number;yieldKgPerCowDay:number|null;deltaKgPerCowDay:number|null;lossCapped:boolean}
export interface DailyMilkResult {
  status:'available'|'invalid_input'|'calculation_error';reasons:string[];
  modelId:string;mode:string;weatherMode:string;operationPolicy:string;
  warmupDurationSec:number;evaluationDurationSec:number;timeStepSec:number;
  potentialMilkKgPerCowDay:number;referenceCoolingWPerCow:number;responseKgPerCowDayPerW:number;maxLossFraction:number;
  lagWeights:[number,number,number];occupancyFractions:{stall:number;feeding:number;waiting:number};
  zoneCounts:{stall:number;feeding:number;waiting:number};
  dailyDeficitWPerCow:number|null;laggedDeficitWPerCow:number|null;
  lossKgPerCowDay:number|null;yieldKgPerCowDay:number|null;deltaKgPerCowDay:number|null;
  lossCapped:boolean;sensitivities:MilkSensitivityResult[];
  resources:Resources|null;
  waterCheck:{roofStartKg:number;filmStartKg:number;roofResidualKg:number;filmResidualKg:number}|null;
}
export interface View {mode:'3d'|'2d';metric:'delta'|'deficit'|'speed'|'temperature';timeSec:number;selectedProbeId:string;selectedDeviceId:string|null;roof:boolean;flow:boolean;particles:boolean;camera:{azimuth:number;elevation:number;distance:number;target:Vec3}|null;
 /** analysis view: hide roof/cow silhouettes so area faces stay readable. Optional for v9 load-compat. */
 analysis?:boolean;
 /** Presentation only: optional for existing schema 9 projects. */
 realistic?:boolean;heatmap?:boolean;
 /** highlighted display area; excluded from the physics input hash. Optional for v9 load-compat. */
 selectedAreaId?:string|null}
export interface Project {schemaVersion:10;references:ReferenceSettings;milkSimulation:MilkSimulation;appVersion:string;template:Template;environment:Environment;dailyWeather:DailyWeather;model:Model;baselineScenarioId:string;activeScenarioId:string;scenarios:Scenario[];view:View;prices:{electricityYenKwh:number|null;waterYenM3:number|null};provenance:{id:string;classification:string;note:string;url?:string}[]}
export interface Zone {id:string;name:string;x:number;y:number;widthM:number;depthM:number;kind:'feed'|'feeding'|'stall'|'aisle'|'robot'|'utility'|'waiting'|'isolation';solid?:boolean}
export interface Probe {id:string;label:string;x:number;y:number;heightM:number;zoneId:string;patchYawDeg:number;kind:'stall'|'feeding'|'waiting'}
export interface Stall {id:string;x:number;y:number;widthM:number;depthM:number;row:string}
export interface Layout {zones:Zone[];probes:Probe[];stalls:Stall[];solids:Box3[];cells:AirCell[]}
export interface Box3 {min:Vec3;max:Vec3}
export interface AirCell {id:string;ix:number;iy:number;x:number;y:number;widthM:number;depthM:number;areaM2:number}
export interface HeatComponents {convectionW:number;radiationW:number;baseEvaporationW:number;soakerEvaporationW:number;condensationW:number}
export interface FilmLedger {capturedKg:number;condensedKg:number;evaporatedKg:number;runoffKg:number;finalKg:number;maxResidualKg:number}
export interface PointResult {probeId:string;inputHash:string;modelVersion:string;meanSpeedMps:number|null;meanAirTemperatureC:number|null;meanRelativeHumidityPct:number|null;meanQrefW:number|null;deltaQrefW:number|null;components:HeatComponents|null;parameterEnvelopeW:[number,number]|null;profileDeltas:Record<string,number>;status:'valid'|'invalid';warnings:string[];cellId:string;captureFraction:number;film:FilmLedger|null;meanRadiantC:number|null;meanFeelsLikeC:number|null;milk:MilkReference;fertility:FertilityReference;series:PointSample[];
 /** Area visualization v0.1: per-second aggregates over the 60-minute reference profile. */
 meanDeficitW:number|null;meanFilmKg:number|null;fanActionFraction:number|null;soakerArrivalFraction:number|null;mistEvaporationActionFraction:number|null;mistSupplyFraction:number|null;
 /** Test hook: per-second net Q [W]. Populated only when simulate({collectQSeries:true}) — never used by the app or worker. */
 qSeries?:Float64Array}
export interface Resources {waterLPerDay:number;fanKwhPerDay:number;pumpKwhPerDay:number;totalKwhPerDay:number;systems:{kind:string;waterL:number;pumpKwh:number;onTotalSec:number}[]}
/** Per-point daily means under the representative-day weather (evaluation day only).
 * Deficit is still per-second max(0,Qref-Q) before any averaging. */
export interface DailyThermalPoint {probeId:string;meanDeficitW:number;meanQrefW:number;meanSpeedMps:number;meanAirTemperatureC:number;meanRelativeHumidityPct:number;components:HeatComponents;fanActionFraction:number;soakerArrivalFraction:number;mistEvaporationActionFraction:number;mistSupplyFraction:number}
export interface DailyThermalArea {id:string;label:string;probeCount:number;validCount:number;meanDeficitW:number|null;maxDeficitW:number|null;topDeficit:{probeId:string;value:number}[]}
export interface DailyThermalResult {status:'complete'|'invalid_input'|'calculation_error';reasons:string[];evaluationDurationSec:number;weatherMode:string;modelVersion:string;points:DailyThermalPoint[];areas:DailyThermalArea[];all:DailyThermalArea|null;resources:Resources|null}
export interface ScenarioResult {id:string;points:PointResult[];resources:Resources;warnings:string[];roof:RoofResult;trialWaterL:number;trialKwh:number;dailyMilk:DailyMilkResult|null;dailyThermal:DailyThermalResult|null}
export interface SimulationResult {inputHash:string;modelVersion:string;scenarios:ScenarioResult[];profiles:string[];timeStepSec:number;rayCount:number;durationSec:3600;dailyMilkStatus:'pending'|'complete'|'error'}
export type Device = Fan | Nozzle;
export const activeScenario=(p:Project)=>p.scenarios.find(s=>s.id===p.activeScenarioId)!;
export const devices=(s:Scenario):Device[]=>[...s.fans,...s.waterSystems.flatMap(w=>w.nozzles)];
export const isFan=(d:Device):d is Fan=>'diameterM' in d;
export const clone=<T>(v:T):T=>structuredClone(v);

// v0.8 integration contracts. Underlying v0.5/v0.6/v0.7 model boundaries are unchanged.
export interface RoofSettings {reflectance:number;insulationM:number;sprayEnabled:boolean;flowLpmM2:number;onSec:number;offSec:number;hoursPerDay:number;dailyStartHour:number;pumpPowerKw:number}
export interface RoofModel {version:'cooling-thermal-v0.5-assumptions-1';backgroundSensibleW:number;bareResistance:number;conductivity:number;hOutConv:number;hOutRad:number;hInConv:number;hInRad:number;viewFactor:number;waterCapacityKgM2:number}
export interface ReferenceSettings {milkModel:'milk-table-cowbell178-v1';baselineMilkKgPerDay:number|null;fertility:{model:'fertility-thi-period-or-baccouri2025-v1';p0:number;mode:'manual'|'simulation';exposureAssumed:boolean;temperatureC:number;relativeHumidityPct:number;profileVersion:1}}
export interface MilkReference {status:'available'|'out_of_scope'|'invalid_input';ratioPct:number|null;kgPerDay:number|null;reasons:string[]}
export interface FertilityReference {status:'available_reference'|'out_of_scope'|'invalid_input';probability:number|null;oddsRatio:number|null;thi:number|null;category:string|null;reasons:string[];source:'manual'|'simulation';exposureAssumed:boolean}
export interface PointSample {timeSec:number;temperatureC:number;relativeHumidityPct:number;speedMps:number;filmKg:number;qW:number;deltaW:number|null;soakerOn:boolean;mistOn:boolean}
export interface RoofSample {timeSec:number;outerC:number;underC:number;airC:number;radiantC:number;waterKgM2:number;evaporatedKgsM2:number}
export interface RoofResult {meanOuterC:number;meanUnderC:number;meanAirC:number;meanRadiantC:number;areaM2:number;suppliedL:number;evaporatedKg:number;runoffL:number;finalWaterKg:number;waterResidualKg:number;energyResidualMaxWm2:number;series:RoofSample[]}
