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
   ws.close(4409,'別のタブが接続中です。開いている1タブだけを使用してください。');
   return;
  }
  browser=ws;
  log('browser connected');
  ws.on('message',data=>{
   let msg;try{msg=JSON.parse(data.toString())}catch{return}
   const p=pending.get(msg?.id);
   if(!p)return; // late or unknown reply
   pending.delete(msg.id);clearTimeout(p.timer);
   if(msg.ok)p.resolve(msg.data);else p.reject(new Error(msg.error??'ブラウザ側でエラーが発生しました'));
  });
  ws.on('close',()=>{
   if(browser!==ws)return;browser=null;log('browser disconnected');
   for(const[id,e]of pending){pending.delete(id);clearTimeout(e.timer);e.reject(new Error('ブラウザとの接続が切れました。画面を再読込してから get_state で状態を確認してください'))}
  });
 });
});

function callBrowser(command,args,timeoutMs=10000){
 return new Promise((resolve,reject)=>{
  if(!browser||browser.readyState!==browser.OPEN){
   reject(new Error(`ブラウザが接続されていません。${PAGE_URL} を1タブで開いてください`));return;
  }
  if(pending.size){reject(new Error('他の操作を実行中です。少し待って再試行してください'));return}
  const id=nextId++;
  const timer=setTimeout(()=>{
   pending.delete(id);
   reject(new Error(`ブラウザから応答がありません（${Math.round(timeoutMs/1000)}秒）。変更の成否が不明です。get_stateで画面の状態を確認してください`));
  },timeoutMs);
  pending.set(id,{resolve,reject,timer});
  browser.send(JSON.stringify({id,command,args}));
 });
}

// ---- MCP tools ----------------------------------------------------------------
const asText=(data,isError=false)=>({content:[{type:'text',text:typeof data==='string'?data:JSON.stringify(data)}],...(isError?{isError:true}:{})});
const relay=async(command,args,timeoutMs)=>{try{return asText(await callBrowser(command,args,timeoutMs))}catch(e){return asText(e instanceof Error?e.message:String(e),true)}};

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
const WEATHER_HOUR=z.strictObject({hour:z.number().int().min(0).max(23),temperatureC:z.number().min(20).max(40),relativeHumidityPct:z.number().min(0).max(100),solarRoofWm2:z.number().min(0).max(1200)});
const DAILY_WEATHER_PATCH=z.strictObject({mode:z.enum(['constant','hourly']),hours:z.array(WEATHER_HOUR).optional()}).describe('代表日気象。mode:"hourly"のときhoursにhour=0〜23の24行を昇順で指定（hourlyは日シミュレーションのみ効く）。constantに戻すときhoursは省略可');

