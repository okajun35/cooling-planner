/** Remote MCP endpoint on a Lambda Function URL (streamable HTTP, stateless).
 * Unlike scripts/mcp-server.mjs (which bridges to an open browser tab), this
 * server owns no UI session: tools take a project JSON, run the same domain
 * code, and return results. Auth is a shared Bearer token (Function URL is
 * authType NONE). */
import {McpServer,createMcpHandler} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {defaultProject,describe,evaluateProject} from './core.js';
import {DOCS} from './docs.js';
import {APP_VERSION} from '../../src/data/defaults.js';

const TOKEN=process.env.MCP_BEARER_TOKEN??'';

const asText=(data:unknown,isError=false)=>({content:[{type:'text' as const,text:typeof data==='string'?data:JSON.stringify(data)}],...(isError?{isError:true}:{})});
const call=async(fn:()=>unknown|Promise<unknown>)=>{try{return asText(await fn())}catch(e){return asText(e instanceof Error?e.message:String(e),true)}};

// Same operation vocabulary as scripts/mcp-server.mjs editSchema.
const DEVICE_PATCH=z.strictObject({
 x:z.number().optional().describe('牛舎の長さ方向 [m]'),
 y:z.number().optional().describe('牛舎の幅方向 [m]'),
 heightM:z.number().optional().describe('高さ [m]'),
 yawDeg:z.number().optional(),pitchDownDeg:z.number().optional(),enabled:z.boolean().optional(),
 diameterM:z.number().optional(),outletSpeedMps:z.number().optional(),powerKw:z.number().optional(),
 hoursPerDay:z.number().optional(),dailyStartHour:z.number().optional(),
 flowLpm:z.number().optional(),halfAngleDeg:z.number().optional(),
}).describe('設備の変更フィールド。ファンはdiameterM/outletSpeedMps/powerKw/hoursPerDay/dailyStartHour、ノズルはflowLpm/halfAngleDegのみ可。id/kind/anchorは変更不可。');
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
 surfaceTemperatureC:z.number().optional().describe('牛体表温度℃'),
 areaM2:z.number().optional(),wetAreaM2:z.number().optional(),patchLengthM:z.number().optional(),patchWidthM:z.number().optional(),
 baseWetFraction:z.number().optional(),emissivity:z.number().optional(),radiantOffsetC:z.number().optional(),
 kSpread:z.number().optional().describe('ファン噴流の拡散係数'),kDecay:z.number().optional().describe('ファン噴流の減衰係数'),
 latentHeatJkg:z.number().optional(),airDensityKgM3:z.number().optional(),airCpJkgK:z.number().optional(),vaporGasConstant:z.number().optional(),
 hcIntercept:z.number().optional().describe('対流熱伝達率の切片 hc=a+b√v'),hcSlope:z.number().optional().describe('対流熱伝達率の傾き'),
 roof:z.strictObject({
  backgroundSensibleW:z.number().optional(),bareResistance:z.number().optional(),conductivity:z.number().optional(),
  hOutConv:z.number().optional(),hOutRad:z.number().optional(),hInConv:z.number().optional(),hInRad:z.number().optional(),
  viewFactor:z.number().optional(),waterCapacityKgM2:z.number().optional(),
 }).optional().describe('屋根モデル係数'),
 profiles:z.record(z.string(),z.strictObject({
  outletMultiplier:z.number().optional(),hcMultiplier:z.number().optional(),mistEfficiency:z.number().optional(),maxFilmKg:z.number().optional(),
 })).optional().describe('プロファイルID(low/reference/high)→係数。感度仮定セットの調整'),
}).describe('物理モデルの係数。仮定の感度試行に使う。モデル式そのものは変えられない');
const MILK_PATCH=z.strictObject({
 potentialMilkKgPerCowDay:z.number().optional(),referenceCoolingWPerCow:z.number().optional().describe('放熱不足の基準放熱量Qref W'),
 responseKgPerCowDayPerW:z.number().optional().describe('不足1W当たりの乳量応答係数beta'),maxLossFraction:z.number().optional(),
 lagWeights:z.tuple([z.number(),z.number(),z.number()]).optional(),
 occupancyFractions:z.strictObject({stall:z.number(),feeding:z.number(),waiting:z.number()}).optional(),
 responseSensitivityKgPerCowDayPerW:z.tuple([z.number(),z.number(),z.number()]).optional(),
 warmupDurationSec:z.number().optional(),evaluationDurationSec:z.number().optional(),timeStepSec:z.number().optional(),
}).describe('乳量仮説モデル(milk-heat-deficit-v0.1)の係数');
const REFERENCES_PATCH=z.strictObject({
 baselineMilkKgPerDay:z.number().nullable().optional(),
 fertility:z.strictObject({
  p0:z.number().optional(),mode:z.enum(['manual','simulation']).optional(),exposureAssumed:z.boolean().optional(),
  temperatureC:z.number().optional(),relativeHumidityPct:z.number().optional(),
 }).optional(),
});
const OPERATION=z.discriminatedUnion('operation',[
 z.strictObject({operation:z.literal('switch_scenario'),scenarioId:z.string().describe('切替先の案ID。基準案も閲覧用に選択可')}),
 z.strictObject({operation:z.literal('copy_to_other')}).describe('現在の編集案をもう一方の編集案へ上書きコピーし、その案へ切り替える。対象は設備と屋根。共通気象は全案共有で以前の値は残らない'),
 z.strictObject({operation:z.literal('update_device'),deviceId:z.string(),patch:DEVICE_PATCH}),
 z.strictObject({operation:z.literal('update_roof'),patch:ROOF_PATCH}),
 z.strictObject({operation:z.literal('update_system'),systemId:z.string(),patch:SYSTEM_PATCH}),
 z.strictObject({operation:z.literal('update_environment'),patch:ENV_PATCH}),
 z.strictObject({operation:z.literal('update_model'),patch:MODEL_PATCH}).describe('物理モデル係数の変更。共通気象と同様に全案へ効く'),
 z.strictObject({operation:z.literal('update_milk'),patch:MILK_PATCH}).describe('乳量仮説モデルの係数変更'),
 z.strictObject({operation:z.literal('update_references'),patch:REFERENCES_PATCH}).describe('参照設定(基準乳量・受胎参照)の変更'),
 z.strictObject({operation:z.literal('add_device'),kind:z.enum(['fan','soaker','mist']),x:z.number().optional().describe('長さ方向の設置位置[m]'),y:z.number().optional().describe('幅方向の設置位置[m]。xとyは両方指定')}),
 z.strictObject({operation:z.literal('duplicate_device'),deviceId:z.string()}),
 z.strictObject({operation:z.literal('remove_device'),deviceId:z.string()}),
]);

