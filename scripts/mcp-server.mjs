/** Cooling Planner MCP PoC server (stdio).
 * Serves dist-offline on http://127.0.0.1:4174 and relays each MCP tool call to the
 * single browser tab open on /?mcp=1 via a local WebSocket /bridge. The browser holds
 * the authoritative ProjectStore; this process keeps no project copy.
 * stdout is the MCP channel — every log line goes to stderr.
 */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const HOST='127.0.0.1',PORT=Number(process.env.COOLING_PLANNER_PORT||4174);
const PAGE_URL=`http://${HOST}:${PORT}/?mcp=1`;
const root=path.resolve(fileURLToPath(new URL('../dist-offline/',import.meta.url)));
const log=(...a)=>console.error('[cooling-planner-mcp]',...a);

// ---- static files -----------------------------------------------------------
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.txt':'text/plain; charset=utf-8'};
const httpServer=http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url??'/',`http://${HOST}:${PORT}`).pathname);
  const file=path.resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
  const data=await readFile(file);
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(data);
 }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found')}
});

// ---- browser bridge ----------------------------------------------------------
const wss=new WebSocketServer({noServer:true});
let browser=null; // single connected tab (ws instance)
let nextId=1;
const pending=new Map(); // id -> {resolve,reject,timer}

httpServer.on('upgrade',(req,socket)=>{
 const pathname=new URL(req.url??'/',`http://${HOST}:${PORT}`).pathname;
 const origin=req.headers.origin;
 if(pathname!=='/bridge'||origin!==`http://${HOST}:${PORT}`){socket.destroy();return}
 wss.handleUpgrade(req,socket,Buffer.alloc(0),ws=>{
  if(browser&&browser.readyState===browser.OPEN){
   ws.close(4409,'Another tab is already connected. Use only the one open tab.');
   return;
  }
  browser=ws;
  log('browser connected');
  ws.on('message',data=>{
   let msg;try{msg=JSON.parse(data.toString())}catch{return}
   const p=pending.get(msg?.id);
   if(!p)return; // late or unknown reply
   pending.delete(msg.id);clearTimeout(p.timer);
   if(msg.ok)p.resolve(msg.data);else p.reject(new Error(msg.error??'an error occurred in the browser'));
  });
  ws.on('close',()=>{
   if(browser!==ws)return;browser=null;log('browser disconnected');
   for(const[id,e]of pending){pending.delete(id);clearTimeout(e.timer);e.reject(new Error('Lost the browser connection. Reload the page, then check state with get_state'))}
  });
 });
});

function callBrowser(command,args,timeoutMs=10000){
 return new Promise((resolve,reject)=>{
  if(!browser||browser.readyState!==browser.OPEN){
   reject(new Error(`No browser is connected. Open ${PAGE_URL} in a single tab`));return;
  }
  if(pending.size){reject(new Error('another operation is in progress. Wait a moment and retry'));return}
  const id=nextId++;
  const timer=setTimeout(()=>{
   pending.delete(id);
   reject(new Error(`No response from the browser (${Math.round(timeoutMs/1000)}s). Whether the change applied is unknown. Check the view state with get_state`));
  },timeoutMs);
  pending.set(id,{resolve,reject,timer});
  browser.send(JSON.stringify({id,command,args}));
 });
}

// ---- MCP tools ----------------------------------------------------------------
const asText=(data,isError=false)=>({content:[{type:'text',text:typeof data==='string'?data:JSON.stringify(data)}],...(isError?{isError:true}:{})});
const relay=async(command,args,timeoutMs)=>{try{return asText(await callBrowser(command,args,timeoutMs))}catch(e){return asText(e instanceof Error?e.message:String(e),true)}};

