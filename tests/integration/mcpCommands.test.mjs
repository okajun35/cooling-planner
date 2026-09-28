import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCommands} from '../../.compiled/mcp/commands.js';
import {ProjectStore} from '../../.compiled/state/store.js';
import {inputHash,simulate} from '../../.compiled/model/simulation.js';
const deps=(store,over={})=>({
 store,
 currentResult:()=>over.result??null,
 status:()=>({pendingInput:false,invalidInput:false,calculating:false,workerError:null,...over.status}),
 stopPlayback:over.stop??(()=>{}),
});
const active=s=>s.committed.scenarios.find(x=>x.id===s.committed.activeScenarioId);

test('get_state exposes committed ids, selection, layout and model notes',()=>{
 const s=new ProjectStore(),c=createCommands(deps(s));
 const st=c.get_state();
 assert.equal(st.inputHash,inputHash(s.committed));
 assert.equal(st.activeScenarioId,'working-soaker');
 assert.equal(st.baselineScenarioId,'baseline');
 assert.deepEqual(st.scenarios.map(x=>x.id),['baseline','working-soaker','working-mist']);
 assert.equal(st.scenarios[0].readOnly,true);
 assert.ok(st.scenarios[1].fans.length===10&&st.scenarios[1].fans[0].id==='fan-feeding-1');
 assert.equal(st.probes.length,70);
 assert.equal(st.areas.length,7);
 assert.ok(st.areas.some(a=>a.id==='stall-A'&&a.probeIds.includes('stall-A-01')));
 assert.equal(st.view.selectedProbeId,s.committed.view.selectedProbeId);
 assert.equal(st.undoCount,0);
 assert.equal(st.draft,false);
 assert.ok(Array.isArray(st.modelNotes)&&st.modelNotes.length>=8);
 assert.ok(st.milkSimulation.referenceCoolingWPerCow>0);
});

test('update_device reaches the real Store, hash changes, adapter undo reverts',()=>{
 const s=new ProjectStore(),c=createCommands(deps(s));
 const orig=s.committed.scenarios[1].fans.find(f=>f.id==='fan-feeding-1').x;
 const r=c.edit({operation:'update_device',deviceId:'fan-feeding-1',patch:{x:10,heightM:2}});
 assert.equal(r.operation,'update_device');
 assert.equal(r.activeScenarioId,'working-soaker');
 assert.equal(r.applied.x,10);
 assert.equal(active(s).fans.find(f=>f.id==='fan-feeding-1').x,10);
 assert.notEqual(r.inputHash,inputHash(new ProjectStore().committed));
 assert.equal(r.undoCount,1);
 const u=c.undo();
 assert.equal(u.changed,true);
 assert.equal(active(s).fans.find(f=>f.id==='fan-feeding-1').x,orig);
 assert.equal(u.undoCount,0);
 const u2=c.undo();
 assert.equal(u2.changed,false);
});

test('edit rejects kind-mismatched, internal and unknown patch fields before touching the Store',()=>{
 const s=new ProjectStore(),c=createCommands(deps(s)),h=inputHash(s.committed);
 for(const bad of [
  {operation:'update_device',deviceId:'fan-feeding-1',patch:{flowLpm:2}},
  {operation:'update_device',deviceId:'soaker-1',patch:{diameterM:2}},
  {operation:'update_device',deviceId:'fan-feeding-1',patch:{id:'renamed'}},
  {operation:'update_device',deviceId:'fan-feeding-1',patch:{anchor:{zoneId:'x',u:0,v:0}}},
  {operation:'update_roof',patch:{fans:[]}},
  {operation:'update_system',systemId:'water-soaker',patch:{nozzles:[]}},
  {operation:'update_environment',patch:{scene:'beach'}},
 ])assert.throws(()=>c.edit(bad),/フィールド/,JSON.stringify(bad));
 assert.equal(inputHash(s.committed),h);
 assert.throws(()=>c.edit({operation:'update_device',deviceId:'fan-feeding-1',patch:{}}),/フィールド|空/);
 assert.throws(()=>c.edit({operation:'update_device',deviceId:'ghost',patch:{x:1}}),/見つかりません/);
});