function buildServer(){
 const server=new McpServer({name:'cooling-planner-remote',version:APP_VERSION},{instructions:[
  'モデル牛舎の設備配置・屋根条件を変えて環境・水資源・代表牛の放熱・日乳量(仮説)を比較する計算サービス。ブラウザ画面は持たないステートレス版。',
  '基本フロー: get_default_project で既定project(JSON)とID一覧を取得 → projectの設備/気象/係数を編集するかoperationsで操作を指定 → evaluate で計算。返ってきたprojectを次のevaluateの入力にすると逐次編集できる。',
  'operationsの語彙はローカル版と同一。座標はx=牛舎長さ方向、y=幅方向、heightM=高さ。長さm、向きdeg。基準案は読取専用、update_environmentは全案に効く。',
  '数値説明はevaluateの結果を使う。未計算・null・invalidをゼロと説明しない。meanQrefWは地点の正味放熱量、deltaQrefWは基準案からの放熱差、meanDeficitWは秒積算した不足の60分平均。',
  '結果を解釈・説明する前にdescribe_modelでモデルの計算構造・仮定・限界を確認する。縮約モデルの数値を実牛舎の保証値と言わない。',
  'モデル理論・係数の根拠となる文書(熱収支仕様/乳量仮説/設計決定ログ)のMarkdown本文はget_docで取得する。describe_modelのdocs一覧とnameが対応する。',
  '日乳量は仮説モデル(milk-heat-deficit-v0.1)の参考値。includeDaily:trueで計算するが数十秒かかる。',
 ].join('\n')});
 server.registerTool('get_default_project',{
  description:'既定のProject JSONと、operationsで使う案ID・設備ID・地点・区画の一覧を返す。入力を組み立てる起点。返るprojectはそのままevaluateのproject引数に使える。',
 },()=>call(()=>defaultProject()));
 server.registerTool('evaluate',{
  description:'projectへ操作列operationsを複製へ適用して計算し、区画別集計・resources・roof・(includeDaily時)dailyMilkと基準案を返す。project省略時は既定project。operations省略時はそのままの計算。返値のprojectを次回入力に使うと逐次編集できる。',
  inputSchema:z.strictObject({
   project:z.unknown().optional().describe('対象Project JSON(get_default_projectの返値または前回evaluateの返値)。省略時は既定'),
   scenarioId:z.string().optional().describe('操作を適用する案ID。省略時はprojectの現在の案。基準案は読取専用'),
   operations:z.array(OPERATION).optional().describe('複製へ順に適用する操作列。空配列はそのまま計算'),
   includeDaily:z.boolean().optional().describe('trueで日乳量の仮説モデルまで計算(数十秒かかる。省略時は60分熱計算のみ)'),
  }),
 },args=>call(()=>evaluateProject(args)));
 server.registerTool('describe_model',{
  description:'この計算モデルが「何を・どう仮定して・何を無視して」計算しているかを返す。計算構造(屋根/風/散水/ミスト/牛体収支/日集計)、入出力の意味、主な仮定定数、限界、検証状態を含む。結果を解釈・説明する前に呼ぶ。docs一覧の文書本文はget_docで取得。',
  inputSchema:z.strictObject({project:z.unknown().optional().describe('説明対象のproject。省略時は既定projectのモデル設定で説明')}),
 },args=>call(()=>describe(args.project)));
 server.registerTool('get_doc',{
  description:'モデル理論・係数の根拠となる文書のMarkdown本文を返す。describe_modelのdocs一覧に対応: thermal_model=熱・散水モデル仕様(MODEL.md)、milk_model=日乳量仮説モデル(MILK_HEAT_MODEL_V0_1.md)、decisions_v08/decisions_v06=設計決定ログ。「なぜこの式・係数か」を説明するときに使う。',
  inputSchema:z.strictObject({name:z.enum(['thermal_model','milk_model','decisions_v08','decisions_v06']).describe('取得する文書名')}),
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
 if(TOKEN&&auth!==`Bearer ${TOKEN}`){
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
