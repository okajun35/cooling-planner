import type {CommandMap} from './commands.js';

/** Small JSON Schema subset used by our tools, also checked before calling the live store. */
interface Schema {
 type?:string|string[];properties?:Record<string,Schema>;required?:string[];
 additionalProperties?:boolean|Schema;enum?:unknown[];oneOf?:Schema[];items?:Schema;
 minItems?:number;maxItems?:number;minimum?:number;maximum?:number;description?:string;
}
const number:Schema={type:'number'},string:Schema={type:'string'},boolean:Schema={type:'boolean'};
const choices=(...values:string[]):Schema=>({type:'string',enum:values});
const nullable=(schema:Schema):Schema=>({...schema,type:[schema.type as string,'null'],...(schema.enum?{enum:[...schema.enum,null]}:{})});
const object=(properties:Record<string,Schema>={},required:string[]=[]):Schema=>({type:'object',properties,required,additionalProperties:false});
const numbers=(names:string):Record<string,Schema>=>Object.fromEntries(names.split(' ').map(name=>[name,number]));
const patch=(properties:Record<string,Schema>)=>object(properties);
const operation=(name:string,properties:Record<string,Schema>={},required:string[]=[]):Schema=>object({operation:choices(name),...properties},['operation',...required]);
const schedule=numbers('onSec offSec hoursPerDay dailyStartHour pumpPowerKw');
const devicePatch=patch({...numbers('x y heightM yawDeg pitchDownDeg diameterM outletSpeedMps powerKw hoursPerDay dailyStartHour flowLpm halfAngleDeg'),enabled:boolean});
const roofPatch=patch({...numbers('reflectance insulationM flowLpmM2'),...schedule,sprayEnabled:boolean});
const triplet:Schema={type:'array',items:number,minItems:3,maxItems:3};
const editSchema:Schema={type:'object',oneOf:[
 operation('switch_scenario',{scenarioId:string},['scenarioId']),
 operation('copy_to_other'),
 operation('update_device',{deviceId:string,patch:devicePatch},['deviceId','patch']),
 operation('update_roof',{patch:roofPatch},['patch']),
 operation('update_system',{systemId:string,patch:patch({...schedule,enabled:boolean})},['systemId','patch']),
 operation('update_environment',{patch:patch(numbers('temperatureC relativeHumidityPct pressurePa backgroundSpeedMps ventilationM3sPerM2 solarRoofWm2'))},['patch']),
 operation('update_daily_weather',{patch:object({mode:choices('constant','hourly'),hours:{type:'array',items:object({hour:{type:'integer',minimum:0,maximum:23},temperatureC:{type:'number',minimum:20,maximum:40},relativeHumidityPct:{type:'number',minimum:0,maximum:100},solarRoofWm2:{type:'number',minimum:0,maximum:1200}},['hour','temperatureC','relativeHumidityPct','solarRoofWm2'])}},['mode'])},['patch']),
 operation('update_model',{patch:patch({
  ...numbers('surfaceTemperatureC areaM2 wetAreaM2 patchLengthM patchWidthM baseWetFraction emissivity radiantOffsetC kSpread kDecay latentHeatJkg airDensityKgM3 airCpJkgK vaporGasConstant hcIntercept hcSlope'),
  roof:patch(numbers('backgroundSensibleW bareResistance conductivity hOutConv hOutRad hInConv hInRad viewFactor waterCapacityKgM2')),
  profiles:{type:'object',additionalProperties:patch(numbers('outletMultiplier hcMultiplier mistEfficiency maxFilmKg'))},
 })},['patch']),
 operation('update_milk',{patch:patch({
  ...numbers('potentialMilkKgPerCowDay referenceCoolingWPerCow responseKgPerCowDayPerW maxLossFraction warmupDurationSec evaluationDurationSec timeStepSec'),
  lagWeights:triplet,responseSensitivityKgPerCowDayPerW:triplet,
  occupancyFractions:object(numbers('stall feeding waiting'),['stall','feeding','waiting']),
 })},['patch']),
 operation('update_references',{patch:patch({baselineMilkKgPerDay:nullable(number),fertility:patch({...numbers('p0 temperatureC relativeHumidityPct'),mode:choices('manual','simulation'),exposureAssumed:boolean})})},['patch']),
 operation('add_device',{kind:choices('fan','soaker','mist'),x:number,y:number},['kind']),
 operation('duplicate_device',{deviceId:string},['deviceId']),
 operation('remove_device',{deviceId:string},['deviceId']),
]};
const operations:Schema={type:'array',items:editSchema};
interface Definition{name:keyof CommandMap;description:string;inputSchema:Schema;readOnly:boolean}
export const WEBMCP_TOOLS:readonly Definition[]=[
 {name:'get_state',description:'Read the committed Cooling Planner screen state, scenario/device/point/area IDs, selection, calculation status and model notes. Call first. The baseline is read-only.',inputSchema:object(),readOnly:true},
 {name:'edit',description:'Apply one operation to the current screen scenario or shared settings, with automatic recalculation. Use IDs from get_state. copy_to_other overwrites the other editable scenario. Success does not mean calculation is finished.',inputSchema:editSchema,readOnly:false},
 {name:'set_view',description:'Change the displayed mode, metric, selection or overlays, or open a results sheet (compare/areas/timeline/reference; null closes it). View changes do not change physics and are not undoable.',inputSchema:object({mode:choices('3d','2d'),metric:choices('delta','deficit','speed','temperature'),selectedProbeId:string,selectedDeviceId:nullable(string),selectedAreaId:nullable(string),analysis:boolean,realistic:boolean,heatmap:boolean,roof:boolean,flow:boolean,particles:boolean,timeSec:{type:'number',minimum:0,maximum:3600},sheet:nullable(choices('compare','areas','timeline','reference'))}),readOnly:false},
 {name:'get_results',description:'Read current calculation results and per-area comparisons. ready means daily results are complete; thermal_ready means daily results are pending. Other statuses have no result. Never treat null as zero. Leave at least 1 second between calls.',inputSchema:object({scenarioId:string,probeId:string}),readOnly:true},
 {name:'undo',description:'Undo the last screen edit using the same history as the Undo button. View changes cannot be undone.',inputSchema:object(),readOnly:false},
 {name:'describe_model',description:'Read the model structure, assumptions and limits. Call before interpreting results. Daily milk is a hypothesis reference, not a guaranteed real-farm effect.',inputSchema:object(),readOnly:true},
 {name:'evaluate',description:'Evaluate hypothetical operations on a clone without changing the screen or Undo history. Use for what-if questions. includeDaily also computes daily hypothesis results and may take tens of seconds.',inputSchema:object({operations,scenarioId:string,includeDaily:boolean},['operations']),readOnly:true},
 {name:'compare_candidates',description:'Evaluate 1–3 independent candidates on clones, compare daily deficits and resource constraints, and rank them. Candidate operations are equipment/roof operation tweaks only; no weather or performance coefficient changes. The screen is unchanged.',inputSchema:object({scenarioId:string,candidates:{type:'array',minItems:1,maxItems:3,items:object({id:string,operations},['id','operations'])},constraints:object({...numbers('maxWaterLPerDay maxElectricityKwhPerDay'),priorityArea:string,protectAreas:{type:'array',items:string},protectWorst:boolean}),ranking:choices('deficit','water','worst')},['candidates']),readOnly:true},
];

