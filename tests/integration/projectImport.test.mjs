import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../../.compiled/data/defaults.js';
import {parseProject} from '../../.compiled/domain/validation.js';
import {ProjectStore} from '../../.compiled/state/store.js';
import {evaluateOnProject} from '../../.compiled/mcp/commands.js';
import {simulate,inputHash} from '../../.compiled/model/simulation.js';
import {simulateDaily} from '../../.compiled/model/dailySimulation.js';

test('MCP response imports its exact project and reproduces thermal and daily results',async()=>{
 const source=createProject(),live=new ProjectStore(source);
 const r=await evaluateOnProject(source,{includeDaily:true,operations:[
  {operation:'update_roof',patch:{reflectance:.7,insulationM:.02}},
  {operation:'update_environment',patch:{temperatureC:31}},
  {operation:'update_device',deviceId:'fan-feeding-1',patch:{yawDeg:90,dailyStartHour:9}},
  {operation:'update_milk',patch:{responseKgPerCowDayPerW:.008}},
 ]},async p=>({thermal:simulate(p),daily:simulateDaily(p).daily,dailyMilkStatus:'complete'}));
 assert.equal(inputHash(source),inputHash(live.committed),'hypothetical MCP result did not edit the live project');
 live.importJSON(JSON.stringify(r));
 assert.equal(inputHash(live.committed),r.inputHash);
 assert.deepEqual(live.committed,r.project);
 const thermal=simulate(live.committed),daily=simulateDaily(live.committed);
 assert.deepEqual(daily.daily[r.scenarioId],r.result.dailyMilk);
 const points=thermal.scenarios.find(s=>s.id===r.scenarioId).points;
 assert.equal(points.reduce((sum,q)=>sum+q.meanDeficitW,0)/points.length,r.result.comparison.meanDeficitW);
 assert.equal(live.committed.baselineScenarioId,source.baselineScenarioId);
 live.undo();assert.equal(inputHash(live.committed),inputHash(source));
});

test('plain and wrapped imports validate atomically and ignore claimed results',()=>{
 const p=createProject(),store=new ProjectStore(p),saved=store.serialize();
 assert.deepEqual(parseProject(saved),p);
 assert.deepEqual(parseProject(JSON.stringify({project:p,result:{yieldKgPerCowDay:999},inputHash:'untrusted'})),p);
 for(const bad of [{project:{...p,schemaVersion:8}},{project:{...p,environment:{...p.environment,temperatureC:100}}},{project:null},{result:p},{schemaVersion:8,project:p}]){
  assert.throws(()=>store.importJSON(JSON.stringify(bad)));
  assert.equal(store.serialize(),saved);
  assert.equal(store.undoCount,0);
 }
 assert.throws(()=>parseProject('{"project":{},"__proto__":{}}'),/forbidden/);
 assert.throws(()=>parseProject(' '.repeat(2*1024*1024+1)),/2MiB/);
});