const DEVICE_PATCH=z.strictObject({
 x:z.number().optional().describe('along the barn length [m]'),
 y:z.number().optional().describe('along the barn width [m]'),
 heightM:z.number().optional().describe('height [m]'),
 yawDeg:z.number().optional(),pitchDownDeg:z.number().optional(),enabled:z.boolean().optional(),
 diameterM:z.number().optional(),outletSpeedMps:z.number().optional(),powerKw:z.number().optional(),
 hoursPerDay:z.number().optional(),dailyStartHour:z.number().optional(),
 flowLpm:z.number().optional(),halfAngleDeg:z.number().optional(),
}).describe('Device patch fields. Fans also accept diameterM/outletSpeedMps/powerKw/hoursPerDay/dailyStartHour; nozzles only flowLpm/halfAngleDeg. id/kind/anchor are immutable.');
const ROOF_PATCH=z.strictObject({
 reflectance:z.number().optional(),insulationM:z.number().optional(),sprayEnabled:z.boolean().optional(),
 flowLpmM2:z.number().optional(),onSec:z.number().optional(),offSec:z.number().optional(),
 hoursPerDay:z.number().optional(),dailyStartHour:z.number().optional(),pumpPowerKw:z.number().optional(),
});
const SYSTEM_PATCH=z.strictObject({
 enabled:z.boolean().optional(),onSec:z.number().optional(),offSec:z.number().optional(),
 hoursPerDay:z.number().optional(),dailyStartHour:z.number().optional(),pumpPowerKw:z.number().optional(),
});
const ENV_PATCH=z.strictObject({
 temperatureC:z.number().optional(),relativeHumidityPct:z.number().optional(),pressurePa:z.number().optional(),
 backgroundSpeedMps:z.number().optional(),ventilationM3sPerM2:z.number().optional(),solarRoofWm2:z.number().optional(),
});
const MODEL_PATCH=z.strictObject({
 surfaceTemperatureC:z.number().optional().describe('cow skin temperature ℃'),
 areaM2:z.number().optional(),wetAreaM2:z.number().optional(),patchLengthM:z.number().optional(),patchWidthM:z.number().optional(),
 baseWetFraction:z.number().optional(),emissivity:z.number().optional(),radiantOffsetC:z.number().optional(),
 kSpread:z.number().optional().describe('fan-jet spread coefficient'),kDecay:z.number().optional().describe('fan-jet decay coefficient'),
 latentHeatJkg:z.number().optional(),airDensityKgM3:z.number().optional(),airCpJkgK:z.number().optional(),vaporGasConstant:z.number().optional(),
 hcIntercept:z.number().optional().describe('convective heat-transfer intercept hc=a+b√v'),hcSlope:z.number().optional().describe('convective heat-transfer slope'),
 roof:z.strictObject({
  backgroundSensibleW:z.number().optional(),bareResistance:z.number().optional(),conductivity:z.number().optional(),
  hOutConv:z.number().optional(),hOutRad:z.number().optional(),hInConv:z.number().optional(),hInRad:z.number().optional(),
  viewFactor:z.number().optional(),waterCapacityKgM2:z.number().optional(),
 }).optional().describe('roof model coefficients'),
 profiles:z.record(z.string(),z.strictObject({
  outletMultiplier:z.number().optional(),hcMultiplier:z.number().optional(),mistEfficiency:z.number().optional(),maxFilmKg:z.number().optional(),
 })).optional().describe('profile ID (low/reference/high) -> coefficients. Adjusts the sensitivity assumption sets'),
}).describe('Physical-model coefficients. Used for sensitivity trials of assumptions. The model formulas themselves cannot be changed');
const MILK_PATCH=z.strictObject({
 potentialMilkKgPerCowDay:z.number().optional(),referenceCoolingWPerCow:z.number().optional().describe('reference heat-loss Qref [W] for the deficit'),
 responseKgPerCowDayPerW:z.number().optional().describe('milk response coefficient beta per 1W of deficit'),maxLossFraction:z.number().optional(),
 lagWeights:z.tuple([z.number(),z.number(),z.number()]).optional(),
 occupancyFractions:z.strictObject({stall:z.number(),feeding:z.number(),waiting:z.number()}).optional(),
 responseSensitivityKgPerCowDayPerW:z.tuple([z.number(),z.number(),z.number()]).optional(),
 warmupDurationSec:z.number().optional(),evaluationDurationSec:z.number().optional(),timeStepSec:z.number().optional(),
}).describe('Coefficients of the milk hypothesis model (milk-heat-deficit-v0.1)');
const REFERENCES_PATCH=z.strictObject({
 baselineMilkKgPerDay:z.number().nullable().optional(),
 fertility:z.strictObject({
  p0:z.number().optional(),mode:z.enum(['manual','simulation']).optional(),exposureAssumed:z.boolean().optional(),
  temperatureC:z.number().optional(),relativeHumidityPct:z.number().optional(),
 }).optional(),
});
const WEATHER_HOUR=z.strictObject({hour:z.number().int().min(0).max(23),temperatureC:z.number().min(20).max(40),relativeHumidityPct:z.number().min(0).max(100),solarRoofWm2:z.number().min(0).max(1200)});
const DAILY_WEATHER_PATCH=z.strictObject({mode:z.enum(['constant','hourly']),hours:z.array(WEATHER_HOUR).optional()}).describe('Representative-day weather. With mode:"hourly", supply 24 rows in hours with hour=0-23 ascending (hourly affects only the daily simulation). hours may be omitted when reverting to constant');

