import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../../.compiled/data/defaults.js';
import {buildLayout} from '../../.compiled/template/layout.js';
import {buildAreas} from '../../.compiled/template/faces.js';
import {areaStats,hasDeficit,noLocalAction,deficitUnreached} from '../../.compiled/model/areaStats.js';
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tol ${tol})`);

const point=(id,over={})=>({probeId:id,status:'valid',meanDeficitW:0,deltaQrefW:0,meanSpeedMps:1,meanAirTemperatureC:30,meanRelativeHumidityPct:70,fanActionFraction:0,soakerArrivalFraction:0,mistEvaporationActionFraction:0,mistSupplyFraction:0,...over});
const areaOf=(probeIds)=>({id:'x',label:'x',probeIds});

test('AV06: mean/max/count over valid points; any invalid -> mean not evaluated',()=>{
  const st=areaStats([point('a',{meanDeficitW:0}),point('b',{meanDeficitW:200})],areaOf(['a','b']));
  near(st.meanDeficitW,100);near(st.maxDeficitW,200);
  assert.equal(st.deficitCount,1);assert.equal(st.probeCount,2);assert.equal(st.validCount,2);
  const inv=areaStats([point('a'),{...point('b',{meanDeficitW:200}),status:'invalid'}],areaOf(['a','b']));
  assert.equal(inv.meanDeficitW,null,'area mean must be unevaluated, not a silent partial mean');
  assert.equal(inv.validCount,1);assert.equal(inv.invalidCount,1);assert.equal(inv.probeCount,2);
});
test('AV06: improvement mean and top-3 deficits (ties by probe id order)',()=>{
  const ps=[point('a',{meanDeficitW:300,deltaQrefW:10}),point('b',{meanDeficitW:300,deltaQrefW:20}),point('c',{meanDeficitW:50,deltaQrefW:-5}),point('d',{meanDeficitW:0,deltaQrefW:0})];
  const st=areaStats(ps,areaOf(['a','b','c','d']));
  near(st.meanDeficitW,162.5);near(st.meanImprovementW,6.25);
  assert.equal(st.deficitCount,3);
  assert.deepEqual(st.topDeficit.map(t=>t.probeId),['a','b','c'],'top 3, tie keeps probe order');
});
test('unavailable baseline comparison stays unavailable — never a silent zero',()=>{
  // Active valid but baseline invalid -> deltaQrefW null. The area mean must be null,
  // not "0 improvement".
  const st=areaStats([point('a',{deltaQrefW:null,meanDeficitW:0}),point('b',{deltaQrefW:50,meanDeficitW:10})],areaOf(['a','b']));
  assert.equal(st.meanImprovementW,null,'one member has no comparison -> area improvement unavailable');
  assert.equal(st.meanDeficitW,5,'other metrics still aggregate');
  // a null metric on a valid point also blocks that metric's mean
  const st2=areaStats([point('a',{meanSpeedMps:null}),point('b',{meanSpeedMps:2})],areaOf(['a','b']));
  assert.equal(st2.meanSpeedMps,null);
});
test('AV07: stall subtotal is a direct 50-point mean, not an average of row averages',()=>{
  const l=buildLayout(createProject().template),areas=buildAreas(l);
  const stallA=areas.find(a=>a.id==='stall-A');
  const ps=l.probes.map(q=>point(q.id,{meanDeficitW:stallA.probeIds.includes(q.id)?100:0}));
  const st=areaStats(ps,areas.find(a=>a.id==='stalls'));
  near(st.meanDeficitW,100*13/50);// direct mean over 50 = 26; averaging the four row means would give 25
});
test('hasDeficit threshold is a tiny epsilon, not a health bound',()=>{
  assert.equal(hasDeficit(point('a',{meanDeficitW:0})),false);
  assert.equal(hasDeficit(point('a',{meanDeficitW:1e-7})),false);
  assert.equal(hasDeficit(point('a',{meanDeficitW:2e-6})),true);
  assert.equal(hasDeficit(point('a',{meanDeficitW:null})),false);
});
test('noLocalAction needs all three action fractions at zero; deficitUnreached combines both',()=>{
  assert.equal(noLocalAction(point('a')),true);
  assert.equal(noLocalAction(point('a',{fanActionFraction:.1})),false);
  assert.equal(noLocalAction(point('a',{soakerArrivalFraction:.1})),false);
  assert.equal(noLocalAction(point('a',{mistEvaporationActionFraction:.1})),false);
  assert.equal(deficitUnreached(point('a',{meanDeficitW:100})),true);
  assert.equal(deficitUnreached(point('a',{meanDeficitW:100,fanActionFraction:.5})),false);
  assert.equal(deficitUnreached(point('a',{meanDeficitW:0})),false);
});
test('supply is not action: mist supplied but saturated still counts as no evaporation action',()=>{
  const q=point('a',{mistSupplyFraction:.5,mistEvaporationActionFraction:0});
  assert.equal(noLocalAction(q),true,'supply alone is not an action signal');
});
test('detail stats: speed/temp/rh means over valid points',()=>{
  const st=areaStats([point('a',{meanSpeedMps:1,meanAirTemperatureC:30,meanRelativeHumidityPct:60}),point('b',{meanSpeedMps:3,meanAirTemperatureC:34,meanRelativeHumidityPct:80})],areaOf(['a','b']));
  near(st.meanSpeedMps,2);near(st.meanAirTemperatureC,32);near(st.meanRelativeHumidityPct,70);
});
