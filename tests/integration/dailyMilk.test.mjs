import {test} from 'node:test';import assert from 'node:assert/strict';
import {createProject} from '../../.compiled/data/defaults.js';
import {simulate,inputHash} from '../../.compiled/model/simulation.js';
import {simulateDaily,mergeDaily,dailyResources} from '../../.compiled/model/dailySimulation.js';
import {onTotalSeconds} from '../../.compiled/model/physics.js';
import {ResultGate} from '../../.compiled/worker/protocol.js';
import {ProjectStore} from '../../.compiled/state/store.js';
import {buildLayout} from '../../.compiled/template/layout.js';
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
/** Same equipment, but all daily windows start at 00:00 so the first hour matches the legacy path. */
const zeroStart=p=>{for(const s of p.scenarios){for(const f of s.fans)f.dailyStartHour=0;for(const w of s.waterSystems)w.dailyStartHour=0;s.roof.dailyStartHour=0}return p};

test('MH15: daily path reproduces the legacy 60-minute Q exactly when windows start at 00:00',()=>{
  const p=zeroStart(createProject());
  const r=simulate(p,{envelope:false});
  const d=simulateDaily(p,{warmupSec:0,evalSec:3600,collectQ:true});
  assert.equal(d.status,'complete');
  for(const s of r.scenarios){
    const dq=d.probeQ[s.id];
    for(const q of s.points){const mean=dq.get(q.probeId);assert.ok(mean!=null,`missing ${q.probeId}`);near(mean,q.meanQrefW??NaN,1e-6)}
  }
});
test('MH01: baseline and identical initial A give delta 0; deterministic across runs',()=>{
  const p=createProject();const a=simulateDaily(p),b=simulateDaily(p);
  assert.equal(a.status,'complete');
  for(const id of Object.keys(a.daily)){const r=a.daily[id];assert.equal(r.status,'available');assert.ok(Number.isFinite(r.yieldKgPerCowDay))}
  near(a.daily['working-soaker'].yieldKgPerCowDay,a.daily.baseline.yieldKgPerCowDay);
  near(a.daily['working-soaker'].deltaKgPerCowDay,0);
  assert.equal(JSON.stringify(a.daily),JSON.stringify(b.daily));
});
test('negative delta is kept when a scenario is worse than baseline',()=>{
  const p=createProject();
  for(const s of p.scenarios)if(s.id==='working-mist'){s.fans.forEach(f=>f.enabled=false);s.waterSystems.forEach(w=>w.enabled=false);s.roof.sprayEnabled=false}
  const d=simulateDaily(p),m=d.daily['working-mist'];
  assert.equal(m.status,'available');assert.ok(m.deltaKgPerCowDay<0,`expected negative delta, got ${m.deltaKgPerCowDay}`);
});
test('daily result formula fields are internally consistent (D=E, loss cap, Y=Y0-L)',()=>{
  const p=createProject(),d=simulateDaily(p),ms=p.milkSimulation;
  for(const r of Object.values(d.daily)){
    near(r.laggedDeficitWPerCow,r.dailyDeficitWPerCow);
    const loss=Math.min(ms.potentialMilkKgPerCowDay*ms.maxLossFraction,ms.responseKgPerCowDayPerW*r.dailyDeficitWPerCow);
    near(r.lossKgPerCowDay,loss);near(r.yieldKgPerCowDay,ms.potentialMilkKgPerCowDay-loss);
    assert.equal(r.lossCapped,ms.responseKgPerCowDayPerW*r.dailyDeficitWPerCow>=ms.potentialMilkKgPerCowDay*ms.maxLossFraction);
    assert.equal(r.sensitivities.length,3);assert.deepEqual(r.sensitivities.map(x=>x.beta),[.005,.010,.015]);
    for(const sen of r.sensitivities)near(sen.yieldKgPerCowDay,ms.potentialMilkKgPerCowDay-Math.min(ms.potentialMilkKgPerCowDay*ms.maxLossFraction,sen.beta*r.dailyDeficitWPerCow));
  }
});
test('eval-day resources match the operation masks; overnight 23:00+4h covers 00:00-03:00 and 23:00-24:00',()=>{
  const p=createProject();const s=p.scenarios.find(x=>x.id==='working-soaker');
  s.roof.sprayEnabled=true;s.roof.dailyStartHour=23;s.roof.hoursPerDay=4;s.roof.onSec=3600;s.roof.offSec=0;
  const r=dailyResources(p,s),roof=r.systems.find(x=>x.kind==='roof');
  assert.equal(roof.onTotalSec,14400);
  const flow=p.scenarios.find(x=>x.id==='working-soaker').waterSystems.find(w=>w.kind==='soaker');
  const soaker=r.systems.find(x=>x.kind==='soaker');
  assert.equal(soaker.onTotalSec,onTotalSeconds(8,120,600));
  near(r.fanKwhPerDay,s.fans.filter(f=>f.enabled).length*.4*16);
});
test('timing interaction: fan overlapping wet hours lowers D vs fan running only when dry',()=>{
  const mk=start=>{const p=createProject();const s=p.scenarios.find(x=>x.id==='working-soaker');for(const f of s.fans)f.dailyStartHour=start;return p};
  const a=mk(8),b=mk(18);// 08:00 fan covers soaker hours; 18:00 fan runs 18:00-10:00, missing wet film
  const da=simulateDaily(a).daily['working-soaker'],db=simulateDaily(b).daily['working-soaker'];
  assert.ok(db.dailyDeficitWPerCow>da.dailyDeficitWPerCow,`expected timing to matter: ${db.dailyDeficitWPerCow} !> ${da.dailyDeficitWPerCow}`);
});
test('invalid milk settings and device-inside-solid produce status+reasons, never silent yields',()=>{
  const p=createProject();p.milkSimulation.occupancyFractions={stall:.8,feeding:.2,waiting:.2};
  const d=simulateDaily(p);
  for(const r of Object.values(d.daily)){assert.equal(r.status,'invalid_input');assert.equal(r.yieldKgPerCowDay,null);assert.ok(r.reasons.length>0);assert.ok(r.resources)}
  const q=createProject();q.scenarios[0].fans[0].x=34.5;q.scenarios[0].fans[0].y=9.5;// inside the utility solid
  const d2=simulateDaily(q);
  assert.equal(d2.daily.baseline.status,'invalid_input');
  assert.equal(d2.daily['working-soaker'].status,'available');
  assert.equal(d2.daily['working-soaker'].deltaKgPerCowDay,null,'baseline invalid -> delta must be null, yield still shown');
});
test('clamp order discriminates: per-second, per-point max(0,Qref-Q) before occupancy weighting',()=>{
  // Soaker wetting drives per-second Q across the chosen threshold, so
  // clamp-after-averaging formulas produce measurably different D.
  const measured=simulateDaily(createProject(),{collectQSeries:true});
  const probes=buildLayout(createProject().template).probes;
  const counts={stall:0,feeding:0,waiting:0};for(const q of probes)counts[q.kind]++;
  const occ=createProject().milkSimulation.occupancyFractions;
  // pick a threshold inside the widest per-probe time range -> guaranteed temporal crossing
  const ser0=measured.probeQSeries['working-soaker'];
  let best=ser0.keys().next().value,br=-1,lo=Infinity,hi=-Infinity;
  for(const [id,arr] of ser0){let l=Infinity,h=-Infinity;for(const q of arr){if(q<l)l=q;if(q>h)h=q}if(h-l>br){br=h-l;lo=l;hi=h;best=id}}
  assert.ok(br>1,'need a probe whose Q varies in time');
  const qref=(lo+hi)/2;
  const p=createProject();p.milkSimulation={...p.milkSimulation,referenceCoolingWPerCow:qref};
  const d=simulateDaily(p);
  for(const sid of Object.keys(d.daily)){
    const ser=measured.probeQSeries[sid];
    let expected=0,wrongTime=0,meanSum=0;
    for(const q of probes){
      const w=occ[q.kind]/counts[q.kind],arr=ser.get(q.id);
      let s=0,sm=0;for(const qv of arr){s+=Math.max(0,qref-qv);sm+=qv}
      expected+=w*s/arr.length;                    // correct: clamp per point per second
      wrongTime+=w*Math.max(0,qref-sm/arr.length); // wrong: clamp the time-averaged Q
      meanSum+=w*sm/arr.length;
    }
    const wrongAgg=Math.max(0,qref-meanSum);       // wrong: clamp the herd-averaged Q
    const got=d.daily[sid].dailyDeficitWPerCow;
    assert.ok(got!=null,`no deficit for ${sid}`);
    near(got,expected,1e-6,`D for ${sid}`);
    if(sid==='working-soaker'){
      assert.ok(Math.abs(expected-wrongTime)>1,`test must discriminate time-order: ${expected} vs ${wrongTime}`);
      assert.ok(Math.abs(expected-wrongAgg)>1,`test must discriminate spatial order: ${expected} vs ${wrongAgg}`);
    }
  }
});
test('save/restore keeps milk settings and schedules; milk settings change the input hash',()=>{
  const s=new ProjectStore();const h0=inputHash(s.project);
  s.updateMilk({potentialMilkKgPerCowDay:35});assert.notEqual(inputHash(s.project),h0);
  const h1=inputHash(s.project);s.setView({timeSec:600,metric:'speed'});assert.equal(inputHash(s.project),h1,'display state must not enter the physics hash');
  const text=s.serialize(),other=new ProjectStore();other.importJSON(text);assert.equal(other.serialize(),text);
  const a=simulateDaily(JSON.parse(text)),b=simulateDaily(other.project);
  assert.equal(JSON.stringify(a.daily),JSON.stringify(b.daily));
});
test('worker gate accepts both staged replies of the same job and rejects stale ones',()=>{
  const gate=new ResultGate(),old=gate.expect('h1'),cur=gate.expect('h2');
  assert.equal(gate.accepts({jobId:old,inputHash:'h1'}),false);
  assert.equal(gate.accepts({jobId:cur,inputHash:'h2',kind:'thermal-result'}),true);
  assert.equal(gate.accepts({jobId:cur,inputHash:'h2',kind:'daily-result'}),true);
  assert.equal(gate.accepts({jobId:cur,inputHash:'h1'}),false);
});
test('mergeDaily attaches per-scenario results and flips status',()=>{
  const p=createProject(),r=simulate(p,{envelope:false});
  assert.equal(r.dailyMilkStatus,'pending');
  const out=simulateDaily(p);
  mergeDaily(r,out.daily,out.thermal,'complete');
  assert.equal(r.dailyMilkStatus,'complete');
  for(const s of r.scenarios){assert.equal(s.dailyMilk.status,'available');assert.equal(s.dailyThermal.status,'complete');assert.equal(s.dailyThermal.weatherMode,'constant')}
});
test('warmup water state carries across the day boundary: split run == continuous, dry restart differs',()=>{
  const p=createProject();const s=p.scenarios.find(x=>x.id==='working-soaker');
  // roof spray 20:00-04:00 and soaker 21:00-05:00: both are ON and wet at the day boundary
  s.roof.sprayEnabled=true;s.roof.dailyStartHour=20;s.roof.hoursPerDay=8;s.roof.onSec=3600;s.roof.offSec=0;
  const sk=s.waterSystems.find(w=>w.kind==='soaker');sk.dailyStartHour=21;sk.hoursPerDay=8;
  const cont=simulateDaily(p,{returnState:true}).daily[s.id];
  assert.ok(cont.waterCheck.roofStartKg>0,`roof water must be carried in: ${cont.waterCheck.roofStartKg}`);
  assert.ok(cont.waterCheck.filmStartKg>0,`film water must be carried in: ${cont.waterCheck.filmStartKg}`);
  // an eval-only run fed the captured warmup state must reproduce the continuous run
  const state=simulateDaily(p,{warmupSec:86400,evalSec:60,returnState:true}).states[s.id];
  const split=simulateDaily(p,{warmupSec:0,initialState:state}).daily[s.id];
  near(split.waterCheck.roofStartKg,cont.waterCheck.roofStartKg);
  near(split.waterCheck.filmStartKg,cont.waterCheck.filmStartKg);
  near(split.dailyDeficitWPerCow,cont.dailyDeficitWPerCow);
  near(split.yieldKgPerCowDay,cont.yieldKgPerCowDay);
  // a dry restart is a different evaluation day — balance still closes but D differs
  const dry=simulateDaily(p,{warmupSec:0}).daily[s.id];
  assert.equal(dry.waterCheck.roofStartKg,0);assert.equal(dry.waterCheck.filmStartKg,0);
  assert.ok(Math.abs(dry.dailyDeficitWPerCow-cont.dailyDeficitWPerCow)>1e-6,`carried water must change the deficit: dry ${dry.dailyDeficitWPerCow} vs ${cont.dailyDeficitWPerCow}`);
  assert.ok(Math.abs(dry.waterCheck.roofResidualKg)<1e-6&&Math.abs(dry.waterCheck.filmResidualKg)<1e-6);
});
test('evaluation-day water balance closes (roof and film residuals ~ 0)',()=>{
  const p=createProject();const s=p.scenarios.find(x=>x.id==='working-soaker');
  s.roof.sprayEnabled=true;s.roof.hoursPerDay=8;s.roof.onSec=120;s.roof.offSec=480;
  const d=simulateDaily(p).daily[s.id];
  assert.ok(Math.abs(d.waterCheck.roofResidualKg)<1e-6,`roof residual ${d.waterCheck.roofResidualKg}`);
  assert.ok(Math.abs(d.waterCheck.filmResidualKg)<1e-6,`film residual ${d.waterCheck.filmResidualKg}`);
});