function createServer(){
 const server=new McpServer({name:'cooling-planner',version:'0.10.0-preview.1',instructions:[
  'Tools that operate the Cooling Planner page open in a browser. The browser holds the authoritative state.',
  `Call get_state first for the current state, IDs and selection. If no browser is connected, ask the user to open ${PAGE_URL} in a single tab.`,
  '"This cow" is interpreted as the selected point. Coordinates: x along the barn length, y the width, heightM the height. Lengths in m, angles in deg.',
  'Edits apply to the current scenario. The baseline is read-only. update_environment affects all scenarios.',
 'Model coefficients change via update_model (physics) / update_milk (milk hypothesis) / update_references (reference settings). Combine sensitivity trials with evaluate. Model formulas and version identifiers cannot be changed.',
  'To keep the state before a change, use copy_to_other (copies the current editable scenario over the other editable scenario and switches to it).',
  'Explain numbers using get_results. Never describe "not calculated", null or invalid as zero.',
  'meanQrefW is a point\'s net heat loss; deltaQrefW is the heat-loss difference from baseline; meanDeficitW is the 60-min mean of per-second deficits.',
  'resources are in L/day and kWh/day; trialWaterL/trialKwh cover the 60-min trial. Daily-milk resources are in dailyMilk.resources.',
  'Daily milk is a reference value of the hypothesis model (milk-heat-deficit-v0.1), not a guaranteed real-farm effect.',
  'Explain "why" via wind speed, radiation, the heat-loss breakdown and device action. When unsure, call it a hypothesis and compare one changed condition at a time.',
 'To compare hypotheses ("what if we changed X?", "which measure works?"), use evaluate instead of edit, get_results, undo. Pass operations per scenario and line up results without touching the view.',
 'Before interpreting results, call describe_model to check the model\'s structure, assumptions and limits. Never present reduced-order values as guaranteed real-farm values.',
 ].join('\n')});

 server.registerTool('get_state',{
  description:'Returns the committed state of the current view: each scenario\'s roof/fans/waterSystems, the shared environment, view, the point/area ID list, selection, undoCount, calculation state and modelNotes. Numeric results come from get_results.',
 },()=>relay('get_state'));

 const editSchema=z.discriminatedUnion('operation',[
  z.strictObject({operation:z.literal('switch_scenario'),scenarioId:z.string().describe('target scenario ID. The baseline may be selected for viewing')}),
  z.strictObject({operation:z.literal('copy_to_other')}).describe('Copies the current editable scenario over the other editable scenario and switches to it. Covers devices and the roof. Shared weather applies to all scenarios; previous values are not kept'),
  z.strictObject({operation:z.literal('update_device'),deviceId:z.string(),patch:DEVICE_PATCH}),
  z.strictObject({operation:z.literal('update_roof'),patch:ROOF_PATCH}),
  z.strictObject({operation:z.literal('update_system'),systemId:z.string(),patch:SYSTEM_PATCH}),
  z.strictObject({operation:z.literal('update_environment'),patch:ENV_PATCH}),
  z.strictObject({operation:z.literal('update_daily_weather'),patch:DAILY_WEATHER_PATCH}).describe('Set or clear representative-day hourly weather. Shared by all scenarios'),
 z.strictObject({operation:z.literal('update_model'),patch:MODEL_PATCH}).describe('Change physical-model coefficients. Like shared weather, applies to all scenarios'),
 z.strictObject({operation:z.literal('update_milk'),patch:MILK_PATCH}).describe('Change milk-hypothesis-model coefficients'),
 z.strictObject({operation:z.literal('update_references'),patch:REFERENCES_PATCH}).describe('Change reference settings (baseline milk, conception reference)'),
  z.strictObject({operation:z.literal('add_device'),kind:z.enum(['fan','soaker','mist']),x:z.number().optional().describe('placement along the length [m]'),y:z.number().optional().describe('placement along the width [m]. x and y must be given together')}),
  z.strictObject({operation:z.literal('duplicate_device'),deviceId:z.string()}),
  z.strictObject({operation:z.literal('remove_device'),deviceId:z.string()}),
 ]);
 server.registerTool('edit',{
  description:'Applies one operation to the current scenario or shared weather (reflected in the view immediately with auto-recalculation). Pass only the arguments each operation needs. On success returns the applied data and inputHash. Does not mean the calculation finished.',
  inputSchema:editSchema,
 },args=>relay('edit',args));

 server.registerTool('set_view',{
  description:'View-only changes (no physics, not undoable). Partial update of mode/metric/selected point, device and area/display flags/timeSec, and open/close of the bottom results sheet. Selecting a point also selects its area. timeSec stops playback.',
  inputSchema:z.strictObject({
   mode:z.enum(['3d','2d']).optional(),
   metric:z.enum(['delta','deficit','speed','temperature']).optional(),
   selectedProbeId:z.string().optional(),
   selectedDeviceId:z.string().nullable().optional(),
   selectedAreaId:z.string().nullable().optional(),
   analysis:z.boolean().optional(),realistic:z.boolean().optional(),heatmap:z.boolean().optional(),roof:z.boolean().optional(),flow:z.boolean().optional(),particles:z.boolean().optional(),
   timeSec:z.number().min(0).max(3600).optional(),
   sheet:z.enum(['compare','areas','timeline','reference']).nullable().optional().describe('Open the bottom results sheet on the given tab, or null to close it'),
  }),
 },args=>relay('set_view',args));

 server.registerTool('evaluate',{
  description:'Evaluates a hypothesis without changing the view. Applies the same operation array as edit, in order, to a clone of the committed state, computes it and returns the result. Does not affect the view\'s scenario, devices, Undo history or recalculation. Target scenario via scenarioId (default: current). Passing the returned project or the whole reply as a JSON file to Load / "Import MCP scenario JSON" restores and recalculates it. Returns the comparison of mean/max deficit and points whose deficit did not shrink vs baseline, per-area aggregates, resources and roof of the applied scenario, plus (with includeDaily) dailyMilk and dailyThermal (evaluation-day per-point/area mean deficit), and baseline aggregates for comparison. Use this tool, not edit then undo, for trials like "what if this device were here?" or "which measure helps?".',
  inputSchema:z.strictObject({
   operations:z.array(editSchema).describe('operation list applied in order to the clone (same operations/args as edit. An empty array computes the current state as-is)'),
   scenarioId:z.string().optional().describe('scenario ID to apply operations to. Default: current scenario. The baseline is read-only'),
   includeDaily:z.boolean().optional().describe('true also computes the daily-milk hypothesis model (takes tens of seconds. Default: 60-min thermal only)'),
  }),
 },args=>relay('evaluate',args,120000));

 server.registerTool('compare_candidates',{
  description:'Constrained candidate comparison. Applies 1-3 candidate operation lists separately to the same starting project and returns daily results (daily mean deficit, cooling water, power, worsened point count), constraint verdicts and ranks. Candidate operations are only update_device (enabled/position/direction/daily schedule), update_system (onoff/daily schedule) and update_roof. Coefficients, weather, scenario switching and device add/remove are not allowed as candidates. Ranks hold only within the call. The view does not change.',
  inputSchema:z.strictObject({
   scenarioId:z.string().optional().describe('editable scenario ID to apply candidates to. Default: current scenario. Baseline is not allowed'),
   candidates:z.array(z.strictObject({id:z.string().describe('candidate ID (unique within the call)'),operations:z.array(editSchema)})).min(1).max(3).describe('candidates to compare. Each applies to a fresh clone of the start project (not cumulative)'),
   constraints:z.strictObject({
    maxWaterLPerDay:z.number().optional().describe('daily supply-water cap [L] for cooling devices (soaker, mist, roof sprinkling)'),
    maxElectricityKwhPerDay:z.number().optional().describe('daily electricity cap [kWh] for fans + pumps'),
    priorityArea:z.string().optional().describe('area ID to prioritise for improvement (default stalls. stall-A..D/feeding/waiting/stalls/all)'),
    protectAreas:z.array(z.string()).optional().describe('areas that must not increase daily mean deficit vs the start (default: all 3 areas)'),
    protectWorst:z.boolean().optional().describe('do not increase the all-points max deficit vs the start (default true)'),
   }).optional(),
   ranking:z.enum(['deficit','water','worst']).optional().describe('ranking rule: deficit = priority-area deficit, then max deficit, water, power / water = water-saving first (limited to candidates that improve the priority area) / worst = max-deficit first'),
  }),
 },args=>relay('compare_candidates',args,300000));

 server.registerTool('describe_model',{
  description:'Returns what this app\'s model computes, what it assumes and what it ignores: the computation structure (roof/wind/spray/mist/cow balance/daily aggregate), input/output field meanings, key assumed constants, limits and validation status. Call before interpreting or explaining numbers from get_results/evaluate.',
 },()=>relay('describe_model'));

 server.registerTool('get_results',{
  description:'Calculation results for the current input. By default returns per-area aggregates, resources, roof means and dailyMilk for all scenarios plus the selected point\'s detail. status: ready = daily milk done / thermal_ready = thermal only, dailyMilk pending / calculating / editing / error. No time series. Leave at least 1 s between calls.',
  inputSchema:z.strictObject({
   scenarioId:z.string().optional().describe('when set, only that scenario'),
   probeId:z.string().optional().describe('when set, this point is the detail target (default: selected point)'),
  }),
 },args=>relay('get_results',args));

 server.registerTool('undo',{
  description:'Undoes the last edit once (same history as the view\'s Undo; scenario selection and view are kept). changed:false when there is no history. View operations cannot be undone.',
 },()=>relay('undo'));

 return server;
}

// ---- boot ----------------------------------------------------------------------
httpServer.on('error',e=>{
 log(`HTTP/WS listener failed: ${e.message}`);
 log(`port ${PORT} is already in use - another mcp-server process may still be running; stop it manually`);
 process.exit(1);
});
httpServer.listen(PORT,HOST,()=>{
 log(`serving ${root} on http://${HOST}:${PORT}/`);
 log(`open ${PAGE_URL} in one browser tab, then call get_state`);
});
const handle=serveStdio(createServer);
let shuttingDown=false;
const shutdown=()=>{
 if(shuttingDown)return;
 shuttingDown=true;
 setTimeout(()=>process.exit(0),1500).unref();
 handle.close().finally(()=>{
  try{browser?.terminate()}catch{}
  wss.close();
  httpServer.close(()=>process.exit(0));
 });
};
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
// The stdio client (AI host) is gone — exit instead of lingering with the HTTP listener.
process.stdin.on('end',shutdown);
process.stdin.on('close',shutdown);
