import type {Project,SimulationResult,Device} from './domain/project.js';
import {activeScenario} from './domain/project.js';
import {createProject} from './data/defaults.js';
import {ProjectStore} from './state/store.js';
import {inputHash} from './model/simulation.js';
import {mergeDaily} from './model/dailySimulation.js';
import {ResultGate} from './worker/protocol.js';
import type {Reply} from './worker/protocol.js';
import {Viewport3D} from './views/viewport3d.js';
import {SVG2D} from './views/svg2d.js';
import type {SceneView,ViewCallbacks} from './views/common.js';
import {layout} from './ui/layout.js';
import {el,icon} from './ui/dom.js';
import {renderControls,renderResults,renderSettings,renderReference,renderEvidence,renderAreas} from './ui/panels.js';
import {renderTimeline,updateTime} from './ui/timeline.js';
import type {ChartMetric} from './ui/timeline.js';
import {createCommands} from './mcp/commands.js';
import {startMcpBridge} from './mcp/bridge.js';

declare global {interface Window {__DCS_WORKER_SOURCE__?:string;__DCS__?:unknown}}
const store=new ProjectStore(createProject()),gate=new ResultGate();
let result:SimulationResult|null=null,worker:Worker|null=null,scene:SceneView|null=null,mode='',calculating=false,lastCalculationMs=0,startTime=0,workerFailed=false,pending=false,invalid=false,workerError:string|null=null;
let chart:ChartMetric='qW',playing=false,playTimer:number|null=null,speed=120,jobTimer:number|null=null;
const ROOT_KEY='cooling-planner-project-v9';
let previousView=JSON.stringify(store.project.view),previousFull=store.project;
el('app').innerHTML=layout();
function safe(fn:()=>void){try{fn()}catch(e){showError(e instanceof Error?e.message:String(e))}}
function showError(message:string){el('error-message').textContent=message;el('error-banner').hidden=false}
let toastTimer=0;function toast(message:string){clearTimeout(toastTimer);el('toast').textContent=message;el('toast').hidden=false;toastTimer=window.setTimeout(()=>el('toast').hidden=true,3500)}
const currentResult=()=>result?.inputHash===gate.expectedHash?result:null;
function status(){
 const milkPending=calculating&&result!==null;
 const state=invalid?'invalid':store.isDraft?'editing':pending?'pending':workerFailed?'error':calculating?'calculating':'ready';
 const labels:Record<string,string>={invalid:'入力エラー',editing:'配置を編集中',pending:'入力を確定してください',error:'計算エラー',calculating:milkPending?'乳量を計算中…':'計算中…',ready:`計算完了 · ${(lastCalculationMs/1000).toFixed(1)}秒`};
 el('status').textContent=labels[state];el('status').dataset.state=state;
 el('scene-busy').hidden=!calculating;el<HTMLButtonElement>('undo-button').disabled=!store.undoCount;el<HTMLButtonElement>('redo-button').disabled=!store.redoCount;
 document.querySelectorAll<HTMLButtonElement>('[data-action="save"],[data-action="export-results"]').forEach(b=>b.disabled=pending||invalid||store.isDraft);
}
function syncScene(){
 const p=store.project;
 const requestedMode=p.view.mode==='3d'&&p.view.realistic?'realistic':p.view.mode;
 if(!scene||mode!==requestedMode){scene?.dispose();scene=null;mode=requestedMode;
  const cb:ViewCallbacks={selectDevice:id=>safe(()=>store.setView({selectedDeviceId:id})),selectProbe:id=>safe(()=>store.setView({selectedProbeId:id})),begin:()=>store.begin(),preview:(id,patch)=>store.previewDevice(id,patch),commit:()=>store.commit(),cancel:()=>store.cancel(),camera:c=>store.setView({camera:c}),error:message=>{showError(message);if(store.project.view.mode==='3d'){store.setView({mode:'2d'})}}};
  if(mode==='3d'||mode==='realistic'){try{scene=new Viewport3D(el('scene'),cb,undefined,mode==='realistic')}catch{mode='2d';scene=new SVG2D(el('scene'),cb);queueMicrotask(()=>store.setView({mode:'2d'}));toast('3Dを初期化できないため、2Dで続行します。')}}else scene=new SVG2D(el('scene'),cb);
 }
 scene.sync(p,currentResult());
}
function render(){
 renderControls(store.project);renderResults(store.project,currentResult());renderAreas(store.project,currentResult());renderTimeline(store.project,currentResult(),chart);updateTime(store.project,currentResult());
 for(const [id,fn]of [['settings-dialog',()=>renderSettings(store.project)],['reference-dialog',()=>renderReference(store.project)],['evidence-dialog',()=>renderEvidence(store.project,currentResult())]] as const)if(el<HTMLDialogElement>(id).open)fn();
 syncScene();status();
}
function makeWorker(){
 worker?.terminate();worker=null;workerFailed=false;
 try{
  if(window.__DCS_WORKER_SOURCE__){const url=URL.createObjectURL(new Blob([window.__DCS_WORKER_SOURCE__],{type:'application/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url)}
  else worker=new Worker(new URL('./worker.js',document.baseURI));
  worker.onmessage=(e:MessageEvent<Reply>)=>{if(!gate.accepts(e.data))return;const d=e.data;
   if(d.kind==='error'){calculating=false;lastCalculationMs=performance.now()-startTime;workerFailed=true;workerError=d.error;result=null;showError(d.error)}
   else if(d.kind==='thermal-result'){result=d.result;workerFailed=false;workerError=null/* keep calculating until the daily stage */}
   else if(d.kind==='daily-result'){if(result&&result.inputHash===d.inputHash)mergeDaily(result,d.daily,d.dailyMilkStatus);calculating=false;lastCalculationMs=performance.now()-startTime}
   renderResults(store.project,currentResult());renderAreas(store.project,currentResult());renderTimeline(store.project,currentResult(),chart);updateTime(store.project,currentResult());syncScene();status();
  };
  worker.onerror=()=>{calculating=false;workerFailed=true;workerError='計算Workerを起動できません。単体HTML版、またはHTTPサーバーで開いてください。';showError(workerError);status()};
 }catch(e){workerFailed=true;showError(String(e));status()}
}
function recalculate(){
 if(jobTimer!==null)clearTimeout(jobTimer);const hash=inputHash(store.committed),jobId=gate.expect(hash);
 if(calculating){worker?.terminate();worker=null}calculating=true;workerError=null;status();
 jobTimer=window.setTimeout(()=>{jobTimer=null;if(!worker)makeWorker();if(!worker){calculating=false;status();return}startTime=performance.now();worker.postMessage({jobId,inputHash:hash,project:store.committed})},100);
}
function stopPlayback(){playing=false;if(playTimer!==null)clearInterval(playTimer);playTimer=null;el('play-button').innerHTML=`${icon('play',15)} 再生`}
store.subscribe((p,kind)=>{
 const timeOnly=kind==='view'&&p.view.timeSec!==previousFull.view.timeSec&&JSON.stringify({...p.view,timeSec:0})===JSON.stringify({...previousFull.view,timeSec:0});
 const cameraOnly=kind==='view'&&JSON.stringify({...p.view,camera:null})===JSON.stringify({...previousFull.view,camera:null})&&JSON.stringify(p.view.camera)!==JSON.stringify(previousFull.view.camera);
 previousFull=p;previousView=JSON.stringify(p.view);
 if(kind==='draft'){syncScene();status();return}
 if(timeOnly){updateTime(p,currentResult());syncScene();return}
 if(cameraOnly)return;
 if(kind==='project'){pending=false;invalid=false;stopPlayback();try{localStorage.setItem(ROOT_KEY,store.serialize())}catch{}recalculate()}
 render();
});
function numberInput(input:HTMLInputElement){
 if(input.value.trim()==='')throw Error('値を入力してください');const value=Number(input.value);if(!Number.isFinite(value))throw Error('有限の数値を入力してください');
 if(input.min!==''&&value<Number(input.min)||input.max!==''&&value>Number(input.max))throw Error(`${input.min}〜${input.max}の範囲で入力してください`);return value*Number(input.dataset.factor??1);
}
document.addEventListener('input',event=>{
 const i=event.target as HTMLInputElement;
 if(i.id==='time-slider'){stopPlayback();store.setView({timeSec:Number(i.value)});return}
 if(i.type!=='number')return;pending=true;
 try{if(i.value.trim()===''&&(i.dataset.price||i.hasAttribute('data-milk-baseline'))){}else numberInput(i);i.classList.remove('bad-input');invalid=!!document.querySelector('.bad-input')}catch{i.classList.add('bad-input');invalid=true}status();
});
document.addEventListener('change',event=>{
 const i=event.target as HTMLInputElement|HTMLSelectElement;if(i.id==='file-input')return;
 try{
  if(i.id==='probe-select'){store.setView({selectedProbeId:i.value});return}if(i.id==='device-select'){store.setView({selectedDeviceId:i.value||null});return}if(i.id==='play-speed'){speed=Number(i.value);return}
  if(!(i instanceof HTMLInputElement))return;
  if(i.dataset.view){store.setView({[i.dataset.view]:i.checked});return}
  if(i.dataset.roofToggle){const k=i.dataset.roofToggle;store.updateRoof(k==='coating'?{reflectance:i.checked?.7:.2}:k==='insulation'?{insulationM:i.checked?.02:0}:{sprayEnabled:i.checked});return}
  if(i.hasAttribute('data-all-fans')){store.setAllFans(i.checked);return}
  if(i.dataset.systemEnabled){store.updateSystem(i.dataset.systemEnabled,{enabled:i.checked});return}
  if(i.hasAttribute('data-device-enabled')){store.updateDevice(store.project.view.selectedDeviceId!,{enabled:i.checked});return}
  if(i.hasAttribute('data-fertility-linked')){store.updateFertility({mode:i.checked?'simulation':'manual',exposureAssumed:true});return}
  if(i.type!=='number')return;
  const value=i.value.trim()===''&&(i.dataset.price||i.hasAttribute('data-milk-baseline'))?null:numberInput(i);
  if(i.dataset.env)store.updateEnvironment({[i.dataset.env]:value});
  else if(i.dataset.roof)store.updateRoof({[i.dataset.roof]:value});
  else if(i.dataset.device)store.updateDevice(store.project.view.selectedDeviceId!,{[i.dataset.device]:value} as Partial<Device>);
  else if(i.dataset.system)store.updateSystem(i.dataset.systemId!,{[i.dataset.system]:value});
  else if(i.dataset.template)store.updateTemplate({lengthM:Number(el<HTMLInputElement>('barn-length').value),widthM:Number(el<HTMLInputElement>('barn-width').value)});
  else if(i.dataset.price)store.updatePrices({[i.dataset.price]:value});
  else if(i.hasAttribute('data-milk-baseline'))store.updateReferences({baselineMilkKgPerDay:value});
  else if(i.dataset.milk)store.updateMilk({[i.dataset.milk]:value} as Partial<import('./domain/project.js').MilkSimulation>);
  else if(i.dataset.fertility)store.updateFertility({[i.dataset.fertility]:value});
  i.classList.remove('bad-input');pending=false;invalid=!!document.querySelector('.bad-input');if(!invalid)el('error-banner').hidden=true;status();
 }catch(e){invalid=true;pending=false;i.classList.add('bad-input');showError(e instanceof Error?e.message:String(e));status()}
});
function download(name:string,object:unknown){const url=URL.createObjectURL(new Blob([typeof object==='string'?object:JSON.stringify(object,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
document.addEventListener('click',event=>{
 const areaRow=(event.target as Element).closest('[data-area]');
 if(areaRow){const id=areaRow.getAttribute('data-area');safe(()=>store.setView({selectedAreaId:store.project.view.selectedAreaId===id?null:id}));return}
 const b=(event.target as Element).closest<HTMLButtonElement>('button');if(!b||b.disabled)return;safe(()=>{
 const p=store.project,id=p.view.selectedDeviceId;
 if(b.dataset.scenario){stopPlayback();store.switchScenario(b.dataset.scenario);return}if(b.dataset.mode){store.setView({mode:b.dataset.mode as '2d'|'3d',...(b.dataset.mode==='3d'?{realistic:false}:{})});return}if(b.dataset.render==='realistic'){store.setView({mode:'3d',realistic:true});return}if(b.dataset.metric){store.setView({metric:b.dataset.metric as Project['view']['metric']});return}if(b.dataset.camera){scene?.preset?.(b.dataset.camera as 'overview'|'top'|'side');return}
 if(b.dataset.chart){chart=b.dataset.chart as ChartMetric;document.querySelectorAll<HTMLElement>('[data-chart]').forEach(x=>x.classList.toggle('active',x.dataset.chart===chart));renderTimeline(p,currentResult(),chart);return}
 if(b.dataset.close){el<HTMLDialogElement>(b.dataset.close).close();return}
 switch(b.dataset.action){
  case 'save':if(pending||invalid||store.isDraft)throw Error('入力を確定してから保存してください');download('cooling-planner-v9.json',store.serialize());toast('配置・環境・モデルの仮定を保存しました');break;
  case 'load':el<HTMLInputElement>('file-input').click();break;
  case 'export-results':{const r=currentResult();if(!r)throw Error('計算完了後に保存してください');if(r.dailyMilkStatus==='pending')throw Error('日乳量の計算完了を待ってください');download('cooling-planner-v9-results.json',{appVersion:p.appVersion,project:p,result:r});break}
  case 'undo':store.undo();break;case 'redo':store.redo();break;
  case 'reset-active':store.resetActive();toast('編集案を基準の設定に戻しました');break;
  case 'copy-scenario':store.copyActiveToOther();toast('屋根・機器を別の編集案へコピーしました');break;
  case 'reset-milk':store.resetMilk();toast('乳量モデルの仮定を初期値に戻しました');break;
  case 'select-first-fan':store.setView({selectedDeviceId:activeScenario(p).fans[0]?.id??null});break;
  case 'add-fan':store.addFan();break;case 'add-soaker':store.addNozzle('soaker');break;case 'add-mist':store.addNozzle('mist');break;
  case 'duplicate':if(id)store.duplicateDevice(id);break;case 'remove':if(id)store.removeDevice(id);break;
  case 'rotate':if(id){const d=store.findDevice(id)!;store.updateDevice(id,{yawDeg:(d.yawDeg+90)%360})}break;
  case 'dismiss-error':el('error-banner').hidden=true;break;
  case 'evidence':renderEvidence(p,currentResult());el<HTMLDialogElement>('evidence-dialog').showModal();break;
  case 'settings':renderSettings(p);el<HTMLDialogElement>('settings-dialog').showModal();break;
  case 'references':renderReference(p);el<HTMLDialogElement>('reference-dialog').showModal();break;
  case 'restore-local':{const text=localStorage.getItem(ROOT_KEY);if(!text)throw Error('この端末には保存がありません');store.importJSON(text);toast('端末内の保存を復元しました');break}
  case 'play':if(playing)stopPlayback();else{if(p.view.timeSec>=3600)store.setView({timeSec:0});playing=true;el('play-button').innerHTML='Ⅱ 停止';playTimer=window.setInterval(()=>{const t=Math.min(3600,store.project.view.timeSec+speed*.1);store.setView({timeSec:t});if(t>=3600)stopPlayback()},100)}break;
 }
})});
el<HTMLInputElement>('file-input').addEventListener('change',async()=>{const i=el<HTMLInputElement>('file-input'),file=i.files?.[0];if(!file)return;try{if(file.size>2097152)throw Error('JSONは最大2MiBです');store.importJSON(await file.text());invalid=false;pending=false;el('error-banner').hidden=true;render();toast('読み込み、モデルを再計算しています')}catch(e){showError(e instanceof Error?e.message:String(e))}finally{i.value=''}});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!document.querySelector('dialog[open]')){store.cancel();pending=false;invalid=false;render();return}
 if(!(e.ctrlKey||e.metaKey)||e.altKey||(e.target as Element).closest('input,select,textarea,[contenteditable]'))return;
 if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?store.redo():store.undo()}else if(e.key.toLowerCase()==='y'){e.preventDefault();store.redo()}
});
Object.defineProperty(window,'__DCS__',{value:{snapshot:()=>structuredClone(store.project),result:()=>structuredClone(currentResult()),hash:()=>inputHash(store.committed),screenPoint:(x:number,h:number,y:number)=>scene?.screenPoint?.([x,h,y]),metrics:()=>({lastCalculationMs,renderer:scene?.rendererName,undoCount:store.undoCount,redoCount:store.redoCount,workerFailed,calculating,graphics:scene?.diagnostics?.()??{}})},writable:false});
makeWorker();recalculate();render();
if(location.protocol==='http:'&&new URLSearchParams(location.search).get('mcp')==='1'){
 const commands=createCommands({store,currentResult,status:()=>({pendingInput:pending,invalidInput:invalid,calculating,workerError}),stopPlayback});
 startMcpBridge({url:`ws://${location.host}/bridge`,commands,notify:toast});
}