function validate(schema:Schema,value:unknown,path='arguments'):void {
 if(schema.oneOf){
  // Select the operation first to retain a useful error for malformed arguments.
  const name=value&&typeof value==='object'?(value as Record<string,unknown>).operation:undefined;
  const selected=schema.oneOf.find(s=>s.properties?.operation.enum?.includes(name));
  if(!selected)throw Error(`${path}.operation is unknown or missing`);
  validate(selected,value,path);return;
 }
 const types=Array.isArray(schema.type)?schema.type:[schema.type];
 const type=value===null?'null':Array.isArray(value)?'array':typeof value;
 if(!types.includes(type)&&!(types.includes('integer')&&typeof value==='number'&&Number.isInteger(value)))throw Error(`${path} must be ${types.join(' or ')}`);
 if(schema.enum&&!schema.enum.includes(value))throw Error(`${path} has an unsupported value`);
 if(typeof value==='number'){
  if(!Number.isFinite(value))throw Error(`${path} must be finite`);
  if(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum)throw Error(`${path} is outside the allowed range`);
 }
 if(type==='object'){
  const record=value as Record<string,unknown>;
  for(const key of schema.required??[])if(!Object.hasOwn(record,key))throw Error(`${path}.${key} is required`);
  for(const[key,v]of Object.entries(record)){
   const child=schema.properties&&Object.hasOwn(schema.properties,key)?schema.properties[key]:undefined;
   if(child)validate(child,v,`${path}.${key}`);
   else if(schema.additionalProperties===false)throw Error(`${path}.${key} is not allowed`);
   else if(typeof schema.additionalProperties==='object')validate(schema.additionalProperties,v,`${path}.${key}`);
  }
 }
 if(Array.isArray(value)){
  if(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems)throw Error(`${path} has an invalid length`);
  if(schema.items)value.forEach((v,i)=>validate(schema.items!,v,`${path}[${i}]`));
 }
}

export interface WebMcpTool {
 name:string;description:string;inputSchema:Schema;
 annotations:{readOnlyHint:boolean;consequentialHint:boolean};
 execute:(args:unknown)=>Promise<string>;
}
export interface ModelContext {
 registerTool:(tool:WebMcpTool)=>void|Promise<unknown>;
 unregisterTool?:(name:string)=>void|Promise<unknown>;
}
/** Prefer the current document API; support older navigator implementations too. */
export function findModelContext(doc:unknown,nav:unknown):ModelContext|undefined {
 for(const host of[doc,nav]){
  const context=(host as {modelContext?:ModelContext}|null)?.modelContext;
  if(typeof context?.registerTool==='function')return context;
 }
}
/** Like the Star Lab demo, ordinary URLs expose tools; an explicit 0 opts out. */
export function isWebMcpEnabled(search:string):boolean {
 return new URLSearchParams(search).get('webmcp')!=='0';
}
export type WebMcpStatus='ready'|'unavailable'|'error';
export async function startWebMcp(opts:{context?:ModelContext;commands:CommandMap;notify:(status:WebMcpStatus,message:string)=>void}):Promise<void>{
 if(!opts.context){opts.notify('unavailable','WebMCP unavailable — enable WebMCP in a supported Chrome browser');return}
 const context=opts.context,registered:string[]=[];
 try{
  for(const definition of WEBMCP_TOOLS){
   const{name,description,inputSchema,readOnly}=definition;
   await context.registerTool({name,description,inputSchema,annotations:{readOnlyHint:readOnly,consequentialHint:false},execute:async(args)=>{
    const input=args===undefined?{}:args;validate(inputSchema,input);
    const command=opts.commands[name] as (args:never)=>unknown;
    return JSON.stringify(await command(input as never));
   }});
   registered.push(name);
  }
  opts.notify('ready','WebMCP ready');
 }catch(e){
  for(const name of registered){try{await context.unregisterTool?.(name)}catch{/* Report the original registration error. */}}
  opts.notify('error',`WebMCP registration failed: ${e instanceof Error?e.message:String(e)}`);
 }
}