function createServer(){
 const server=new McpServer({name:'cooling-planner',version:'0.10.0-preview.1',instructions:[
  'ブラウザで開いているCooling Plannerの画面そのものを操作するツール群。状態の正本はブラウザ。',
  `先に get_state で現状・ID・選択対象を確認する。ブラウザ未接続なら ${PAGE_URL} を1タブで開いてもらう。`,
  '「この牛」は選択地点として解釈する。座標はx=牛舎長さ方向、y=幅方向、heightM=高さ。長さm、向きdeg。',
  '編集は現在の案へ適用する。基準案は読取専用。update_environmentは全案に効く。',
 'モデル係数はupdate_model(物理)/update_milk(乳量仮説)/update_references(参照設定)で変更する。仮定の感度試行はevaluateと組み合わせる。モデル式・バージョン識別子は変更できない。',
  '変更前を残す依頼は copy_to_other（現在の編集案をもう一方の編集案へ上書きコピーし、その案へ切替）を使う。',
  '数値説明は get_results の計算結果を使う。未計算・null・invalidをゼロと説明しない。',
  'meanQrefWは地点の正味放熱量、deltaQrefWは基準案からの放熱差、meanDeficitWは秒積算した不足の60分平均。',
  'resourcesはL/day・kWh/day、trialWaterL/trialKwhは60分試行分。日乳量の資源量はdailyMilk.resources。',
  '日乳量は仮説モデル(milk-heat-deficit-v0.1)の参考値で、実牛舎での効果保証ではない。',
  '「なぜ」の説明は風速・放射・放熱内訳・設備作用を根拠にする。断定が難しいときは仮説と伝え1条件だけ変えて比較する。',
 '仮説の比較（「こう変えたらどうなるか」「どの対策が効くか」）はedit→get_results→undoではなくevaluateを使う。画面の状態を変えず、案ごとにoperationsを渡して結果を並べる。',
 '結果を解釈・説明する前にdescribe_modelでモデルの計算構造・仮定・限界を確認する。縮約モデルの数値を実牛舎の保証値と言わない。',
 ].join('\n')});

 server.registerTool('get_state',{
  description:'現在の画面の確定済み状態を返す。各案のroof/fans/waterSystems、共通environment、view、地点・区画のID一覧、選択対象、undoCount、計算状態、modelNotesを含む。計算結果の数値はget_resultsで取る。',
 },()=>relay('get_state'));

 const editSchema=z.discriminatedUnion('operation',[
  z.strictObject({operation:z.literal('switch_scenario'),scenarioId:z.string().describe('切替先の案ID。基準案も閲覧用に選択可')}),
  z.strictObject({operation:z.literal('copy_to_other')}).describe('現在の編集案をもう一方の編集案へ上書きコピーし、その案へ切り替える。対象は設備と屋根。共通気象は全案共有で以前の値は残らない'),
  z.strictObject({operation:z.literal('update_device'),deviceId:z.string(),patch:DEVICE_PATCH}),
  z.strictObject({operation:z.literal('update_roof'),patch:ROOF_PATCH}),
  z.strictObject({operation:z.literal('update_system'),systemId:z.string(),patch:SYSTEM_PATCH}),
  z.strictObject({operation:z.literal('update_environment'),patch:ENV_PATCH}),
  z.strictObject({operation:z.literal('update_daily_weather'),patch:DAILY_WEATHER_PATCH}).describe('代表日の時刻別気象の設定・解除。全案共有'),
 z.strictObject({operation:z.literal('update_model'),patch:MODEL_PATCH}).describe('物理モデル係数の変更。共通気象と同様に全案へ効く'),
 z.strictObject({operation:z.literal('update_milk'),patch:MILK_PATCH}).describe('乳量仮説モデルの係数変更'),
 z.strictObject({operation:z.literal('update_references'),patch:REFERENCES_PATCH}).describe('参照設定(基準乳量・受胎参照)の変更'),
  z.strictObject({operation:z.literal('add_device'),kind:z.enum(['fan','soaker','mist']),x:z.number().optional().describe('長さ方向の設置位置[m]'),y:z.number().optional().describe('幅方向の設置位置[m]。xとyは両方指定')}),
  z.strictObject({operation:z.literal('duplicate_device'),deviceId:z.string()}),
  z.strictObject({operation:z.literal('remove_device'),deviceId:z.string()}),
 ]);
 server.registerTool('edit',{
  description:'現在の案または共通気象へ1操作を適用する（画面にも即時反映・自動再計算）。operationごとに必要な引数のみ。成功時は適用後データとinputHashを返す。計算の完了を意味しない。',
  inputSchema:editSchema,
 },args=>relay('edit',args));

 server.registerTool('set_view',{
  description:'表示のみ変更（物理計算・Undo対象外）。mode/metric/選択中の地点・設備・区画/表示フラグ/timeSecの部分更新。地点を選ぶと所属区画も選択される。timeSecは再生を止める。',
  inputSchema:z.strictObject({
   mode:z.enum(['3d','2d']).optional(),
   metric:z.enum(['delta','deficit','speed','temperature']).optional(),
   selectedProbeId:z.string().optional(),
   selectedDeviceId:z.string().nullable().optional(),
   selectedAreaId:z.string().nullable().optional(),
   analysis:z.boolean().optional(),realistic:z.boolean().optional(),heatmap:z.boolean().optional(),roof:z.boolean().optional(),flow:z.boolean().optional(),particles:z.boolean().optional(),
   timeSec:z.number().min(0).max(3600).optional(),
  }),
 },args=>relay('set_view',args));

 server.registerTool('evaluate',{
  description:'画面を変えずに仮説を評価する。editと同じoperationの配列を、現在の確定済み状態の複製へ順に適用して計算し、その結果を返す。画面の案・設備・Undo履歴・再計算には影響しない。対象案はscenarioIdで指定（省略時は現在の案）。返値のprojectまたは応答全体をJSONファイルで渡すと、画面の読込／MCP案のJSONを読込から復元・再計算できる。戻り値は平均・最大不足と基準より不足が減らず残る地点のcomparison、適用した案の区画別集計・resources・roof・（includeDaily指定時）dailyMilkと、比較用の基準案集計。「この設備を置いたら？」「どの対策が効くか」といった試行はedit→undoではなくこのツールを使う。',
  inputSchema:z.strictObject({
   operations:z.array(editSchema).describe('複製へ順に適用する操作列（editと同じoperation/引数。空配列は現状そのままの計算）'),
   scenarioId:z.string().optional().describe('操作を適用する案ID。省略時は現在の案。基準案は読取専用'),
   includeDaily:z.boolean().optional().describe('trueで日乳量の仮説モデルまで計算（数十秒かかる。省略時は60分熱計算のみ）'),
  }),
 },args=>relay('evaluate',args,120000));

 server.registerTool('describe_model',{
  description:'このアプリの計算モデルが「何を・どう仮定して・何を無視して」計算しているかを返す。計算構造(屋根/風/散水/ミスト/牛体収支/日集計)、入力・出力フィールドの意味、主な仮定定数、限界、検証状態を含む。get_results/evaluateの数値を解釈・説明する前に呼ぶ。',
 },()=>relay('describe_model'));

 server.registerTool('get_results',{
  description:'現在入力に対応する計算結果。省略時は全案の区画別集計・resources・roof平均・dailyMilkと選択地点の詳細。status: ready=日乳量まで完了 / thermal_ready=熱のみ・dailyMilk pending / calculating / editing / error。時系列は返さない。再取得は1秒以上空けて。',
  inputSchema:z.strictObject({
   scenarioId:z.string().optional().describe('指定時はその案のみ'),
   probeId:z.string().optional().describe('指定時はその地点を詳細対象にする（省略時は選択地点）'),
  }),
 },args=>relay('get_results',args));

 server.registerTool('undo',{
  description:'最後の編集を1回戻す（画面のUndoと同じ履歴。案選択・viewは維持）。履歴がなければchanged:false。表示操作は戻せない。',
 },()=>relay('undo'));

 return server;
}

// ---- boot ----------------------------------------------------------------------
httpServer.on('error',e=>{
 log(`HTTP/WS listener failed: ${e.message}`);
 log(`port ${PORT} is already in use — 別のmcp-serverプロセスが残っているか、手動で停止してください`);
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
