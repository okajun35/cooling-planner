import {test} from 'node:test';import assert from 'node:assert/strict';
import {createProject} from '../../.compiled/data/defaults.js';
import {inputHash} from '../../.compiled/model/simulation.js';
import {simulateDaily} from '../../.compiled/model/dailySimulation.js';
import {envAt,weatherIndexAt,secondsToWeatherBoundary,dailyWeatherReasons} from '../../.compiled/model/dailyWeather.js';
import {parseProject} from '../../.compiled/domain/validation.js';
import {ProjectStore} from '../../.compiled/state/store.js';
import {applyOperation} from '../../.compiled/mcp/commands.js';

/** 24 identical hourly rows copied from the constant environment. */
const flatHours=p=>Array.from({length:24},(_,h)=>({hour:h,temperatureC:p.environment.temperatureC,relativeHumidityPct:p.environment.relativeHumidityPct,solarRoofWm2:p.environment.solarRoofWm2}));
const hourlyProject=(p,fn)=>{p.dailyWeather={mode:'hourly',hours:fn?Array.from({length:24},(_,h)=>({hour:h,...fn(h)})):flatHours(p)};p.milkSimulation.weatherMode='hourly-representative-day';return p};

test('DW01: v9 project JSON migrates to schema 10 with constant weather',()=>{
 const p=JSON.parse(new ProjectStore().serialize());
 delete p.dailyWeather;p.schemaVersion=9;p.model.version='cooling-integrated-v0.9';p.milkSimulation.weatherMode='constant-environment';
 const migrated=parseProject(JSON.stringify(p));
 assert.equal(migrated.schemaVersion,10);
 assert.equal(migrated.model.version,'cooling-integrated-v0.10');
 assert.deepEqual(migrated.dailyWeather,{mode:'constant',hours:[]});
 assert.equal(migrated.milkSimulation.weatherMode,'constant-environment');
});

test('DW02: envAt/weatherIndexAt resolve the right hourly row at boundaries',()=>{
 const p=hourlyProject(createProject(),h=>({temperatureC:20+h,relativeHumidityPct:50,solarRoofWm2:h*10}));
 assert.equal(weatherIndexAt(p,0),0);assert.equal(weatherIndexAt(p,3599),0);assert.equal(weatherIndexAt(p,3600),1);
 assert.equal(weatherIndexAt(p,86399),23);assert.equal(weatherIndexAt(p,86400),0); // day wrap
 assert.equal(envAt(p,3600).temperatureC,21);
 assert.equal(envAt(p,0).pressurePa,p.environment.pressurePa); // shared fields come from environment
 assert.equal(envAt(p,0).solarRoofWm2,0);assert.equal(envAt(p,23*3600).solarRoofWm2,230);
 assert.equal(secondsToWeatherBoundary(0),3600);assert.equal(secondsToWeatherBoundary(3599),1);
 assert.equal(weatherIndexAt(createProject(),12345),-1); // constant mode
});

const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
test('DW03: flat hourly weather reproduces the constant-day result',()=>{
 const a=createProject(),b=hourlyProject(createProject());
 const da=simulateDaily(a),db=simulateDaily(b);
 assert.equal(db.status,'complete');
 for(const s of a.scenarios){
  near(db.daily[s.id].dailyDeficitWPerCow,da.daily[s.id].dailyDeficitWPerCow,1e-6);
  near(db.daily[s.id].yieldKgPerCowDay,da.daily[s.id].yieldKgPerCowDay,1e-9);
  const ta=da.thermal[s.id],tb=db.thermal[s.id];
  assert.equal(tb.weatherMode,'hourly');assert.equal(ta.weatherMode,'constant');
  for(let i=0;i<ta.points.length;i++)near(tb.points[i].meanDeficitW,ta.points[i].meanDeficitW,1e-6);
  near(tb.all.meanDeficitW,ta.all.meanDeficitW,1e-6);near(tb.all.maxDeficitW,ta.all.maxDeficitW,1e-6);
 }
});

test('DW04: hotter midday changes daily thermal and milk, hash changes',()=>{
 const base=hourlyProject(createProject());
 const hot=hourlyProject(createProject(),h=>({temperatureC:h>=10&&h<16?38:26,relativeHumidityPct:h>=10&&h<16?50:80,solarRoofWm2:h>=10&&h<16?1000:0}));
 assert.notEqual(inputHash(base),inputHash(hot));
 const db=simulateDaily(hot,{evalSec:86400});
 assert.equal(db.status,'complete');
 const s=hot.scenarios[1],t=db.thermal[s.id];
 assert.equal(t.status,'complete');assert.equal(t.evaluationDurationSec,86400);
 assert.ok(t.all.meanDeficitW>=0&&Number.isFinite(t.all.meanDeficitW));
 assert.equal(t.areas.length>0,true);
 assert.ok(db.daily[s.id].dailyDeficitWPerCow>=0);
 // daytime mean temperature at any point must sit between the hourly extremes
 for(const q of t.points){assert.ok(q.meanAirTemperatureC>20&&q.meanAirTemperatureC<45,`${q.probeId} mean air ${q.meanAirTemperatureC}`)}
});

test('DW05: update_daily_weather validates via Store; malformed rows rejected',()=>{
 const s=new ProjectStore();
 const ok=applyOperation(s,{operation:'update_daily_weather',patch:{mode:'hourly',hours:flatHours(s.committed)}});
 assert.equal(ok.applied.mode,'hourly');
 assert.equal(s.committed.milkSimulation.weatherMode,'hourly-representative-day');
 const h0=inputHash(s.committed);
 assert.throws(()=>applyOperation(s,{operation:'update_daily_weather',patch:{mode:'hourly',hours:flatHours(s.committed).slice(0,23)}}),/24行/);
 assert.throws(()=>applyOperation(s,{operation:'update_daily_weather',patch:{mode:'hourly',hours:[{hour:0,temperatureC:60,relativeHumidityPct:50,solarRoofWm2:0},...flatHours(s.committed).slice(1)]}}),/気温/);
 assert.equal(inputHash(s.committed),h0); // failed edits must not mutate
 applyOperation(s,{operation:'update_daily_weather',patch:{mode:'constant'}});
 assert.equal(s.committed.dailyWeather.mode,'constant');
 assert.equal(s.committed.milkSimulation.weatherMode,'constant-environment');
});

test('DW07: constant mode with hours omitted is normalized to an empty array on load',()=>{
 const p=JSON.parse(new ProjectStore().serialize());
 p.dailyWeather={mode:'constant'}; // hours omitted — must not reach runtime as undefined
 const loaded=parseProject(JSON.stringify(p));
 assert.deepEqual(loaded.dailyWeather,{mode:'constant',hours:[]});
 // hourly still requires the 24 rows even after normalization
 const h=JSON.parse(new ProjectStore().serialize());h.dailyWeather={mode:'hourly'};h.milkSimulation.weatherMode='hourly-representative-day';
 assert.throws(()=>parseProject(JSON.stringify(h)),/24行/);
});

test('DW06: dailyWeatherReasons enumerates structural errors',()=>{
 assert.equal(dailyWeatherReasons({mode:'constant',hours:[]}).length,0);
 assert.equal(dailyWeatherReasons(null).length>0,true);
 assert.equal(dailyWeatherReasons({mode:'x',hours:[]}).length>0,true);
 const dup=Array.from({length:24},()=>({hour:3,temperatureC:30,relativeHumidityPct:50,solarRoofWm2:0}));
 assert.match(dailyWeatherReasons({mode:'hourly',hours:dup}).join(' '),/昇順/);
});
