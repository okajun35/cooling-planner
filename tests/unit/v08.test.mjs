import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createProject} from '../../.compiled/data/defaults.js';
import {validateProject} from '../../.compiled/domain/validation.js';
import {roofTimeline,solveRoof,roofArea} from '../../.compiled/model/roof.js';
import {heatTerms,filmStep,saturationPressure,mistAir,isOn} from '../../.compiled/model/physics.js';
import {milkReference,MILK_ROWS,fertilityByPeriods,fertilityTHI,categoryOfTHI,fertilityReference,FERTILITY_OR} from '../../.compiled/model/references.js';
import {simulate,inputHash,resources,trialResources} from '../../.compiled/model/simulation.js';
import {ProjectStore} from '../../.compiled/state/store.js';
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tol ${tol})`);

// Cross-language port check. The reference JSON was produced by the supplied v0.5 Python.
const gold=JSON.parse(fs.readFileSync('reference/thermal/example_results.json','utf8'));
const configs=[{}, {reflectance:.7}, {insulationM:.02}, {sprayEnabled:true}, {soaker:true}, {reflectance:.7,insulationM:.02}, {reflectance:.7,insulationM:.02,soaker:true}, {mist:true}];
for(const [index,g]of gold.entries())test(`V08-PY${index+1}: Python v0.5 parity / ${g.scenario}`,()=>{
 const p=createProject(),s=p.scenarios[1],c=configs[index];Object.assign(s.roof,c);
 const roof=roofTimeline(p,s),m=p.model,profile=m.profiles[1],pv=p.environment.relativeHumidityPct/100*saturationPressure(32);
 let mass=0,total=0,local=0,humidity=0,feels=0,evap=0;
 for(let i=0;i<3600;i++){
  const st=roof.states[i],rate=c.mist&&isOn(i,60,240,8)?.01/60:0,air=mistAir(st.airC,pv/saturationPressure(st.airC)*100,101325,.06,rate,.6);
  const terms=heatTerms(air.temperatureC,air.rhPct,2,st.radiantC,m,profile),captured=c.soaker&&isOn(i,120,600,8)?1.3/60*.25:0;
  const film=filmStep(mass,captured,terms,m,profile,1);mass=film.mass;
  total+=Object.values(terms.components).reduce((a,b)=>a+b,0)+film.heatW;local+=air.temperatureC;humidity+=air.rhPct;feels+=air.temperatureC-6*Math.sqrt(2);evap+=film.evaporatedKg;
 }
 near(roof.result.meanUnderC,g.roof_under_c,1e-6);near(roof.result.meanAirC,g.barn_air_c,1e-6);near(roof.result.meanRadiantC,g.mean_radiant_c,1e-6);
 near(local/3600,g.local_air_c,1e-6);near(humidity/3600,g.local_rh_pct,1e-6);near(total/3600,g.q_net_cooling_w,2e-5);near(feels/3600,g.fan_formula_feels_like_c,1e-6);near(evap,g.cow_water_evaporated_kg,1e-7);near(mass,g.cow_water_final_kg,1e-7);
 near(roof.result.suppliedL,g.roof_water_supply_l,1e-5);near(roof.result.evaporatedKg,g.roof_water_evaporated_kg,1e-5);
});
test('V08-M01: all six table values; kg uses baseline, not interpolation',()=>{for(const r of MILK_ROWS){const v=milkReference(r.temperatureC,65,r.speedMps,35);assert.equal(v.status,'available');near(v.ratioPct,r.ratioPct);near(v.kgPerDay,35*r.ratioPct/100)}});
test('V08-M02: RH boundaries inclusive and non-listed weather null',()=>{for(const rh of [60,70])assert.equal(milkReference(27,rh,2.24,35).status,'available');for(const rh of [59.999,70.001])assert.equal(milkReference(27,rh,2.24,35).kgPerDay,null);assert.equal(milkReference(33.7,65,2.0,35).ratioPct,null)});
test('V08-M03: no nearest-neighbour rounding; machine representation tolerance only',()=>{assert.equal(milkReference(27+1e-10,65,2.24,35).status,'available');assert.equal(milkReference(27.001,65,2.24,35).status,'out_of_scope');assert.equal(milkReference(27,65,2.23999,35).status,'out_of_scope')});
test('V08-M04: no mean-only or time-varying milk conversion',()=>{assert.equal(milkReference(27,65,2.24,35,false).status,'out_of_scope');assert.equal(milkReference(27,65,2.24,null).ratioPct,95);assert.equal(milkReference(27,65,2.24,null).kgPerDay,null)});
test('V08-M05: invalid is not out-of-scope or zero',()=>{for(const x of [NaN,Infinity])assert.equal(milkReference(x,65,2.24,35).status,'invalid_input');assert.equal(milkReference(27,65,-1,35).status,'invalid_input')});
test('V08-F01: exact category boundaries; no averaging category indexes',()=>{assert.deepEqual([59.999,60,67.999,68,71.999,72,84].map(categoryOfTHI),[0,1,1,2,2,3,3])});
test('V08-F02: Python v0.7 numerical parity of four calculation examples',()=>{const cases=JSON.parse(fs.readFileSync('reference/fertility/calculation_examples.json','utf8'));for(const g of cases){const t=fertilityTHI(g.temperature_c,g.relative_humidity_pct),v=fertilityByPeriods([t,t,t,t,t],g.baseline_probability);near(t,g.period_mean_thi.P1,1e-10);near(v.probability,g.reference_probability,1e-12);near(v.oddsRatio,g.relative_odds,1e-12)}});
test('V08-F03: explicit period assumption required; manual mode independent of a point',()=>{const f=createProject().references.fertility;assert.equal(fertilityReference({...f,exposureAssumed:false},32,70).probability,null);assert.equal(fertilityReference(f,null,null).status,'available_reference');assert.equal(fertilityReference({...f,mode:'simulation'},null,null).status,'out_of_scope')});
test('V08-F04: all coefficients including non-monotonic / non-significant kept',()=>{assert.equal(FERTILITY_OR[1][3],1.005);assert.equal(FERTILITY_OR[4][1],1.058);assert.ok(FERTILITY_OR[0][2]<FERTILITY_OR[0][3]);assert.throws(()=>fertilityByPeriods([70],.4));assert.throws(()=>fertilityByPeriods([70,70,70,70,70],1))});
test('V08-R01: no solar means no coating effect, insulation inner/outer directions',()=>{const p=createProject(),s=p.scenarios[1];p.environment.solarRoofWm2=0;const a=solveRoof(p,s,0,1);s.roof.reflectance=.7;near(a.airC,solveRoof(p,s,0,1).airC);p.environment.solarRoofWm2=800;s.roof.reflectance=.2;const b=solveRoof(p,s,0,1);s.roof.insulationM=.02;const c=solveRoof(p,s,0,1);assert.ok(c.underC<b.underC);assert.ok(c.outerC>b.outerC)});
test('V08-R02: roof spray mass balance, energy residual, daily vs 60min water',()=>{const p=createProject(),s=p.scenarios[1];s.roof.sprayEnabled=true;const r=roofTimeline(p,s).result;near(r.waterResidualKg,0,1e-6);assert.ok(r.energyResidualMaxWm2<1e-5);assert.ok(r.runoffL>0);const base=resources({...s,roof:{...s.roof,sprayEnabled:false}},p),water=resources(s,p);near(water.waterLPerDay-base.waterLPerDay,roofArea(p)*.05*(8*3600/600*120)/60);near(trialResources(s,p).trialWaterL,1248/8+r.suppliedL,1e-5)});
test('V08-S01: roof and fertility change hash, labels/camera/time do not',()=>{const s=new ProjectStore(),h=inputHash(s.project);s.setView({timeSec:240});assert.equal(inputHash(s.project),h);s.updateRoof({reflectance:.7});assert.notEqual(inputHash(s.project),h);const h2=inputHash(s.project);s.updateFertility({p0:.3});assert.notEqual(inputHash(s.project),h2)});
test('V08-S02: new schema round trip, missing/old roof data rejected atomically',()=>{const s=new ProjectStore();s.updateRoof({reflectance:.7,insulationM:.02,sprayEnabled:true});s.updateFertility({mode:'simulation',exposureAssumed:true});s.setView({timeSec:900,metric:'temperature'});const text=s.serialize(),other=new ProjectStore();other.importJSON(text);assert.equal(other.serialize(),text);const bad=JSON.parse(text);delete bad.scenarios[1].roof;assert.throws(()=>s.importJSON(JSON.stringify(bad)));assert.equal(s.serialize(),text);bad.schemaVersion=4;assert.throws(()=>validateProject(bad))});
test('V08-S03: copying current full equipment includes roof; undo restores',()=>{const s=new ProjectStore();s.updateRoof({reflectance:.7});const before=s.serialize();s.copyActiveToOther();assert.deepEqual(s.project.scenarios[1].roof,s.project.scenarios[2].roof);assert.equal(s.project.scenarios[0].roof.reflectance,.2);s.undo();assert.equal(s.project.scenarios[2].roof.reflectance,.2)});
test('V08-I01: all 70 probes update from roof and baseline remains unchanged; no fake milk',()=>{const p=createProject();p.scenarios[1].roof.reflectance=.7;p.scenarios[1].roof.insulationM=.02;p.references.fertility.mode='simulation';const r=simulate(p,{envelope:false}),base=r.scenarios[0],edit=r.scenarios[1];assert.equal(edit.points.length,70);assert.ok(edit.roof.meanUnderC<base.roof.meanUnderC);for(const q of edit.points){assert.ok(q.deltaQrefW>0);assert.equal(q.milk.ratioPct,null);assert.equal(q.series.length,61);assert.equal(q.fertility.status,'available_reference')}assert.ok(edit.points.every(q=>q.fertility.category===base.points[0].fertility.category));});
test('V08-I02: reference hashes, periods, sample times and energy components consistent',()=>{const p=createProject(),r=simulate(p,{envelope:false});for(const s of r.scenarios)for(const q of s.points){assert.equal(q.inputHash,r.inputHash);near(q.meanQrefW,Object.values(q.components).reduce((a,b)=>a+b,0));assert.equal(q.series.at(-1).timeSec,3600);near(q.film.finalKg,q.film.capturedKg+q.film.condensedKg-q.film.evaporatedKg-q.film.runoffKg,1e-8)}assert.equal(r.durationSec,3600)});
