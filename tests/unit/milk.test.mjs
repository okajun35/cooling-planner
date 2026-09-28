import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../../.compiled/data/defaults.js';
import {buildLayout} from '../../.compiled/template/layout.js';
import {
  MILK_MODEL_ID,deficitW,occupancyWeights,laggedDeficit,milkFromDeficit,
  dailyFromDeficit,sensitivityYields,deltaYield,validateMilkSettings,DEFAULT_MILK_SIMULATION
} from '../../.compiled/model/milk.js';
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tol ${tol})`);
const S=()=>structuredClone(DEFAULT_MILK_SIMULATION);

// ---- MH02/MH03: deficit floor and no gain above Y0 ----
test('MH03: Q above Qref gives H=0; surplus cooling never offsets deficit',()=>{
  const s=S();
  assert.equal(deficitW(700,s.referenceCoolingWPerCow),0);
  assert.equal(deficitW(630,s.referenceCoolingWPerCow),0);
  assert.equal(deficitW(430,s.referenceCoolingWPerCow),200);
});
test('MH02: zero deficit today and past days keeps Y=Y0',()=>{
  const s=S();
  const r=milkFromDeficit(0,s);
  near(r.yieldKgPerCowDay,s.potentialMilkKgPerCowDay);
  near(r.lossKgPerCowDay,0);
  assert.equal(r.lossCapped,false);
});
// ---- MH04: cap ----
test('MH04: E=1200 hits 25% cap -> Y=30, lossCapped',()=>{
  const s=S();
  const r=milkFromDeficit(1200,s);
  near(r.lossKgPerCowDay,10);
  near(r.yieldKgPerCowDay,30);
  assert.equal(r.lossCapped,true);
  const just=S();const r2=milkFromDeficit(999.9,just);
  assert.equal(r2.lossCapped,false);near(r2.lossKgPerCowDay,9.999,1e-6);
});
test('MH04 boundary: E=999.9 / 1000 / 1000.1 with beta=0.010, cap=10 kg',()=>{
  const s=S();
  const below=milkFromDeficit(999.9,s);
  near(below.lossKgPerCowDay,9.999,1e-6);near(below.yieldKgPerCowDay,30.001,1e-6);
  assert.equal(below.lossCapped,false);
  const at=milkFromDeficit(1000,s);// raw loss == cap exactly -> reached the cap
  near(at.lossKgPerCowDay,10);near(at.yieldKgPerCowDay,30);
  assert.equal(at.lossCapped,true,'loss exactly at the cap must be reported as capped');
  const over=milkFromDeficit(1000.1,s);
  near(over.lossKgPerCowDay,10);near(over.yieldKgPerCowDay,30);
  assert.equal(over.lossCapped,true);
});
// ---- MH05: 12h deficit aggregation ----
test('MH05: 200 W deficit for 12 h then 0 -> D=100 W',()=>{
  const s=S();let sum=0;
  for(let t=0;t<86400;t++)sum+=(t<43200?200:0);
  const r=dailyFromDeficit(sum/86400,s);
  near(r.dailyDeficitWPerCow,100);near(r.laggedDeficitWPerCow,100);
  near(r.yieldKgPerCowDay,39);
});
// ---- MH06: per-point max before spatial average ----
test('MH06: two equal-weight points Q=430/830 -> mean deficit 100 W, not 0',()=>{
  const s=S(),qref=s.referenceCoolingWPerCow;
  const weighted=0.5*deficitW(430,qref)+0.5*deficitW(830,qref);
  near(weighted,100);
  assert.ok(weighted>0,'averaging Q first would hide the deficit');
});
// ---- zone weights ----
test('zone weights: 50 stall / 12 feeding / 8 waiting, sum to 1, kind shares 14/6/4',()=>{
  const layout=buildLayout(createProject().template);
  const s=S();
  const w=occupancyWeights(layout.probes,s.occupancyFractions);
  assert.ok('weights' in w);
  assert.equal(w.counts.stall,50);assert.equal(w.counts.feeding,12);assert.equal(w.counts.waiting,8);
  near(w.weights.get('stall-A-01'),(14/24)/50);
  near(w.weights.get('feed-01'),(6/24)/12);
  near(w.weights.get('wait-1'),(4/24)/8);
  let total=0;for(const v of w.weights.values())total+=v;
  near(total,1,1e-12);
  const byKind={stall:0,feeding:0,waiting:0};
  for(const q of layout.probes)byKind[q.kind]+=w.weights.get(q.id);
  near(byKind.stall,14/24);near(byKind.feeding,6/24);near(byKind.waiting,4/24);
});
test('zone weights: missing zone, unknown kind, or bad fractions -> error, no renormalisation',()=>{
  const layout=buildLayout(createProject().template);
  const s=S();
  assert.ok('error' in occupancyWeights(layout.probes.filter(q=>q.kind!=='waiting'),s.occupancyFractions));
  const unknown=[...layout.probes,{id:'x1',label:'x',x:1,y:1,heightM:1,zoneId:'stall-A',patchYawDeg:90,kind:'isle'}];
  assert.ok('error' in occupancyWeights(unknown,s.occupancyFractions));
  assert.ok('error' in occupancyWeights(layout.probes,{stall:0.6,feeding:0.6,waiting:0.6}));
  assert.ok('error' in occupancyWeights(layout.probes,{stall:-0.1,feeding:0.6,waiting:0.5}));
});
// ---- MH07: switching lag series 37.4 -> 38.4 -> 39.0 ----
test('MH07: D 300->100 switch reproduces Y=37.4,38.4,39.0',()=>{
  const s=S();
  // Before switch: two days at D=300 (so E=300, Y=37)
  const y0=milkFromDeficit(laggedDeficit(300,300,300,s.lagWeights),s);near(y0.yieldKgPerCowDay,37);
  const e1=laggedDeficit(100,300,300,s.lagWeights);near(e1,260);
  near(milkFromDeficit(e1,s).yieldKgPerCowDay,37.4,1e-9);
  const e2=laggedDeficit(100,100,300,s.lagWeights);near(e2,160);
  near(milkFromDeficit(e2,s).yieldKgPerCowDay,38.4,1e-9);
  const e3=laggedDeficit(100,100,100,s.lagWeights);near(e3,100);
  near(milkFromDeficit(e3,s).yieldKgPerCowDay,39.0,1e-9);
});
// ---- MH01 / MH08 / MH09: deltas ----
test('MH01/MH08/MH09: identical -> delta 0; rebaseline changes only delta; negative delta kept',()=>{
  const s=S();
  const a=dailyFromDeficit(300,s),b=dailyFromDeficit(300,s),c=dailyFromDeficit(100,s),worse=dailyFromDeficit(500,s);
  near(deltaYield(b,a),0);near(deltaYield(c,a),2);near(deltaYield(worse,a),-2);
  // rebaseline: compare against a different baseline keeps own Y, changes delta only
  const d=dailyFromDeficit(50,s);
  near(d.yieldKgPerCowDay,39.5);
  near(deltaYield(d,c),0.5);near(c.yieldKgPerCowDay,39);
});
test('repeated-day E equals D (D[d-1]=D[d-2]=D[d])',()=>{
  const s=S();
  for(const d of [0,50,100,300,5000]){
    const r=dailyFromDeficit(d,s);
    near(r.laggedDeficitWPerCow,d,1e-9);
  }
});
// ---- MH12: sensitivity betas applied identically ----
test('MH12: three beta conditions share the same D; labelled as assumption width',()=>{
  const s=S();
  const rows=sensitivityYields(100,s);
  assert.equal(rows.length,3);
  near(rows[0].yieldKgPerCowDay,39.5);near(rows[1].yieldKgPerCowDay,39);near(rows[2].yieldKgPerCowDay,38.5);
  assert.deepEqual(rows.map(r=>r.beta),[0.005,0.010,0.015]);
});
// ---- MH11: invalid inputs -> null with reasons ----
test('MH11: invalid coefficients rejected with reasons, not clamped',()=>{
  const bad=[
    m=>{m.potentialMilkKgPerCowDay=0},
    m=>{m.potentialMilkKgPerCowDay=NaN},
    m=>{m.responseKgPerCowDayPerW=-1},
    m=>{m.referenceCoolingWPerCow=-5},
    m=>{m.maxLossFraction=1.5},
    m=>{m.maxLossFraction=-0.1},
    m=>{m.lagWeights=[0.2,0.5,0.2]},
    m=>{m.lagWeights=[0.2,0.5,-0.1]},
    m=>{m.lagWeights=[0.2,0.5]},
    m=>{m.occupancyFractions={stall:0.5,feeding:0.5,waiting:0.5}},
    m=>{m.responseSensitivityKgPerCowDayPerW=[0.005,0.01]},
    m=>{m.modelId='other'},
    m=>{m.mode='time-series'},
    m=>{m.operationPolicy='midnight-reset'},
    m=>{m.warmupDurationSec=3600},
    m=>{m.timeStepSec=2},
    m=>{m.assumptionClass='measured'},
  ];
  for(const mutate of bad){const m=S();mutate(m);assert.ok(validateMilkSettings(m).length>0,JSON.stringify(mutate))}
  assert.deepEqual(validateMilkSettings(S()),[]);
});
test('defaults: model id, Y0=40, Qref=630, beta=0.010, rmax=0.25, lag 0.2/0.5/0.3, 24h/24h/1s',()=>{
  const s=S();
  assert.equal(s.modelId,MILK_MODEL_ID);
  assert.equal(s.potentialMilkKgPerCowDay,40);
  assert.equal(s.referenceCoolingWPerCow,630);
  assert.equal(s.responseKgPerCowDayPerW,0.010);
  assert.equal(s.maxLossFraction,0.25);
  assert.deepEqual(s.lagWeights,[0.2,0.5,0.3]);
  near(s.occupancyFractions.stall,14/24);near(s.occupancyFractions.feeding,6/24);near(s.occupancyFractions.waiting,4/24);
  assert.deepEqual(s.responseSensitivityKgPerCowDayPerW,[0.005,0.010,0.015]);
  assert.equal(s.warmupDurationSec,86400);assert.equal(s.evaluationDurationSec,86400);assert.equal(s.timeStepSec,1);
  assert.equal(s.assumptionClass,'demo_assumption');
});
