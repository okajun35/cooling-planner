import {test} from 'node:test';import assert from 'node:assert/strict';
import {createProject} from '../../.compiled/data/defaults.js';
import {simulate} from '../../.compiled/model/simulation.js';
import {simulateDaily,mergeDaily} from '../../.compiled/model/dailySimulation.js';
import {compareOnProject} from '../../.compiled/mcp/commands.js';
import {checkConstraints,improvesPriorityArea,rankCandidates} from '../../.compiled/model/candidateComparison.js';
import {createCommands} from '../../.compiled/mcp/commands.js';
import {ProjectStore} from '../../.compiled/state/store.js';

/** Fast runEval: real model with a 1-hour evaluation day (no warmup). */
const quickEval=async p=>{
 const thermal=simulate(p,{envelope:false});
 const out=simulateDaily(p,{warmupSec:0,evalSec:3600});
 return{thermal,daily:out.daily,dailyThermal:out.thermal,dailyMilkStatus:out.status==='error'?'error':'complete'};
};
const SUM=(d,w,m)=>({status:'complete',valid:true,reasons:[],coolingWaterLPerDay:w,electricityKwhPerDay:10,areaMean:{stalls:d,feeding:d,waiting:d,all:m??d},allMax:(m??d)*1.5,worsenedPoints:0});

test('CC01: constraints reject over-budget water and protected-area worsening',()=>{
 const k={maxWaterLPerDay:100,priorityArea:'stalls',protectAreas:['stalls','feeding'],protectWorst:true};
 const start=SUM(300,50);
 assert.equal(checkConstraints(SUM(200,99),start,k).length,0);
 assert.match(checkConstraints(SUM(200,101),start,k).join(' '),/cooling water/);
 assert.match(checkConstraints({...SUM(200,50),areaMean:{stalls:400,feeding:200,all:300}},start,k).join(' '),/stalls/);
 assert.match(checkConstraints({...SUM(200,50),allMax:600},start,k).join(' '),/max deficit/);
 // unevaluable candidate is excluded, never treated as zero
 assert.match(checkConstraints({...SUM(0,0),valid:false,status:'calculation_error'},start,k).join(' '),/not evaluated/);
 // start not evaluable + protections requested → incomparable, excluded from ranking
 const badStart={...SUM(0,0),valid:false,areaMean:{},allMax:null};
 assert.match(checkConstraints(SUM(200,50),badStart,k).join(' '),/starting scenario/);
 // without protection requirements, resource limits still apply on their own
 const resOnly={...k,protectAreas:[],protectWorst:false};
 assert.equal(checkConstraints(SUM(200,50),badStart,resOnly).length,0);
 assert.match(checkConstraints(SUM(200,101),badStart,resOnly).join(' '),/cooling water/);
 // missing values on either side make a protected check incomparable
 assert.match(checkConstraints({...SUM(200,50),areaMean:{stalls:200,feeding:null}},start,k).join(' '),/feeding.*cannot be compared/);
});

test('CC02: ranking modes are deterministic and respect their key order',()=>{
 const a={id:'a',s:SUM(200,80),improves:true},b={id:'b',s:SUM(150,60),improves:true},c={id:'c',s:SUM(150,40),improves:false};
 // b and c tie on priority deficit and max; the lower water use wins → c first
 assert.deepEqual(rankCandidates([a,b,c],'stalls','deficit'),['c','b','a']);
 assert.deepEqual(rankCandidates([a,b,c],'stalls','water'),['b','a']);      // only improving candidates, water asc
 assert.deepEqual(rankCandidates([a,b,c],'stalls','worst'),['c','b','a']);
 // identical candidates keep one entry order by id
 const d={id:'d',s:SUM(150,60),improves:true};
 assert.deepEqual(rankCandidates([b,d],'stalls','deficit'),['b','d']);
});

test('CC03: compare_candidates runs candidates on separate clones, reports constraints+order',async()=>{
 const p=createProject();
 const target=p.scenarios.find(s=>!s.readOnly);
 const sys=target.waterSystems.find(w=>w.kind==='soaker');
 const r=await compareOnProject(p,{
  scenarioId:target.id,
  candidates:[
   {id:'early',operations:[{operation:'update_system',systemId:sys.id,patch:{dailyStartHour:6}}]},
   {id:'late',operations:[{operation:'update_system',systemId:sys.id,patch:{dailyStartHour:20}}]},
  ],
  constraints:{maxWaterLPerDay:1e9},ranking:'deficit',
 },quickEval);
 assert.equal(r.start.scenarioId,target.id);
 assert.equal(r.candidates.length,2);
 for(const c of r.candidates){assert.equal(c.status,'complete');assert.equal(c.constraintsSatisfied,true);assert.ok(c.areaMeanDeficitW.all!=null)}
 // non-cumulative: both inputHashes derive from the same start (no leaked edits)
 assert.ok(r.candidates[0].inputHash!==r.candidates[1].inputHash);
 assert.deepEqual([...r.ranking.order].sort(),['early','late']);
 assert.match(r.ranking.note,/this call/);
});

test('CC04: forbidden operations and quota errors fail per candidate or upfront',async()=>{
 const p=createProject();
 const target=p.scenarios.find(s=>!s.readOnly);
 // forbidden op inside a candidate → that candidate fails, others still run
 const r=await compareOnProject(p,{candidates:[
  {id:'bad',operations:[{operation:'update_environment',patch:{temperatureC:35}}]},
  {id:'perf',operations:[{operation:'update_device',deviceId:target.fans[0].id,patch:{powerKw:2}}]}, // performance field not a candidate knob
  {id:'ok',operations:[{operation:'update_device',deviceId:target.fans[0].id,patch:{dailyStartHour:10}}]},
 ]},quickEval);
 assert.equal(r.candidates[0].status,'invalid_input');assert.match(r.candidates[0].error,/not allowed in candidate comparison/);
 assert.equal(r.candidates[1].status,'invalid_input');assert.match(r.candidates[1].error,/disallowed/);
 assert.equal(r.candidates[2].status,'complete');
 // >3 candidates rejected upfront
 await assert.rejects(()=>compareOnProject(p,{candidates:[{id:'a',operations:[]},{id:'b',operations:[]},{id:'c',operations:[]},{id:'d',operations:[]}]},quickEval),/3 candidates/);
 await assert.rejects(()=>compareOnProject(p,{scenarioId:'baseline',candidates:[{id:'a',operations:[]}]},quickEval),/editable scenario/);
 await assert.rejects(()=>compareOnProject(p,{candidates:[{id:'a',operations:[]},{id:'a',operations:[]}]},quickEval),/duplicate/);
});

test('CC05: browser-facing compare_candidates command delegates with committed project',async()=>{
 const s=new ProjectStore(),seen=[];
 const deps={store:s,currentResult:()=>null,status:()=>({pendingInput:false,invalidInput:false,calculating:false,workerError:null}),stopPlayback:()=>{},evaluate:async p=>{seen.push(p);return quickEval(p)}};
 const c=createCommands(deps);
 const target=s.committed.scenarios.find(x=>!x.readOnly);
 const r=await c.compare_candidates({candidates:[{id:'x',operations:[{operation:'update_roof',patch:{sprayEnabled:true}}]}]});
 assert.equal(r.candidates.length,1);
 assert.equal(seen.length,2); // start + 1 candidate
 assert.equal(s.committed.scenarios.find(x=>x.id===target.id).roof.sprayEnabled,false); // live store untouched
});