test('baseline scenario refuses edits; environment stays shared-editable; copy_to_other switches target',()=>{
 const s=new ProjectStore(),c=createCommands(deps(s));
 s.updateDevice('fan-feeding-1',{heightM:2});
 c.edit({operation:'switch_scenario',scenarioId:'baseline'});
 assert.equal(s.committed.activeScenarioId,'baseline');
 assert.throws(()=>c.edit({operation:'update_device',deviceId:'fan-feeding-1',patch:{x:5}}),/基準案/);
 assert.throws(()=>c.edit({operation:'update_roof',patch:{reflectance:.9}}),/基準案/);
 const e=c.edit({operation:'update_environment',patch:{temperatureC:34}});
 assert.equal(s.committed.environment.temperatureC,34);
 c.edit({operation:'switch_scenario',scenarioId:'working-soaker'});
 const r=c.edit({operation:'copy_to_other'});
 assert.equal(r.activeScenarioId,'working-mist');
 assert.equal(s.committed.activeScenarioId,'working-mist');
 assert.equal(s.committed.scenarios[2].fans.find(f=>f.id==='fan-feeding-1').heightM,2);
 assert.equal(s.committed.scenarios[1].fans.find(f=>f.id==='fan-feeding-1').heightM,2);
});

test('add, duplicate and remove devices return applied ids and undo cleanly',()=>{
 const s=new ProjectStore(),c=createCommands(deps(s));
 const a=c.edit({operation:'add_device',kind:'fan'});
 assert.ok(a.deviceId&&a.applied.id===a.deviceId);
 assert.equal(active(s).fans.length,11);
 const d=c.edit({operation:'duplicate_device',deviceId:'fan-feeding-1'});
 assert.ok(d.deviceId&&d.deviceId!=='fan-feeding-1');
 assert.equal(active(s).fans.length,12);
 c.edit({operation:'remove_device',deviceId:d.deviceId});
 assert.equal(active(s).fans.length,11);
 assert.throws(()=>c.edit({operation:'remove_device',deviceId:'ghost'}),/見つかりません|変化/i);
 const m=c.edit({operation:'add_device',kind:'mist'});
 assert.equal(active(s).waterSystems.find(w=>w.kind==='mist').nozzles.length,13);
 assert.throws(()=>c.edit({operation:'add_device',kind:'sprinkler'}),/種別|kind/i);
});

test('set_view validates ids, couples probe to its area, never recalculates or undoes',()=>{
 const s=new ProjectStore(),c=createCommands(deps(s));
 const h=inputHash(s.committed);
 const v=c.set_view({selectedProbeId:'stall-A-01'});
 assert.equal(v.selectedProbeId,'stall-A-01');
 assert.equal(v.selectedAreaId,'stall-A');
 const v2=c.set_view({metric:'temperature',selectedAreaId:'waiting',mode:'2d',roof:false});
 assert.equal(v2.metric,'temperature');
 assert.equal(v2.selectedAreaId,'waiting');
 assert.equal(v2.selectedProbeId,'stall-A-01');
 const v3=c.set_view({selectedDeviceId:'fan-feeding-1'});
 assert.equal(v3.selectedDeviceId,'fan-feeding-1');
 assert.throws(()=>c.set_view({selectedProbeId:'ghost'}),/地点/);
 assert.throws(()=>c.set_view({selectedDeviceId:'ghost'}),/設備/);
 assert.throws(()=>c.set_view({selectedAreaId:'ghost'}),/区画/);
 assert.equal(inputHash(s.committed),h);
 assert.equal(s.undoCount,0);
});

