import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonStats} from '../../.compiled/model/comparisonStats.js';

const q=(id,deficit,over={})=>({probeId:id,status:'valid',meanDeficitW:deficit,deltaQrefW:0,meanSpeedMps:1,meanAirTemperatureC:30,meanRelativeHumidityPct:60,fanActionFraction:1,soakerArrivalFraction:0,mistEvaporationActionFraction:0,...over});
const area={id:'all',label:'全地点',probeIds:['a','b','c']};

test('average improvement does not conceal a worsened or unchanged remaining deficit',()=>{
 const st=comparisonStats([q('a',0),q('b',110),q('c',100)],[q('a',300),q('b',100),q('c',100)],area);
 assert.equal(st.meanDeficitW,70);
 assert.equal(st.deficitReductionW,500/3-70);
 assert.equal(st.unchangedOrWorseDeficitCount,2);
 assert.equal(st.worsenedDeficitCount,1);
 assert.deepEqual(st.topRemaining.map(p=>[p.probeId,p.deficitW,p.deficitReductionW]),[['b',110,-10],['c',100,0]]);
});

test('roof-only improvement and remaining local noncoverage are distinct',()=>{
 const off={fanActionFraction:0,soakerArrivalFraction:0,mistEvaporationActionFraction:0};
 const st=comparisonStats([q('a',80,off),q('b',0),q('c',0)],[q('a',150,off),q('b',0),q('c',0)],area);
 assert.equal(st.deficitNoActionCount,1);
 assert.equal(st.unchangedOrWorseDeficitCount,0);
 assert.equal(st.topRemaining[0].deficitReductionW,70);
});

test('invalid or missing data cannot become a complete mean, maximum, or zero count',()=>{
 const base=[q('a',100),q('b',100),q('c',100)];
 const st=comparisonStats([q('a',80),q('b',null,{status:'invalid'}),q('c',0)],base,area);
 assert.equal(st.meanDeficitW,null);
 assert.equal(st.maxDeficitW,null);
 assert.equal(st.unchangedOrWorseDeficitCount,null);
 assert.equal(st.worsenedDeficitCount,null);
 assert.equal(st.deficitReductionW,null);
 const badBase=comparisonStats(base,[q('a',100),q('b',null,{status:'invalid'}),q('c',100)],area);
 assert.equal(badBase.meanDeficitW,100);
 assert.equal(badBase.deficitReductionW,null);
 assert.equal(badBase.unchangedOrWorseDeficitCount,null);
 assert.equal(badBase.topRemaining.find(q=>q.probeId==='b').deficitReductionW,null);
});
