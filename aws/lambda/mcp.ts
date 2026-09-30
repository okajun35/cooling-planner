/** Remote MCP endpoint on a Lambda Function URL (streamable HTTP, stateless).
 * Unlike scripts/mcp-server.mjs (which bridges to an open browser tab), this
 * server owns no UI session: tools take a project JSON, run the same domain
 * code, and return results. Auth is a shared Bearer token (Function URL is
 * authType NONE). */
import {McpServer,createMcpHandler} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {defaultProject,describe,evaluateProject,compareProject} from './core.js';
import {DOCS} from './docs.js';
import {APP_VERSION} from '../../src/data/defaults.js';

// Accepted Bearer tokens: private (MCP_BEARER_TOKEN) and the published demo
// token (MCP_DEMO_TOKEN, shown in llms.txt/README/registry so anyone can try).
const TOKENS=new Set([process.env.MCP_BEARER_TOKEN,process.env.MCP_DEMO_TOKEN].filter(Boolean) as string[]);

const asText=(data:unknown,isError=false)=>({content:[{type:'text' as const,text:typeof data==='string'?data:JSON.stringify(data)}],...(isError?{isError:true}:{})});
const call=async(fn:()=>unknown|Promise<unknown>)=>{try{return asText(await fn())}catch(e){return asText(e instanceof Error?e.message:String(e),true)}};

