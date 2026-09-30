import type {Project} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {MODEL} from '../data/defaults.js';
import {DEFAULT_MILK_SIMULATION} from './milk.js';

/** Paths where the project's assumptions differ from the shipped defaults — i.e. a
 *  sensitivity experiment, not the documented/reference coefficients. */
const diffFields=(cur:Record<string,unknown>,def:Record<string,unknown>,prefix:string,skip:readonly string[]=[])=>
 Object.keys(def).filter(k=>!skip.includes(k)&&JSON.stringify(cur[k])!==JSON.stringify(def[k]))
 .map(k=>`${prefix}.${k}=${JSON.stringify(cur[k])} (default ${JSON.stringify(def[k])})`);

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
  ...m.profiles.flatMap(pr=>{const d=MODEL.profiles.find(x=>x.id===pr.id);return d?diffFields(pr as unknown as Record<string,unknown>,d as unknown as Record<string,unknown>,`model.profiles.${pr.id}`,['id','name']):[`model.profiles.${pr.id}: profile not present in the default set`]}),
  ...diffFields(ms as unknown as Record<string,unknown>,DEFAULT_MILK_SIMULATION as unknown as Record<string,unknown>,'milkSimulation',['modelId','mode','weatherMode','operationPolicy','assumptionClass']),
 ];
 return {
  modelVersion:p.model.version,
  roofModel:p.model.roof.version,
  milkModel:p.milkSimulation.modelId,
  purpose:'A reduced-order model that compares net heat loss, deficit and resource use of a representative cow across scenarios by varying device placement, roof conditions and shared weather. Not a definitive prediction of real-farm temperature, milk or conception, and not CFD',
  timeBase:'Integrates a 60-min trial at 1-s steps; devices start from ON and the water film starts at 0. Daily milk uses a separate 24-h representative-day aggregation (warmup then evaluation day). Replaying timeSec changes display only, not physics',
  space:{
   barn:`${p.template.lengthM}m long × ${p.template.widthM}m wide gable barn; eaves 4.0m, ridge 8.7m`,
   probes:`${l.probes.length} independent representative points (stalls ${stall} / feeding ${feed} / waiting ${wait}). Each point is an independent comparison of "one cow standing there"; simultaneous herd load is not summed into or fed back to the barn balance`,
  },
  inputs:{
   environment:'shared weather temperatureC/relativeHumidityPct/pressurePa/backgroundSpeedMps/ventilationM3sPerM2/solarRoofWm2. update_environment affects all scenarios',
   roof:'reflectance (solar) / insulationM (thickness) / sprayEnabled + flowLpmM2 / onSec-offSec cycle / hoursPerDay / dailyStartHour / pumpPowerKw',
   fan:'position x,y,heightM; direction yawDeg,pitchDownDeg; diameterM/outletSpeedMps/powerKw; daily schedule',
   nozzle:'kind=soaker (wets the cow) / mist (evaporates into air); flowLpm/halfAngleDeg; daily schedule. Each nozzle belongs to its kind system under waterSystems',
  },
  computation:[
   'roof: per-second integration of outer/underside temperature, barn air temperature and radiant temperature from solar, reflectance, thermal resistance, inner/outer convection, linearised radiation and the spray water balance',
   `wind: background wind plus each fan jet is ray-cast (256/1024 rays) and summed; spread kSpread=${m.kSpread} and decay kDecay=${m.kDecay} produce the point wind speed. Short fan duty windows feed the 60-min mean`,
   `soaker: captured fraction fills the cow water film; evaporation, condensation and runoff are ledgered (film cap = profile maxFilmKg)`,
   'mist: supply and evaporative action are separate metrics. Evaporation and cooling stop at saturation',
   `cow balance: convection (hc=${m.hcIntercept}+${m.hcSlope}×√v) + radiation + base evaporation + soaker evaporation + condensation (negative) computed each second; the 3600-s mean is meanQrefW`,
   `air: sensible and latent heat are aggregated into one lumped air mass. Ventilation ${p.environment.ventilationM3sPerM2}m³/s/m² × floor area, background sensible ${roof.backgroundSensibleW}W`,
   `daily aggregate: occupancy weights (stall ${hours(occ.stall)} / feeding ${hours(occ.feeding)} / other ${hours(occ.waiting)}) applied to representative points integrate the heat deficit over 24 h and feed the milk hypothesis`,
   `daily weather: with dailyWeather.mode="hourly", rows for hours 0-23 supply temperature, humidity and roof solar per hour into the daily roof balance, air and point heat loss (roof/thermal caches are invalidated at weather boundaries). "constant" pins environment all day`,
  ],
  outputs:{
   meanQrefW:'net heat loss at the point [W]. components breakdown = convectionW/radiationW/baseEvaporationW/soakerEvaporationW/condensationW',
   deltaQrefW:'heat-loss difference vs the same point in the baseline [W]. positive = improvement',
   meanDeficitW:`60-min mean [W] of per-second max(0, Qref−Q). Qref=${ms.referenceCoolingWPerCow}W is an assumed value`,
   'action metrics':'fanActionFraction/soakerArrivalFraction/mistEvaporationActionFraction = fraction of time the action applied; mistSupplyFraction = supply fraction (separate from evaporation)',
   meanFilmKg:'mean water-film mass. film ledger = captured/condensed/evaporated/runoff/final/maxResidual',
   resources:'per-system and total waterLPerDay/fanKwhPerDay/pumpKwhPerDay/totalKwhPerDay. trialWaterL/trialKwh cover the 60-min trial',
   roof:'meanOuterC/meanUnderC/meanAirC/meanRadiantC and the spray balance suppliedL/evaporatedKg/runoffL',
   dailyMilk:'daily milk under the hypothesis model. Y=Y0−min(Y0×maxLossFraction, beta×lagged deficit E). resources are the daily water and energy totals',
   dailyThermal:'evaluation-day (24 h) per-point and per-area means (meanDeficitW/meanQrefW/temp/wind/humidity/loss breakdown/action fractions). weatherMode states which weather was used. The deficit is integrated per second as max(0,Qref−Q), not clipped after averaging',
  },
  keyAssumptions:{
   referenceCoolingWPerCow:ms.referenceCoolingWPerCow,
   cow:`skin fixed at ${m.surfaceTemperatureC}℃, effective area ${m.areaM2}m², wetted area ${m.wetAreaM2}m², base wetted fraction ${m.baseWetFraction}, emissivity ${m.emissivity}, cow→roof view factor ${roof.viewFactor}`,
   roof:`resistance ${roof.bareResistance}m²K/W, conductivity ${roof.conductivity}W/mK, outer conv ${roof.hOutConv}, outer rad ${roof.hOutRad}, inner conv ${roof.hInConv}, inner rad ${roof.hInRad}W/m²K, water capacity ${roof.waterCapacityKgM2}kg/m²`,
   air:`ventilation ${p.environment.ventilationM3sPerM2}m³/s/m² × floor area, background sensible ${roof.backgroundSensibleW}W, wall/floor radiant background temperature = outdoor air`,
   milk:`Y0=${ms.potentialMilkKgPerCowDay}kg, beta=${ms.responseKgPerCowDayPerW}kg/cow/day/W, loss cap ${Math.round(ms.maxLossFraction*1000)/10}%, lag ${ms.lagWeights.join('/')}, occupancy = stall ${hours(occ.stall)} / feeding ${hours(occ.feeding)} / other ${hours(occ.waiting)}, warmup ${ms.warmupDurationSec/3600}h + evaluation ${ms.evaluationDurationSec/3600}h at ${ms.timeStepSec}s steps — demo_assumption, not a regression`,
   profiles:`a sensitivity range, not a 95% confidence interval. Current values: ${m.profiles.map(pr=>`${pr.id}(outlet ×${pr.outletMultiplier}, hc ×${pr.hcMultiplier}, mist efficiency ${pr.mistEfficiency}, film cap ${pr.maxFilmKg}kg)`).join(' / ')}`,
  },
  modifiedFromDefaults,
  modifiedNote:'When modifiedFromDefaults is non-empty, those coefficients are sensitivity-experiment values changed from the documented defaults (via update_model/update_milk). Validation and citations for the default model do not apply to the changed values',
  limits:[
   'Values are representative points, not whole-face or CFD results. Area means are simple point averages (not occupancy- or headcount-weighted)',
   'Assumption: vapour from cow sprinkling is not returned to barn humidity (also stated in result warnings)',
   'Roof radiation, solar and spray are reduced-order model assumptions; no field calibration',
   'Daily milk and conception come from separate hypothesis/reference models, not extensions of the thermal result. No W→THI→core-temperature conversion',
   'null/invalid/not-calculated are distinct from 0. If even one valid point is missing, the area mean is not evaluated',
   'A fully zero deficit is unreachable where device cooling capacity cannot exceed outdoor conditions',
  ],
  validation:'reference/thermal (numeric-match tests vs the v0.5 Python reference, V08-PY*) and reference/fertility (v0.7). Model formulas and coefficients are pinned by these',
  docs:['reference/thermal/MODEL.md','docs/MILK_HEAT_MODEL_V0_1.md','docs/cooling_planner_decisions_v0_6.md','docs/DECISIONS_v0_8.md'],
 };
}