test('set_view timeSec stops playback',()=>{
 const s=new ProjectStore();
 let stopped=false;
 const c=createCommands(deps(s,{stop:()=>stopped=true}));
 c.set_view({timeSec:900});
 assert.ok(stopped);
 assert.equal(s.committed.view.timeSec,900);
});

test('get_results: stale result for an old inputHash is never returned',()=>{
 const s=new ProjectStore();
 const r0=simulate(s.committed,{envelope:false});
 const c=createCommands(deps(s,{result:r0}));
 assert.equal(c.get_results({}).status,'thermal_ready');
 s.updateEnvironment({temperatureC:34});
 const out=c.get_results({});
 assert.equal(out.status,'calculating');
 assert.equal(out.result,null);
});

test('get_results: ready only when daily stage finished; summaries and selected probe detail',()=>{
 const s=new ProjectStore();
 const r0=simulate(s.committed,{envelope:false});
 const c=createCommands(deps(s,{result:{...r0,dailyMilkStatus:'complete'}}));
 const out=c.get_results({});
 assert.equal(out.status,'ready');
 const r=out.result;
 assert.equal(r.inputHash,inputHash(s.committed));
 assert.equal(r.dailyMilkStatus,'complete');
 assert.equal(r.baselineScenarioId,'baseline');
 assert.deepEqual(r.scenarios.map(x=>x.id),['baseline','working-soaker','working-mist']);
 const sc=r.scenarios[1];
 assert.equal(sc.areas.length,7);
 assert.ok(sc.resources.waterLPerDay>0);
 assert.ok(sc.trialWaterL>0);
 assert.ok(sc.roof.meanUnderC!==undefined&&!('series' in sc.roof));
 const probeId=s.committed.view.selectedProbeId;
 assert.equal(r.probe.id,probeId);
 assert.ok(r.probe.areaId);
 const pt=r.probe.points['working-soaker'];
 assert.equal(pt.probeId,probeId);
 assert.equal(pt.status,'valid');
 assert.ok(!('series' in pt)&&!('qSeries' in pt));
 const one=c.get_results({scenarioId:'baseline',probeId:'feed-01'});
 assert.deepEqual(one.result.scenarios.map(x=>x.id),['baseline']);
 assert.equal(one.result.probe.id,'feed-01');
 assert.equal(one.result.probe.points['baseline'].probeId,'feed-01');
 assert.throws(()=>c.get_results({scenarioId:'ghost'}),/案/);
 assert.throws(()=>c.get_results({probeId:'ghost'}),/地点/);
});

test('get_results: editing, pending and worker-error states never leak numbers',()=>{
 const s=new ProjectStore(),r0=simulate(s.committed,{envelope:false});
 s.begin();s.previewDevice('fan-feeding-1',{x:9});
 const cd=createCommands(deps(s,{result:r0}));
 const out=cd.get_results({});
 assert.equal(out.status,'editing');
 assert.equal(out.result,null);
 assert.throws(()=>cd.edit({operation:'update_device',deviceId:'fan-feeding-1',patch:{x:1}}),/確定/);
 assert.throws(()=>cd.undo(),/確定/);
 const s2=new ProjectStore();
 const cp=createCommands(deps(s2,{result:r0,status:{pendingInput:true}}));
 assert.equal(cp.get_results({}).status,'editing');
 assert.equal(cp.get_results({}).result,null);
 const ci=createCommands(deps(s2,{result:r0,status:{invalidInput:true}}));
 assert.equal(ci.get_results({}).status,'editing');
 const ce=createCommands(deps(s2,{status:{workerError:'Workerが失敗しました'}}));
 const eo=ce.get_results({});
 assert.equal(eo.status,'error');
 assert.match(eo.reason,/失敗/);
 assert.equal(eo.result,null);
});

test('undo shares the same history as UI edits',()=>{
 const s=new ProjectStore(),c=createCommands(deps(s));
 s.updateRoof({reflectance:.7});
 const u=c.undo();
 assert.equal(u.changed,true);
 assert.equal(active(s).roof.reflectance,.2);
});
