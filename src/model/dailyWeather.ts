import type {DailyWeather,Environment,Project} from '../domain/project.js';
import {DAY_SEC} from './dailySchedule.js';

export const WEATHER_STEP_SEC=3600;
/** Weather changes once per clock hour when mode==='hourly'; -1 under constant. */
export function weatherIndexAt(p:Pick<Project,'dailyWeather'>,t:number):number{
 if(p.dailyWeather.mode!=='hourly')return -1;
 return Math.floor((t%DAY_SEC)/WEATHER_STEP_SEC);
}
/** Environment for the representative-day second `t`. Shared fields (pressure,
 * background wind, ventilation) come from `environment` for every hour. */
export function envAt(p:Pick<Project,'dailyWeather'|'environment'>,t:number):Environment{
 const dw=p.dailyWeather;
 if(dw.mode!=='hourly')return p.environment;
 const row=dw.hours.find(r=>r.hour===weatherIndexAt(p,t))!;
 return {...p.environment,temperatureC:row.temperatureC,relativeHumidityPct:row.relativeHumidityPct,solarRoofWm2:row.solarRoofWm2};
}
/** Seconds until the next hourly boundary; only meaningful when hourly mode is on. */
export const secondsToWeatherBoundary=(t:number)=>WEATHER_STEP_SEC-(t%WEATHER_STEP_SEC);

/** Validation reasons for a candidate dailyWeather object. Empty = usable. */
export function dailyWeatherReasons(dw:unknown):string[]{
 const r:string[]=[];
 if(dw===null||typeof dw!=='object'||Array.isArray(dw))return['日気象はオブジェクトが必要です'];
 const w=dw as Record<string,unknown>;
 if(w.mode!=='constant'&&w.mode!=='hourly')r.push('日気象のモードはconstantまたはhourlyです');
 if(w.hours!==undefined&&!Array.isArray(w.hours))r.push('日気象のhoursは配列が必要です');
 const rows=(w.hours??[]) as unknown[];
 const seen=new Set<number>();let prev=-1;
 for(const row of rows){
  if(row===null||typeof row!=='object'||Array.isArray(row)){r.push('日気象の行はオブジェクトが必要です');continue}
  const h=(row as Record<string,unknown>).hour;
  if(typeof h!=='number'||!Number.isInteger(h)||h<0||h>23||seen.has(h)||h<=prev){r.push('日気象のhourは0〜23の一意・昇順が必要です');continue}
  seen.add(h);prev=h;
  const f=(k:string,lo:number,hi:number,label:string)=>{const v=(row as Record<string,unknown>)[k];if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)r.push(`日気象${h}時の${label}は${lo}〜${hi}の有限数が必要です`)};
  f('temperatureC',20,40,'気温');f('relativeHumidityPct',0,100,'湿度');f('solarRoofWm2',0,1200,'屋根面日射');
 }
 if(w.mode==='hourly'&&(seen.size!==24||!seen.has(0)||!seen.has(23)))r.push('hourlyモードは0〜23時の24行が必要です');
 return r;
}

/** Keep the legacy milk weatherMode consistent with the single weather source. */
export function weatherModeOf(dw:DailyWeather):'constant-environment'|'hourly-representative-day'{
 return dw.mode==='hourly'?'hourly-representative-day':'constant-environment';
}
