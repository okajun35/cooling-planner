import type {Project,SimulationResult,Device,Vec3,View,PointResult} from '../domain/project.js';
import type {Batch} from './sceneGeometry.js';
import type {Mat4} from './math3d.js';
export interface RenderBackend{readonly name:string;update:(b:Batch,p?:Project,r?:SimulationResult|null)=>void;draw:(m:Mat4,w:number,h:number,camera?:NonNullable<View['camera']>)=>void;dispose:()=>void;diagnostics?:()=>Record<string,unknown>}
export interface ViewCallbacks {selectDevice:(id:string|null)=>void;selectProbe:(id:string)=>void;begin:()=>void;preview:(id:string,patch:Partial<Device>)=>void;commit:()=>void;cancel:()=>void;camera:(c:View['camera'])=>void;error:(message:string)=>void}
export interface SceneView {sync:(p:Project,r:SimulationResult|null)=>void;dispose:()=>void;preset?:(name:'overview'|'top'|'side')=>void;screenPoint?:(v:Vec3)=>{x:number;y:number;visible:boolean};readonly rendererName:string;diagnostics?:()=>Record<string,unknown>}
export const escapeHtml=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const zoneColor:Record<string,string>={feed:'#ddd6c1',feeding:'#e6eee8',stall:'#d8e3ee',aisle:'#ecf0f5',robot:'#8cbed3',utility:'#b9c7d5',waiting:'#e1e9f1',isolation:'#d2dce9'};
/** Metric shown on faces/probes. 'deficit' = per-second mean of max(0, Qref − Q) [W]. */
export const metricValue=(q:PointResult|undefined|null,metric:View['metric'])=>!q||q.status!=='valid'?null:metric==='speed'?q.meanSpeedMps:metric==='temperature'?q.meanAirTemperatureC:metric==='deficit'?q.meanDeficitW:q.deltaQrefW;
export function metricColor(value:number|null,metric:'delta'|'deficit'|'speed'|'temperature'){
 if(value===null)return '#cdd4de';
 const interpolate=(a:number[],b:number[],t:number)=>'#'+a.map((v,i)=>Math.round(v+(b[i]-v)*Math.max(0,Math.min(1,t))).toString(16).padStart(2,'0')).join('');
 if(metric==='temperature')return interpolate([64,169,224],[238,98,65],(value-25)/15);
 if(metric==='speed')return interpolate([226,231,240],[39,115,216],value/3);
 // Fixed legend 0..1200 W; values beyond clamp to the endpoint (AV14).
 if(metric==='deficit')return interpolate([233,238,241],[222,99,32],value/1200);
 return value>=0?interpolate([221,229,239],[12,153,138],value/900):interpolate([221,229,239],[232,111,68],-value/900);
}
