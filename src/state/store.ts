import type {Project,Device,Environment,Template,View,WaterSystem,RoofSettings,ReferenceSettings} from '../domain/project.js';
import {activeScenario,devices,isFan,clone} from '../domain/project.js';
import {validateProject,parseProject} from '../domain/validation.js';
import {anchorPose,buildLayout,positionFromAnchor} from '../template/layout.js';
import {createProject} from '../data/defaults.js';
export type ChangeKind='project'|'view'|'draft';
const freeze=<T>(p:T):T=>{if(p&&typeof p==='object'){for(const v of Object.values(p))freeze(v);Object.freeze(p)}return p};
const uuid=()=>{if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID();if(typeof crypto==='undefined'||!crypto.getRandomValues)throw Error('UUIDを生成できません');const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return [...b].map((v,i)=>([4,6,8,10].includes(i)?'-':'')+v.toString(16).padStart(2,'0')).join('')};
/** Snapshot transactions and one gesture = one undo entry; adapted from v0.3 pattern. */
export class ProjectStore{
 private current:Project;private draft:Project|null=null;private history:Project[]=[];private future:Project[]=[];private listeners=new Set<(p:Project,kind:ChangeKind)=>void>();
 constructor(p=createProject()){validateProject(p);this.current=freeze(clone(p))}
 get project(){return this.draft??this.current}get committed(){return this.current}get isDraft(){return !!this.draft}get undoCount(){return this.history.length}get redoCount(){return this.future.length}
 subscribe(fn:(p:Project,kind:ChangeKind)=>void){this.listeners.add(fn);return ()=>this.listeners.delete(fn)}
 private emit(kind:ChangeKind){for(const fn of this.listeners)fn(this.project,kind)}
 private commitCandidate(p:Project){validateProject(p);if(JSON.stringify(p)===JSON.stringify(this.current))return;this.history.push(this.current);if(this.history.length>40)this.history.shift();this.future=[];this.current=freeze(p);this.emit('project')}
 private edit(fn:(p:Project)=>void){if(this.draft)this.cancel();const p=clone(this.current);fn(p);this.commitCandidate(p)}
 private editable(p:Project){const s=activeScenario(p);if(s.readOnly)throw Error('基準案は直接編集できません。編集案へ切り替えてください');return s}
 private repairSelection(p:Project){if(p.view.selectedDeviceId&&!devices(activeScenario(p)).some(d=>d.id===p.view.selectedDeviceId))p.view.selectedDeviceId=null}
 setView(patch:Partial<View>){const p=clone(this.current);Object.assign(p.view,patch);this.repairSelection(p);validateProject(p);this.current=freeze(p);if(this.draft){const d=clone(this.draft);Object.assign(d.view,p.view);this.draft=freeze(d)}this.emit('view')}
 switchScenario(id:string){const p=clone(this.current);if(!p.scenarios.some(s=>s.id===id))throw Error('案が見つかりません');p.activeScenarioId=id;this.repairSelection(p);validateProject(p);this.draft=null;this.current=freeze(p);this.emit('view')}
 updateEnvironment(patch:Partial<Environment>){this.edit(p=>Object.assign(p.environment,patch))}
 updateRoof(patch:Partial<RoofSettings>){this.edit(p=>Object.assign(this.editable(p).roof,patch))}
 updateReferences(patch:Partial<ReferenceSettings>){this.edit(p=>Object.assign(p.references,patch))}
 updateFertility(patch:Partial<ReferenceSettings['fertility']>){this.edit(p=>Object.assign(p.references.fertility,patch))}
 setAllFans(enabled:boolean){this.edit(p=>this.editable(p).fans.forEach(f=>f.enabled=enabled))}
 copyActiveToOther(){this.edit(p=>{const source=this.editable(p),target=p.scenarios.find(s=>!s.readOnly&&s.id!==source.id)!;const next=clone(source);next.id=target.id;next.name=target.name;p.scenarios[p.scenarios.indexOf(target)]=next;p.activeScenarioId=target.id;this.repairSelection(p)})}
 updatePrices(patch:Partial<Project['prices']>){this.edit(p=>Object.assign(p.prices,patch))}
 updateTemplate(patch:Pick<Template,'lengthM'|'widthM'>){this.edit(p=>{Object.assign(p.template,patch);const layout=buildLayout(p.template);for(const s of p.scenarios)for(const d of devices(s))Object.assign(d,positionFromAnchor(d,p.template,layout))})}
 findDevice(id:string){return devices(activeScenario(this.project)).find(d=>d.id===id)}
 updateDevice(id:string,patch:Partial<Device>){this.edit(p=>{const d=devices(this.editable(p)).find(d=>d.id===id);if(!d)throw Error('設備が見つかりません');const immutable={id:d.id};Object.assign(d,patch,immutable);d.anchor=anchorPose(d,p.template)})}
 updateSystem(id:string,patch:Partial<Omit<WaterSystem,'id'|'kind'|'nozzles'>>){this.edit(p=>{const w=this.editable(p).waterSystems.find(w=>w.id===id);if(!w)throw Error('系統が見つかりません');Object.assign(w,patch)})}
 begin(){this.editable(this.current);if(!this.draft)this.draft=freeze(clone(this.current))}
 previewDevice(id:string,patch:Partial<Device>){if(!this.draft)this.begin();const p=clone(this.draft!),d=devices(this.editable(p)).find(d=>d.id===id);if(!d)throw Error('設備が見つかりません');Object.assign(d,patch,{id:d.id});d.anchor=anchorPose(d,p.template);validateProject(p);this.draft=freeze(p);this.emit('draft')}
 commit(){if(!this.draft)return;const p=clone(this.draft);this.draft=null;this.commitCandidate(p)}
 cancel(){if(!this.draft)return;this.draft=null;this.emit('view')}
 private restore(p:Project){const next=clone(p);next.activeScenarioId=this.current.activeScenarioId;next.view=clone(this.current.view);this.repairSelection(next);validateProject(next);this.current=freeze(next);this.emit('project')}
 undo(){this.cancel();const p=this.history.pop();if(!p)return;this.future.push(this.current);this.restore(p)}
 redo(){this.cancel();const p=this.future.pop();if(!p)return;this.history.push(this.current);this.restore(p)}
 duplicateDevice(id:string){let newId='';this.edit(p=>{const s=this.editable(p),d=devices(s).find(d=>d.id===id);if(!d)throw Error('設備が見つかりません');const n=clone(d);n.id=uuid();newId=n.id;n.label+=' コピー';n.x=Math.min(p.template.lengthM,n.x+1);n.anchor=anchorPose(n,p.template);if(isFan(n))s.fans.push(n);else s.waterSystems.find(w=>w.nozzles.some(x=>x.id===id))!.nozzles.push(n);p.view.selectedDeviceId=n.id});return newId}
 addFan(){let id='';this.edit(p=>{const s=this.editable(p),f=clone(createProject().scenarios[0].fans[0]);f.id=uuid();id=f.id;f.label=`追加ファン ${s.fans.length+1}`;f.x=p.template.lengthM/2;f.y=6;f.anchor=anchorPose(f,p.template);s.fans.push(f);p.view.selectedDeviceId=f.id});return id}
 addNozzle(kind:'soaker'|'mist'){let id='';this.edit(p=>{const s=this.editable(p),w=s.waterSystems.find(w=>w.kind===kind)!,n=clone(createProject().scenarios[0].waterSystems.find(w=>w.kind===kind)!.nozzles[0]);n.id=uuid();id=n.id;n.label=`${kind==='soaker'?'ソーカー':'ミスト'} ${w.nozzles.length+1}`;n.x=p.template.lengthM/2;n.y=5.75;n.anchor=anchorPose(n,p.template);w.nozzles.push(n);p.view.selectedDeviceId=n.id});return id}
 removeDevice(id:string){this.edit(p=>{const s=this.editable(p);s.fans=s.fans.filter(f=>f.id!==id);for(const w of s.waterSystems)w.nozzles=w.nozzles.filter(n=>n.id!==id);this.repairSelection(p)})}
 resetActive(){this.edit(p=>{const s=this.editable(p),b=clone(p.scenarios.find(s=>s.id===p.baselineScenarioId)!);b.id=s.id;b.name=s.name;b.readOnly=false;p.scenarios[p.scenarios.indexOf(s)]=b;this.repairSelection(p)})}
 compareWaterOnly(kind:'soaker'|'mist'){this.edit(p=>{const source=activeScenario(p),target=p.scenarios.find(s=>s.id===`working-${kind}`)!;target.fans=clone(source.fans);target.roof=clone(source.roof);target.waterSystems.forEach(w=>w.enabled=w.kind===kind);p.activeScenarioId=target.id;this.repairSelection(p)})}
 importJSON(text:string){const p=parseProject(text);this.cancel();this.commitCandidate(clone(p))}
 serialize(){validateProject(this.current);return JSON.stringify(this.current,null,2)}
}
