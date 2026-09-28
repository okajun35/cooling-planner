import type {Fan,RoofSettings,WaterSystem} from '../domain/project.js';

export const DAY_SEC=86400;
export const positiveModulo=(a:number,b:number)=>((a%b)+b)%b;

/** Operation window policy `daily-window-reset-v1`: each day the window starts at dailyStartHour
 * (local representative-day clock, no calendar/DST), and a water system's on/off cycle restarts
 * in the ON phase at that time. Operation crossing midnight keeps going — nothing resets at 0:00. */
export const dailyElapsed=(t:number,dailyStartHour:number)=>positiveModulo(t-dailyStartHour*3600,DAY_SEC);
export const windowOn=(t:number,dailyStartHour:number,hoursPerDay:number,enabled:boolean)=>
  enabled&&hoursPerDay>0&&dailyElapsed(t,dailyStartHour)<hoursPerDay*3600;
export function waterOn(t:number,w:Pick<WaterSystem,'enabled'|'onSec'|'offSec'|'hoursPerDay'|'dailyStartHour'>){
  return windowOn(t,w.dailyStartHour,w.hoursPerDay,w.enabled)&&w.onSec>0&&dailyElapsed(t,w.dailyStartHour)%(w.onSec+w.offSec)<w.onSec;
}
export const fanOn=(t:number,f:Pick<Fan,'enabled'|'hoursPerDay'|'dailyStartHour'>)=>windowOn(t,f.dailyStartHour,f.hoursPerDay,f.enabled);
export const roofSprayOn=(t:number,r:Pick<RoofSettings,'sprayEnabled'|'onSec'|'offSec'|'hoursPerDay'|'dailyStartHour'>)=>waterOn(t,{...r,enabled:r.sprayEnabled});

/** Valid start-of-day input: [0,24) in 0.25 h steps. */
export const validDailyStartHour=(h:unknown):h is number=>typeof h==='number'&&Number.isFinite(h)&&h>=0&&h<24&&Math.abs(h*4-Math.round(h*4))<1e-9;

/** Seconds until the next change of a windowed on/off mask. Window edges are the
 * daily start (elapsed 0) and the window end (elapsed = hoursPerDay*3600); water adds
 * cycle edges within the window. Used to skip stretches where inputs cannot change. */
export function secondsToNextToggle(t:number,w:Pick<WaterSystem,'enabled'|'onSec'|'offSec'|'hoursPerDay'|'dailyStartHour'>,cyclic:boolean){
  const elapsed=dailyElapsed(t,w.dailyStartHour);
  const windowLen=w.hoursPerDay*3600;
  let next:number;
  if(elapsed<windowLen)next=t+(windowLen-elapsed);          // inside the window -> window end
  else next=t+(DAY_SEC-elapsed);                           // outside -> next daily start
  if(cyclic&&w.onSec>0&&elapsed<windowLen){
    const period=w.onSec+w.offSec,phase=elapsed%period;
    next=Math.min(next,t+(phase<w.onSec?w.onSec:period)-phase);
  }
  return next-t;
}
