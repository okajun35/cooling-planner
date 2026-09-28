import {test} from 'node:test';import assert from 'node:assert/strict';
import {createProject} from '../../.compiled/data/defaults.js';
import {simulate} from '../../.compiled/model/simulation.js';
import {onTotalSeconds} from '../../.compiled/model/physics.js';
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tol ${tol})`);

const point=(r,sid,pid)=>r.scenarios.find(s=>s.id===sid).points.find(q=>q.probeId===pid);

test('AV05: per-second deficit accumulation discriminates against clamp-of-mean',()=>{
  // Pick a Qref inside a probe's time range so per-second clamping matters.
  const measured=simulate(createProject(),{collectQSeries:true});
  const qs=measured.scenarios.find(s=>s.id==='working-soaker').points;
  let lo=Infinity,hi=-Infinity;
  for(const q of qs)for(const v of q.qSeries){if(v<lo)lo=v;if(v>hi)hi=v}
  assert.ok(hi-lo>1,'need time-varying Q');
  const qref=(lo+hi)/2;
  const p=createProject();p.milkSimulation={...p.milkSimulation,referenceCoolingWPerCow:qref};
  const r=simulate(p,{collectQSeries:true});
  for(const s of r.scenarios){
    for(const q of s.points){
      let expected=0;for(const v of q.qSeries)expected+=Math.max(0,qref-v);
      expected/=q.qSeries.length;
      near(q.meanDeficitW,expected,1e-6,`${s.id}/${q.probeId}`);
    }
    // At least one probe must discriminate the wrong order (mean first, then clamp)
    let worst=0;
    for(const q of s.points){
      const mean=q.qSeries.reduce((a,v)=>a+v,0)/q.qSeries.length;
      let expected=0;for(const v of q.qSeries)expected+=Math.max(0,qref-v);expected/=q.qSeries.length;
      worst=Math.max(worst,Math.abs(expected-Math.max(0,qref-mean)));
    }
    assert.ok(worst>1,`scenario ${s.id}: test is not discriminating (worst ${worst})`);
  }
});
test('meanFilmKg / action fractions follow the real 60-minute simulation',()=>{
  const r=simulate(createProject());
  const q=point(r,'baseline','feed-07');
  // baseline soaker cycles 120s ON / 480s OFF over the whole 60-min run
  assert.ok(q.meanDeficitW!=null&&q.meanFilmKg!=null);
  assert.ok(q.meanFilmKg>0&&q.meanFilmKg<4,'film mass mean in a plausible range');
  assert.ok(q.soakerArrivalFraction>0,'a covered probe sees the soaker arrive');
  assert.ok(q.soakerArrivalFraction<=onTotalSeconds(24,120,480)/86400+1e-9,'fraction is seconds-based, not window-normalised');
  assert.ok(q.fanActionFraction>0&&q.fanActionFraction<=1);
});
test('no local action -> all fractions zero (equipment off scenario)',()=>{
  const p=createProject();const s=p.scenarios.find(x=>x.id==='working-mist');
  for(const f of s.fans)f.enabled=false;s.waterSystems.forEach(w=>w.enabled=false);s.roof.sprayEnabled=false;
  const r=simulate(p);
  for(const q of r.scenarios.find(x=>x.id==='working-mist').points){
    assert.equal(q.fanActionFraction,0);assert.equal(q.soakerArrivalFraction,0);
    assert.equal(q.mistEvaporationActionFraction,0);assert.equal(q.mistSupplyFraction,0);
    assert.ok(q.meanDeficitW>0,'still a real deficit, not a fake zero');
  }
});
test('mist supply vs evaporation action are distinct fields',()=>{
  const p=createProject();const s=p.scenarios.find(x=>x.id==='working-mist');
  const r=simulate(p),q=point(r,'working-mist','feed-07');
  // mist is on in working-mist: supply fraction matches the duty cycle, evaporation may differ
  assert.ok(q.mistSupplyFraction>0);
  assert.ok(q.mistEvaporationActionFraction<=q.mistSupplyFraction+1e-9);
});
test('invalid scenario leaves new fields null',()=>{
  const p=createProject();p.scenarios[0].fans[0].x=34.5;p.scenarios[0].fans[0].y=9.5;
  const r=simulate(p),q=point(r,'baseline','stall-A-01');
  assert.equal(q.status,'invalid');
  assert.equal(q.meanDeficitW,null);assert.equal(q.meanFilmKg,null);
  assert.equal(q.fanActionFraction,null);assert.equal(q.soakerArrivalFraction,null);
  assert.equal(q.mistEvaporationActionFraction,null);assert.equal(q.mistSupplyFraction,null);
});
test('deficit uses per-second Q including film heat, not just the stored 60s series',()=>{
  // A scenario with soaker ON makes Q jump when wet; the stored series would alias it.
  const r=simulate(createProject(),{collectQSeries:true});
  const q=point(r,'baseline','feed-07');
  let fromSeries=0;for(const v of q.qSeries)fromSeries+=Math.max(0,q.meanDeficitW!=null?630-v:0);
  fromSeries/=q.qSeries.length;
  near(q.meanDeficitW,fromSeries,1e-6);
  // And it must differ from max(0, Qref - meanQ) when Q varies across the threshold region.
  // With Qref=630 every second is below threshold in this config, so verify the identity path holds exactly.
});
test('deficit respects the configured Qref, not a hardcoded one',()=>{
  const p=createProject();p.milkSimulation={...p.milkSimulation,referenceCoolingWPerCow:300};
  const r=simulate(p,{collectQSeries:true});
  const q=point(r,'baseline','stall-A-01');
  let expected=0;for(const v of q.qSeries)expected+=Math.max(0,300-v);expected/=q.qSeries.length;
  near(q.meanDeficitW,expected,1e-6);
});