// Same operation vocabulary as scripts/mcp-server.mjs editSchema.
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
const DAILY_WEATHER_PATCH=z.strictObject({mode:z.enum(['constant','hourly']),hours:z.array(WEATHER_HOUR).optional()}).describe('Representative-day weather. With mode:"hourly", supply 24 rows in hours with hour=0-23 ascending (hourly affects only the daily simulation; the 60-min evaluation uses the fixed environment). hours may be omitted when reverting to constant');
const OPERATION=z.discriminatedUnion('operation',[
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

function buildServer(){
 const server=new McpServer({name:'cooling-planner-remote',version:APP_VERSION},{instructions:[
  'A calculation service that compares environment, water/power resources, representative-cow heat loss and daily milk (hypothesis) across equipment placements and roof conditions in a model barn. Stateless version with no browser view.',
  'Basic flow: get_default_project returns the default project (JSON) and ID list -> edit the project\'s devices/weather/coefficients or specify operations -> evaluate computes it. Feeding the returned project into the next evaluate enables sequential editing.',
  'The operations vocabulary matches the local version. Coordinates: x along the barn length, y the width, heightM the height. Lengths in m, angles in deg. The baseline is read-only; update_environment affects all scenarios.',
  'Representative-day hourly weather is set via update_daily_weather (mode:"hourly" takes 24 unique rows with hour=0-23 ascending). The 60-min evaluation always uses the fixed environment; hourly affects only daily results (dailyThermal/dailyMilk).',
  'Explain numbers using evaluate results. Never describe "not calculated", null or invalid as zero. meanQrefW is a point\'s net heat loss; deltaQrefW is the heat-loss difference from baseline; meanDeficitW is the 60-min mean of per-second deficits.',
  'Before interpreting results, call describe_model to check the model\'s structure, assumptions and limits. Never present reduced-order values as guaranteed real-farm values.',
  'get_doc returns the Markdown source of the documents backing the model theory and coefficients (heat-balance spec / milk hypothesis / design decision logs). The name corresponds to the docs list in describe_model.',
  'Daily milk is a reference value of the hypothesis model (milk-heat-deficit-v0.1). Computed with includeDaily:true, but takes tens of seconds.',
 ].join('\n')});
 server.registerTool('get_default_project',{
  description:'Returns the default Project JSON and the scenario/device/point/area ID list used by operations. The starting point for building inputs. The returned project can be passed straight to evaluate.',
 },()=>call(()=>defaultProject()));
 server.registerTool('evaluate',{
  description:'Applies the operation list to a clone of project, computes it, and returns per-area aggregates, resources, roof, (with includeDaily) dailyMilk and dailyThermal (evaluation-day 24h per-point/area mean deficit) and the baseline. Without project, the default is used; without operations, it is computed as-is. Feeding the returned project back enables sequential editing.',
  inputSchema:z.strictObject({
   project:z.unknown().optional().describe('target Project JSON (the get_default_project return value or a previous evaluate result). Default: the default project'),
   scenarioId:z.string().optional().describe('scenario ID to apply operations to. Default: the project\'s current scenario. The baseline is read-only'),
   operations:z.array(OPERATION).optional().describe('operation list applied in order to the clone. An empty array computes it as-is'),
   includeDaily:z.boolean().optional().describe('true also computes the daily-milk hypothesis model (takes tens of seconds. Default: 60-min thermal only)'),
  }),
 },args=>call(()=>evaluateProject(args)));
 server.registerTool('compare_candidates',{
  description:'Constrained candidate comparison. Applies 1-3 candidate operation lists separately to the same starting project and returns daily results (daily mean deficit, cooling water, power, worsened point count, milk), constraint verdicts and ranks. Candidate operations are only update_device (enabled/position/direction/daily schedule), update_system (onoff/daily schedule) and update_roof. Coefficients, weather, scenario switching and device add/remove are not allowed as candidates. Ranks hold only within the call. Takes tens of seconds to minutes as each candidate includes the daily computation.',
  inputSchema:z.strictObject({
   project:z.unknown().optional().describe('starting Project JSON. Default: the default project'),
   scenarioId:z.string().optional().describe('editable scenario ID to apply candidates to. Default: the project\'s current scenario. Baseline is not allowed'),
   candidates:z.array(z.strictObject({id:z.string().describe('candidate ID (unique within the call)'),operations:z.array(OPERATION)})).min(1).max(3).describe('candidates to compare. Each applies to a fresh clone of the start project (not cumulative)'),
   constraints:z.strictObject({
    maxWaterLPerDay:z.number().optional().describe('daily supply-water cap [L] for cooling devices (soaker, mist, roof sprinkling)'),
    maxElectricityKwhPerDay:z.number().optional().describe('daily electricity cap [kWh] for fans + pumps'),
    priorityArea:z.string().optional().describe('area ID to prioritise for improvement (default stalls. stall-A..D/feeding/waiting/stalls/all)'),
    protectAreas:z.array(z.string()).optional().describe('areas that must not increase daily mean deficit vs the start (default: all 3 areas)'),
    protectWorst:z.boolean().optional().describe('do not increase the all-points max deficit vs the start (default true)'),
   }).optional(),
   ranking:z.enum(['deficit','water','worst']).optional().describe('ranking rule: deficit = priority-area deficit, then max deficit, water, power / water = water-saving first (limited to candidates that improve the priority area) / worst = max-deficit first'),
  }),
 },args=>call(()=>compareProject(args)));

 server.registerTool('describe_model',{
  description:'Returns what this model computes, what it assumes and what it ignores: the computation structure (roof/wind/spray/mist/cow balance/daily aggregate), input/output meanings, key assumed constants, limits and validation status. Call before interpreting results. get_doc fetches the documents in the docs list.',
  inputSchema:z.strictObject({project:z.unknown().optional().describe('project to describe. Default: described with the default project\'s model settings')}),
 },args=>call(()=>describe(args.project)));
 server.registerTool('get_doc',{
  description:'Returns the Markdown source of documents backing the model theory and coefficients. Corresponds to the docs list in describe_model: thermal_model = heat/spray model spec (MODEL.md), milk_model = daily-milk hypothesis model (MILK_HEAT_MODEL_V0_1.md), decisions_v08/decisions_v06 = design decision logs. Use to explain "why this formula or coefficient".',
  inputSchema:z.strictObject({name:z.enum(['thermal_model','milk_model','decisions_v08','decisions_v06']).describe('document name to fetch')}),
 },({name})=>call(()=>DOCS[name]));
 return server;
}

const mcp=createMcpHandler(buildServer,{responseMode:'json'});

interface FunctionUrlEvent{
 rawPath:string;rawQueryString?:string;body?:string;isBase64Encoded?:boolean;
 headers?:Record<string,string>;
 requestContext:{http:{method:string};domainName:string};
}

export async function lambdaHandler(event:FunctionUrlEvent){
 const auth=event.headers?.authorization??event.headers?.Authorization??'';
 if(TOKENS.size&&!TOKENS.has(auth.startsWith('Bearer ')?auth.slice(7):'')){
  return{statusCode:401,headers:{'content-type':'application/json','www-authenticate':'Bearer realm="cooling-planner-mcp"'},body:JSON.stringify({error:'unauthorized'})};
 }
 const headers=new Headers(event.headers??{});
 const url=`https://${event.requestContext.domainName}${event.rawPath}${event.rawQueryString?`?${event.rawQueryString}`:''}`;
 const method=event.requestContext.http.method;
 // Evidence log: which MCP method/tool a remote agent invoked (CloudWatch).
 try{const p=event.body?JSON.parse(event.isBase64Encoded?Buffer.from(event.body,'base64').toString():event.body):null;
  console.log(JSON.stringify({rpc:p?.method,tool:p?.params?.name}))}catch{}
 const req=new Request(url,{method,headers,body:method==='GET'||method==='HEAD'?undefined:event.body?Buffer.from(event.body,event.isBase64Encoded?'base64':'utf8'):undefined});
 const res=await mcp.fetch(req);
 return{statusCode:res.status,headers:Object.fromEntries(res.headers.entries()),body:Buffer.from(await res.arrayBuffer()).toString('base64'),isBase64Encoded:true};
}
