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
import {renderHeader,renderSummary,renderWeatherPanel,renderRoofPanel,renderDevicesPanel,renderDevicePanel,renderProbePanel,renderReferencePane,renderComparison,renderSettings,renderReference,renderEvidence,renderHelp,renderAreas,renderChrome} from './ui/panels.js';
import {renderTimeline,updateTime} from './ui/timeline.js';
import type {ChartMetric} from './ui/timeline.js';
import {createWorkspace,startPlacement,cancelPlacement,moveCandidate,confirmCandidate,notifyExternalChange,openPanel,closePanel,openSheet,closeSheet,guideAdvance,guideSkip,guideRestart} from './ui/workspaceState.js';
import type {Workspace,SheetTab} from './ui/workspaceState.js';
import {checkPlacement} from './template/placement.js';
import {buildLayout} from './template/layout.js';
import {createCommands} from './mcp/commands.js';
import type {EvalJob} from './mcp/commands.js';
import {startMcpBridge} from './mcp/bridge.js';
import {openProjectImport} from './ui/projectImport.js';

declare global {interface Window {__DCS_WORKER_SOURCE__?:string;__DCS__?:unknown}}
const store=new ProjectStore(createProject()),gate=new ResultGate();
let result:SimulationResult|null=null,worker:Worker|null=null,scene:SceneView|null=null,mode='',calculating=false,lastCalculationMs=0,startTime=0,workerFailed=false,pending=false,invalid=false,workerError:string|null=null,suppressChange=false;
let chart:ChartMetric='qW',playing=false,playTimer:number|null=null,speed=120,jobTimer:number|null=null;
const ROOT_KEY='cooling-planner-project-v10',GUIDE_KEY='cooling-planner-guide-v1';
const ws:Workspace=createWorkspace();
try{if(localStorage.getItem(GUIDE_KEY)==='done')ws.guide.done=true}catch{}
let previousFull=store.project;
el('app').innerHTML=layout();
function safe(fn:()=>void){try{fn()}catch(e){showError(e instanceof Error?e.message:String(e))}}
function showError(message:string){el('error-message').textContent=message;el('error-banner').hidden=false}
let toastTimer=0;function toast(message:string){clearTimeout(toastTimer);el('toast').textContent=message;el('toast').hidden=false;toastTimer=window.setTimeout(()=>el('toast').hidden=true,3500)}
const currentResult=()=>result?.inputHash===gate.expectedHash?result:null;
const markGuideDone=()=>{if(ws.guide.done)try{localStorage.setItem(GUIDE_KEY,'done')}catch{}};
function status(){
 const milkPending=calculating&&result!==null;
 const state=invalid?'invalid':store.isDraft?'editing':pending?'pending':workerFailed?'error':calculating?'calculating':'ready';
 const labels:Record<string,string>={invalid:'入力エラー',editing:'配置を編集中',pending:'入力を確定してください',error:'計算エラー',calculating:milkPending?'乳量を計算中…':'計算中…',ready:`計算完了 · ${(lastCalculationMs/1000).toFixed(1)}秒`};
 el('status').textContent=labels[state];el('status').dataset.state=state;
 el('scene-busy').hidden=!calculating;el<HTMLButtonElement>('undo-button').disabled=!store.undoCount;el<HTMLButtonElement>('redo-button').disabled=!store.redoCount;
 document.querySelectorAll<HTMLButtonElement>('[data-action="save"],[data-action="export-results"]').forEach(b=>b.disabled=pending||invalid||store.isDraft);
}
/** Project the placement candidate to screen space and show/hide the ghost marker. */
function updateGhost(){
 const g=el('placement-ghost'),pl=ws.placement;
 if(!pl||pl.x===null||pl.y===null||!scene?.screenPoint){g.hidden=true;return}
 const pt=scene.screenPoint([pl.x,pl.heightM,pl.y]);
 g.hidden=!pt.visible;g.style.left=`${pt.x}px`;g.style.top=`${pt.y}px`;
 g.dataset.valid=String(pl.valid);
 el('placement-ghost-label').textContent=pl.valid?{fan:'ファン',soaker:'ソーカー',mist:'ミスト'}[pl.kind]:'配置不可';
}
function syncScene(){
 const p=store.project;
 const requestedMode=p.view.mode==='3d'&&p.view.realistic?'realistic':p.view.mode;
 if(!scene||mode!==requestedMode){scene?.dispose();scene=null;mode=requestedMode;
  const cb:ViewCallbacks={selectDevice:id=>safe(()=>{store.setView({selectedDeviceId:id});if(store.project.view.selectedDeviceId===id){openPanel(ws,'device');render()}}),selectProbe:id=>safe(()=>{store.setView({selectedProbeId:id});if(store.project.view.selectedProbeId===id){openPanel(ws,'probe');render()}}),begin:()=>store.begin(),preview:(id,patch)=>store.previewDevice(id,patch),commit:()=>store.commit(),cancel:()=>store.cancel(),camera:c=>store.setView({camera:c}),error:message=>{showError(message);if(store.project.view.mode==='3d'){store.setView({mode:'2d'})}},
   placeMove:pos=>{if(!ws.placement)return;if(pos)moveCandidate(ws,pos[0],pos[1],checkPlacement(store.project,pos[0],pos[1])==='ok');else moveCandidate(ws,null,null,false);updateGhost();renderChrome(store.project,currentResult(),ws)},
   // Capture kind before confirming: a valid confirmCandidate clears ws.placement.
   placeCommit:()=>{const kind=ws.placement?.kind;if(!kind)return;const pose=confirmCandidate(ws);if(!pose){toast('ここには配置できません');updateGhost();renderChrome(store.project,currentResult(),ws);return}safe(()=>kind==='fan'?store.addFan({x:pose.x,y:pose.y}):store.addNozzle(kind,{x:pose.x,y:pose.y}))}};
  if(mode==='3d'||mode==='realistic'){try{scene=new Viewport3D(el('scene'),cb,undefined,mode==='realistic')}catch{mode='2d';scene=new SVG2D(el('scene'),cb);queueMicrotask(()=>store.setView({mode:'2d'}));toast('3Dを初期化できないため、2Dで続行します。')}}else scene=new SVG2D(el('scene'),cb);
 }
 scene.setPlacement?.(ws.placement?{heightM:ws.placement.heightM}:null);
 scene.sync(p,currentResult());updateGhost();
}
function render(){
 const p=store.project,r=currentResult();
 // An uncommitted edit lives only in the focused input (blur commits via 'change').
 // Rebuilding the DOM on worker results would drop it, so carry value/focus over.
 const ae=document.activeElement;
 const keep=pending&&ae instanceof HTMLInputElement&&ae.type!=='checkbox'&&ae.type!=='radio'&&ae.id
  ?{id:ae.id,value:ae.value,bad:ae.classList.contains('bad-input')}:null;
 // innerHTML rebuilds blur+change the focused field mid-render (while still
 // connected) — a teardown artifact that must not commit. Suppress it; real
 // user change events cannot interleave inside a synchronous render.
 const prevSuppress=suppressChange;suppressChange=true;
 try{
  renderHeader(p);renderSummary(p,r);renderWeatherPanel(p);renderRoofPanel(p);renderDevicesPanel(p);renderDevicePanel(p);renderProbePanel(p,r);renderReferencePane(p,r);renderComparison(p,r);renderAreas(p,r);
  if(ws.sheet==='timeline')renderTimeline(p,r,chart);
  updateTime(p,r);renderChrome(p,r,ws);
  for(const [id,fn]of [['settings-dialog',()=>renderSettings(p)],['reference-dialog',()=>renderReference(p)],['evidence-dialog',()=>renderEvidence(p,r)],['help-dialog',()=>renderHelp()]] as const)if(el<HTMLDialogElement>(id).open)fn();
  syncScene();status();
  if(keep){const n=document.getElementById(keep.id);if(n instanceof HTMLInputElement){n.value=keep.value;if(keep.bad)n.classList.add('bad-input');n.focus({preventScroll:true})}}
 }finally{suppressChange=prevSuppress}
}
function spawnWorker():Worker|null{
 try{
  if(window.__DCS_WORKER_SOURCE__){const url=URL.createObjectURL(new Blob([window.__DCS_WORKER_SOURCE__],{type:'application/javascript'}));const w=new Worker(url);URL.revokeObjectURL(url);return w}
  return new Worker(new URL('./worker.js',document.baseURI));
 }catch{return null}
}
function makeWorker(){
 worker?.terminate();worker=null;workerFailed=false;
 try{
  worker=spawnWorker();if(!worker)throw Error('no worker');
  worker.onmessage=(e:MessageEvent<Reply>)=>{if(!gate.accepts(e.data))return;const d=e.data;
   if(d.kind==='error'){calculating=false;lastCalculationMs=performance.now()-startTime;workerFailed=true;workerError=d.error;result=null;showError(d.error)}
   else if(d.kind==='thermal-result'){result=d.result;workerFailed=false;workerError=null/* keep calculating until the daily stage */}
   else if(d.kind==='daily-result'){if(result&&result.inputHash===d.inputHash)mergeDaily(result,d.daily,d.thermal,d.dailyMilkStatus);calculating=false;lastCalculationMs=performance.now()-startTime}
   render();
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
function toggleSheet(tab:SheetTab){ws.sheet===tab?closeSheet(ws):openSheet(ws,tab);if(ws.sheet&&!ws.guide.done&&(ws.guide.step===3||ws.guide.step===0)){guideAdvance(ws);markGuideDone()}}
function tryPlacement(kind:'fan'|'soaker'|'mist'){
 if(activeScenario(store.project).readOnly){toast('基準案は固定です。「編集案 A で試す」で切り替えます');return}
 if(ws.placement?.kind===kind){cancelPlacement(ws);return}
 startPlacement(ws,kind);closePanel(ws);updateGhost();
}
store.subscribe((p,kind)=>{
 const prev=previousFull;
 // A pending placement is cancelled by external project edits, drafts, or
 // scenario/mode/selection changes — camera, time and display flags are safe.
 if(ws.placement){
  const structuralView=p.activeScenarioId!==prev.activeScenarioId||p.view.mode!==prev.view.mode||p.view.realistic!==prev.view.realistic||p.view.selectedDeviceId!==prev.view.selectedDeviceId||p.view.selectedProbeId!==prev.view.selectedProbeId||p.view.selectedAreaId!==prev.view.selectedAreaId;
  if(kind!=='view'||structuralView)notifyExternalChange(ws,kind);
 }
 if(p.view.selectedDeviceId&&p.view.selectedDeviceId!==prev.view.selectedDeviceId)openPanel(ws,'device');
 if(p.view.selectedProbeId&&p.view.selectedProbeId!==prev.view.selectedProbeId)openPanel(ws,'probe');
 if(!ws.guide.done){
  if(ws.guide.step===0&&(p.view.selectedProbeId!==prev.view.selectedProbeId||p.view.metric!==prev.view.metric||p.view.selectedDeviceId!==prev.view.selectedDeviceId)){guideAdvance(ws)}
  else if(ws.guide.step===1&&(p.view.selectedProbeId!==prev.view.selectedProbeId||p.view.metric!==prev.view.metric)){guideAdvance(ws)}
  else if(ws.guide.step===2&&p.view.selectedDeviceId&&p.view.selectedDeviceId!==prev.view.selectedDeviceId){guideAdvance(ws)}
 }
 const timeOnly=kind==='view'&&p.view.timeSec!==prev.view.timeSec&&JSON.stringify({...p.view,timeSec:0})===JSON.stringify({...prev.view,timeSec:0});
 const cameraOnly=kind==='view'&&JSON.stringify({...p.view,camera:null})===JSON.stringify({...prev.view,camera:null})&&JSON.stringify(p.view.camera)!==JSON.stringify(prev.view.camera);
 previousFull=p;
 if(kind==='draft'){syncScene();status();return}
 if(timeOnly){updateTime(p,currentResult());syncScene();return}
 if(cameraOnly){updateGhost();return}
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
 // Rebuild teardown fires blur+change on the focused field mid-render — a
 // rebuild artifact, not a user commit. Ignore it so pending edits stay pending.
 if(suppressChange||!i.isConnected)return;
 try{
  if(i.id==='probe-select'){store.setView({selectedProbeId:i.value});return}if(i.id==='device-select'){store.setView({selectedDeviceId:i.value||null});return}if(i.id==='play-speed'){speed=Number(i.value);return}
  if(!(i instanceof HTMLInputElement))return;
  if(i.dataset.view){store.setView({[i.dataset.view]:i.checked});return}
  if(i.dataset.roofToggle){const k=i.dataset.roofToggle;store.updateRoof(k==='coating'?{reflectance:i.checked?.7:.2}:k==='insulation'?{insulationM:i.checked?.02:0}:{sprayEnabled:i.checked});return}
  if(i.hasAttribute('data-all-fans')){store.setAllFans(i.checked);return}
  if(i.dataset.systemEnabled){store.updateSystem(i.dataset.systemEnabled,{enabled:i.checked});return}
  if(i.hasAttribute('data-device-enabled')){store.updateDevice(store.project.view.selectedDeviceId!,{enabled:i.checked});return}
  if(i.hasAttribute('data-fertility-linked')){store.updateFertility({mode:i.checked?'simulation':'manual',exposureAssumed:true});return}
  if(i.hasAttribute('data-weather-mode')){const p0=store.project,hours=p0.dailyWeather.hours.length===24?p0.dailyWeather.hours:Array.from({length:24},(_,h)=>({hour:h,temperatureC:p0.environment.temperatureC,relativeHumidityPct:p0.environment.relativeHumidityPct,solarRoofWm2:p0.environment.solarRoofWm2}));store.updateDailyWeather(i.checked?{mode:'hourly',hours}:{mode:'constant',hours:[]});return}
  if(i.type!=='number')return;
  const value=i.value.trim()===''&&(i.dataset.price||i.hasAttribute('data-milk-baseline'))?null:numberInput(i);
  if(i.dataset.weatherField){const h=Number(i.dataset.weatherHour);store.updateDailyWeather({mode:'hourly',hours:store.project.dailyWeather.hours.map(r=>r.hour===h?{...r,[i.dataset.weatherField!]:value}:r)})}
  else if(i.dataset.env)store.updateEnvironment({[i.dataset.env]:value});
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
 const inspect=(event.target as Element).closest<HTMLElement>('[data-inspect-probe]');
 if(inspect){safe(()=>{store.setView({selectedProbeId:inspect.dataset.inspectProbe!,metric:'deficit',heatmap:true});closeSheet(ws);openPanel(ws,'probe');render()});return}
 const areaRow=(event.target as Element).closest('[data-area]');
 if(areaRow){const id=areaRow.getAttribute('data-area');safe(()=>store.setView({selectedAreaId:store.project.view.selectedAreaId===id?null:id}));return}
 const b=(event.target as Element).closest<HTMLButtonElement>('button');if(!b||b.disabled)return;safe(()=>{
 const p=store.project,id=p.view.selectedDeviceId;
 if(b.dataset.scenario){stopPlayback();store.switchScenario(b.dataset.scenario);return}if(b.dataset.mode){store.setView({mode:b.dataset.mode as '2d'|'3d',...(b.dataset.mode==='3d'?{realistic:false}:{})});return}if(b.dataset.render==='realistic'){store.setView({mode:'3d',realistic:true});return}if(b.dataset.metric){store.setView({metric:b.dataset.metric as Project['view']['metric'],...(p.view.realistic&&!p.view.heatmap?{heatmap:true}:{})});return}if(b.dataset.camera){scene?.preset?.(b.dataset.camera as 'overview'|'top'|'side');return}
 if(b.dataset.sheet){if(ws.sheet!==b.dataset.sheet)openSheet(ws,b.dataset.sheet as SheetTab);render();return}
 if(b.dataset.chart){chart=b.dataset.chart as ChartMetric;document.querySelectorAll<HTMLElement>('[data-chart]').forEach(x=>x.classList.toggle('active',x.dataset.chart===chart));renderTimeline(p,currentResult(),chart);return}
 if(b.dataset.close){el<HTMLDialogElement>(b.dataset.close).close();return}
 switch(b.dataset.action){
  case 'save':if(pending||invalid||store.isDraft)throw Error('入力を確定してから保存してください');download('cooling-planner-v10.json',store.serialize());toast('配置・環境・モデルの仮定を保存しました');break;
  case 'load':el<HTMLInputElement>('file-input').click();break;
  case 'paste-project':{
   document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d=>d.close());
   openProjectImport(store,()=>{invalid=false;pending=false;el('error-banner').hidden=true;render();toast('MCP案を読み込み、この画面で再計算しています')});break;
  }
  case 'export-results':{const r=currentResult();if(!r)throw Error('計算完了後に保存してください');if(r.dailyMilkStatus==='pending')throw Error('日乳量の計算完了を待ってください');download('cooling-planner-v9-results.json',{appVersion:p.appVersion,project:p,result:r});break}
  case 'undo':store.undo();break;case 'redo':store.redo();break;
  case 'reset-active':store.resetActive();toast('編集案を基準の設定に戻しました');break;
  case 'copy-scenario':store.copyActiveToOther();toast('屋根・機器を別の編集案へコピーしました');break;
  case 'reset-milk':store.resetMilk();toast('乳量モデルの仮定を初期値に戻しました');break;
  case 'select-first-fan':store.setView({selectedDeviceId:activeScenario(p).fans[0]?.id??null});if(store.project.view.selectedDeviceId){openPanel(ws,'device');render()}break;
  case 'add-fan':store.addFan();break;case 'add-soaker':store.addNozzle('soaker');break;case 'add-mist':store.addNozzle('mist');break;
  case 'place-fan':tryPlacement('fan');render();break;case 'place-soaker':tryPlacement('soaker');render();break;case 'place-mist':tryPlacement('mist');render();break;
  case 'confirm-placement':{const pl=ws.placement;if(!pl)break;const pose=confirmCandidate(ws);if(!pose){toast('ここには配置できません')}else safe(()=>pl.kind==='fan'?store.addFan({x:pose.x,y:pose.y}):store.addNozzle(pl.kind,{x:pose.x,y:pose.y}));render();break}
  case 'cancel-placement':cancelPlacement(ws);updateGhost();render();break;
  case 'panel-probe':openPanel(ws,'probe');render();break;
  case 'devices':openPanel(ws,'devices');render();break;
  case 'panel-roof':openPanel(ws,'roof');render();break;
  case 'weather':openPanel(ws,'weather');render();break;
  case 'close-panel':closePanel(ws);render();break;
  case 'close-sheet':closeSheet(ws);render();break;
  case 'results':toggleSheet('compare');render();break;
  case 'cycle':toggleSheet('timeline');render();break;
  case 'try-editable':store.switchScenario(store.project.scenarios.find(s=>!s.readOnly)?.id??store.project.activeScenarioId);break;
  case 'guide-next':guideAdvance(ws);markGuideDone();render();break;
  case 'guide-skip':guideSkip(ws);markGuideDone();render();break;
  case 'guide-restart':el<HTMLDialogElement>('help-dialog').close();guideRestart(ws);render();break;
  case 'help':renderHelp();el<HTMLDialogElement>('help-dialog').showModal();break;
  case 'duplicate':if(id)store.duplicateDevice(id);break;case 'remove':if(id)store.removeDevice(id);break;
  case 'rotate':if(id){const d=store.findDevice(id)!;store.updateDevice(id,{yawDeg:(d.yawDeg+90)%360})}break;
  case 'dismiss-error':el('error-banner').hidden=true;break;
  case 'evidence':renderEvidence(p,currentResult());el<HTMLDialogElement>('evidence-dialog').showModal();break;
  case 'settings':renderSettings(p);el<HTMLDialogElement>('settings-dialog').showModal();break;
  case 'weather-fill-env':{const e0=p.environment;store.updateDailyWeather({mode:'hourly',hours:Array.from({length:24},(_,h)=>({hour:h,temperatureC:e0.temperatureC,relativeHumidityPct:e0.relativeHumidityPct,solarRoofWm2:e0.solarRoofWm2}))});break}
  case 'references':renderReference(p);el<HTMLDialogElement>('reference-dialog').showModal();break;
  case 'restore-local':{const text=localStorage.getItem(ROOT_KEY);if(!text)throw Error('この端末には保存がありません');store.importJSON(text);toast('端末内の保存を復元しました');break}
  case 'play':if(playing)stopPlayback();else{if(p.view.timeSec>=3600)store.setView({timeSec:0});playing=true;el('play-button').innerHTML='Ⅱ 停止';playTimer=window.setInterval(()=>{const t=Math.min(3600,store.project.view.timeSec+speed*.1);store.setView({timeSec:t});if(t>=3600)stopPlayback()},100)}break;
 }
})});
el<HTMLInputElement>('file-input').addEventListener('change',async()=>{const i=el<HTMLInputElement>('file-input'),file=i.files?.[0];if(!file)return;try{if(file.size>2097152)throw Error('JSONは最大2MiBです');store.importJSON(await file.text());invalid=false;pending=false;el('error-banner').hidden=true;render();toast('読み込み、モデルを再計算しています')}catch(e){showError(e instanceof Error?e.message:String(e))}finally{i.value=''}});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!document.querySelector('dialog[open]')){if(ws.placement){cancelPlacement(ws);updateGhost();render();return}store.cancel();pending=false;invalid=false;render();return}
 if(!(e.ctrlKey||e.metaKey)||e.altKey||(e.target as Element).closest('input,select,textarea,[contenteditable]'))return;
 if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?store.redo():store.undo()}else if(e.key.toLowerCase()==='y'){e.preventDefault();store.redo()}
});
window.addEventListener('blur',()=>{if(ws.placement){cancelPlacement(ws);updateGhost();render()}});
Object.defineProperty(window,'__DCS__',{value:{snapshot:()=>structuredClone(store.project),result:()=>structuredClone(currentResult()),hash:()=>inputHash(store.committed),screenPoint:(x:number,h:number,y:number)=>scene?.screenPoint?.([x,h,y]),workspace:()=>({panel:ws.panel,sheet:ws.sheet,placement:ws.placement?{...ws.placement}:null,guide:{...ws.guide}}),metrics:()=>({lastCalculationMs,renderer:scene?.rendererName,undoCount:store.undoCount,redoCount:store.redoCount,workerFailed,calculating,graphics:scene?.diagnostics?.()??{}})},writable:false});
makeWorker();recalculate();render();
/** Runs a one-off simulation on a cloned project via a dedicated worker; the live gate/result are untouched. */
function evaluateProject(project:Project,opts:{daily:boolean}):Promise<EvalJob>{
 return new Promise((resolve,reject)=>{
  const w=spawnWorker();
  if(!w){reject(new Error('計算Workerを起動できません'));return}
  const timer=window.setTimeout(()=>{w.terminate();reject(new Error('仮想評価の計算がタイムアウトしました'))},120000);
  const done=(fn:()=>void)=>{clearTimeout(timer);w.terminate();fn()};
  let thermal:SimulationResult|null=null;
  w.onmessage=(e:MessageEvent<Reply>)=>{const d=e.data;
   if(d.kind==='error')done(()=>reject(new Error(d.error)));
   else if(d.kind==='thermal-result'){const t=d.result;thermal=t;if(!opts.daily)done(()=>resolve({thermal:t,daily:null,dailyThermal:null,dailyMilkStatus:'complete'}))}
   else if(d.kind==='daily-result'&&thermal)done(()=>resolve({thermal:thermal!,daily:d.daily,dailyThermal:d.thermal,dailyMilkStatus:d.dailyMilkStatus}))};
  w.onerror=()=>done(()=>reject(new Error('計算Workerエラー')));
  w.postMessage({jobId:1,inputHash:inputHash(project),project});
 });
}
if(location.protocol==='http:'&&new URLSearchParams(location.search).get('mcp')==='1'){
 const commands=createCommands({store,currentResult,status:()=>({pendingInput:pending,invalidInput:invalid,calculating,workerError}),stopPlayback,evaluate:evaluateProject});
 startMcpBridge({url:`ws://${location.host}/bridge`,commands,notify:toast});
}
