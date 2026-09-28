import {test} from 'node:test';
import assert from 'node:assert/strict';
import {windowOn,waterOn,fanOn,roofSprayOn,secondsToNextToggle,validDailyStartHour,dailyElapsed,DAY_SEC} from '../../.compiled/model/dailySchedule.js';
import {onTotalSeconds} from '../../.compiled/model/physics.js';
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);

const fan=(over={})=>({enabled:true,hoursPerDay:16,dailyStartHour:8,...over});
const water=(over={})=>({enabled:true,onSec:120,offSec:480,hoursPerDay:8,dailyStartHour:8,...over});
const countOn=(fn,day=0)=>{let n=0;for(let t=day*DAY_SEC;t<(day+1)*DAY_SEC;t++)if(fn(t))n++;return n};
const onRanges=(fn,day=1)=>{const r=[];let s=null;for(let t=day*DAY_SEC;t<(day+1)*DAY_SEC;t++){const on=fn(t);if(on&&s===null)s=t;if(!on&&s!==null){r.push([s-day*DAY_SEC,t-day*DAY_SEC]);s=null}}if(s!==null)r.push([s-day*DAY_SEC,DAY_SEC]);return r};

test('startHour validation: [0,24) in 0.25 steps',()=>{
  for(const ok of [0,8,22.5,23.75])assert.ok(validDailyStartHour(ok));
  for(const bad of [-1,24,8.1,NaN,Infinity,'8',null])assert.ok(!validDailyStartHour(bad));
});
test('08:00 start, 16 h fan -> on 08:00-24:00 only',()=>{
  const f=fan();
  assert.deepEqual(onRanges(t=>fanOn(t,f)),[[8*3600,24*3600]]);
  assert.equal(countOn(t=>fanOn(t,f)),16*3600);
});
test('22:00 start, 4 h -> crosses midnight, no reset at 0:00',()=>{
  const f=fan({dailyStartHour:22,hoursPerDay:4});
  assert.deepEqual(onRanges(t=>fanOn(t,f)),[[0,2*3600],[22*3600,24*3600]]);
  // continuous: on from 22:00 through 02:00 next day
  assert.ok(fanOn(22*3600,f)&&fanOn(25*3600,f)&&fanOn(26*3600-1,f)&&!fanOn(26*3600,f));
});
test('water cycle restarts ON at daily start, keeps phase across midnight',()=>{
  const w=water({dailyStartHour:22,hoursPerDay:4,onSec:100,offSec:200});
  // ON at 22:00 for 100s; next ON at 22:00+300s etc. Continuous across 0:00.
  assert.ok(waterOn(22*3600,w)&&waterOn(22*3600+99,w)&&!waterOn(22*3600+100,w));
  assert.equal(dailyElapsed(DAY_SEC+2*3600,22),4*3600);
  // 22:00 -> 00:00 is exactly 24 periods of 300 s, so a midnight reset would be invisible.
  // Use a 350 s period: 7200 % 350 = 200, so at 00:00 the anchored cycle is mid-OFF.
  const w2=water({dailyStartHour:22,hoursPerDay:6,onSec:90,offSec:260});
  assert.equal(dailyElapsed(DAY_SEC,22),7200);
  assert.equal(waterOn(DAY_SEC-1,w2),false,'23:59:59 is phase 199, OFF');
  assert.equal(waterOn(DAY_SEC,w2),false,'00:00:00 is phase 200 of the 22:00 cycle; a midnight restart would be ON');
  assert.equal(waterOn(DAY_SEC+149,w2),false,'OFF continues until the anchored cycle wraps');
  assert.equal(waterOn(DAY_SEC+150,w2),true,'phase wraps to 0 at 00:02:30 -> ON resumes');
  assert.equal(waterOn(DAY_SEC+239,w2),true);
  assert.equal(waterOn(DAY_SEC+240,w2),false,'ON ends 90 s after phase 0');
});
test('cycle not dividing the day resets at the daily start, not at midnight',()=>{
  const w=water({dailyStartHour:8,hoursPerDay:24,onSec:120,offSec:580});// period 700, 86400/700 not integer
  // one second before the next daily start, cycle phase 299 of 700 -> OFF;
  // at the start itself the cycle restarts ON even though a continuous phase would not
  const t=2*DAY_SEC+8*3600-1;
  assert.equal(waterOn(t,w),false);
  assert.equal(waterOn(t+1,w),true);
  assert.equal(waterOn(t+1+119,w),true);
  assert.equal(waterOn(t+1+120,w),false);
});
test('0 h off, 24 h full window; ON=0 no supply, OFF=0 supply through window',()=>{
  assert.equal(countOn(t=>fanOn(t,fan({hoursPerDay:0}))),0);
  assert.equal(countOn(t=>fanOn(t,fan({hoursPerDay:24}))),DAY_SEC);
  assert.equal(countOn(t=>waterOn(t,water({onSec:0}))),0);
  assert.equal(countOn(t=>waterOn(t,water({offSec:0}))),8*3600);
});
test('different start hours per equipment are independent',()=>{
  const a=water({dailyStartHour:6}),b=water({dailyStartHour:20});
  assert.ok(waterOn(6*3600,a)&&!waterOn(6*3600,b));
  assert.ok(waterOn(20*3600,b)&&!waterOn(20*3600,a));
});
test('on-seconds integrated over a day equal the analytic finite-cycle total',()=>{
  for(const w of [water(),water({onSec:60,offSec:240}),water({onSec:120,offSec:580,hoursPerDay:24}),water({hoursPerDay:4,dailyStartHour:22}),water({onSec:0}),water({offSec:0}),water({hoursPerDay:0})]){
    assert.equal(countOn(t=>waterOn(t,w),1),countOn(t=>waterOn(t,w)));// periodic: day-1 count == day-0 count
    assert.equal(countOn(t=>waterOn(t,w)),w.enabled&&w.onSec>0?onTotalSeconds(w.hoursPerDay,w.onSec,w.offSec):0,JSON.stringify(w));
  }
});
test('secondsToNextToggle lands exactly on window and cycle edges',()=>{
  const w=water();
  assert.equal(secondsToNextToggle(8*3600,w,true),120);// ON -> OFF edge
  assert.equal(secondsToNextToggle(8*3600+121,w,true),479);// OFF -> ON edge
  assert.equal(secondsToNextToggle(15*3600,w,true),120);
});
test('secondsToNextToggle off-window -> next daily start',()=>{
  const w=water();
  assert.equal(secondsToNextToggle(17*3600,w,true),15*3600);// 17:00 -> next 08:00
  assert.equal(secondsToNextToggle(7*3600,w,true),3600);
});
