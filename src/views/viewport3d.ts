import type {Project,SimulationResult,Vec3} from '../domain/project.js';
import {activeScenario} from '../domain/project.js';
import type {SceneView,ViewCallbacks} from './common.js';
import {sceneGeometry} from './sceneGeometry.js';
import type {Batch} from './sceneGeometry.js';
import {ThreeBackend} from './threeBackend.js';
import {RealisticBackend} from './realistic3d.js';
import type {RenderBackend} from './common.js';
import {matrix,project,planeAt} from './math3d.js';
import type {Camera} from './math3d.js';
import {buildFaces} from '../template/faces.js';
import {buildLayout} from '../template/layout.js';
export class Viewport3D implements SceneView{
 private canvas:HTMLCanvasElement;private backend:RenderBackend;private p:Project|null=null;private result:SimulationResult|null=null;private batch:Batch|null=null;private observer:ResizeObserver;private abort=new AbortController();private camera:Camera={azimuth:-.28,elevation:.6,distance:42,target:[18.2,0,11.75]};
 private pointer:{x:number;y:number;lastX:number;lastY:number;id:number;deviceId:string|null;height:number;offset:Vec3;started:boolean;pan:boolean;startCamera:Camera}|null=null;
 get rendererName(){return this.backend.name}
 diagnostics(){return this.backend.diagnostics?.()??{}}
 constructor(private container:HTMLElement,private cb:ViewCallbacks,backendFactory?:(c:HTMLCanvasElement)=>RenderBackend,realistic=false){
  this.canvas=document.createElement('canvas');this.canvas.className='scene-canvas';this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','牛舎3D。設備をドラッグして移動、背景をドラッグして回転');this.canvas.dataset.testid='scene3d';container.append(this.canvas);
  try{this.backend=backendFactory?backendFactory(this.canvas):realistic?new RealisticBackend(this.canvas):new ThreeBackend(this.canvas)}catch(err){this.canvas.remove();throw err}
  const opts={signal:this.abort.signal};this.canvas.addEventListener('pointerdown',this.down,opts);this.canvas.addEventListener('pointermove',this.move,opts);this.canvas.addEventListener('pointerup',this.up,opts);this.canvas.addEventListener('pointercancel',this.cancel,opts);this.canvas.addEventListener('contextmenu',e=>e.preventDefault(),opts);this.canvas.addEventListener('wheel',this.wheel,{...opts,passive:false});this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.cb.error('3D描画が停止しました。2D表示に切り替えます。')},opts);window.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel()},opts);window.addEventListener('blur',this.cancel,opts);
  this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(container);
 }
 private size(){return {w:Math.max(1,this.container.clientWidth),h:Math.max(1,this.container.clientHeight)}}
 private local(e:PointerEvent|WheelEvent){const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}}
 private draw(){const {w,h}=this.size();this.backend.draw(matrix(this.camera,w/h),w,h,this.camera)}
 sync(p:Project,r:SimulationResult|null){if(!this.pointer&&p.view.camera&&JSON.stringify(this.p?.view.camera)!==JSON.stringify(p.view.camera))this.camera=structuredClone(p.view.camera);const initial=!this.p,dimensionsChanged=this.p&&JSON.stringify(this.p.template)!==JSON.stringify(p.template);this.p=p;this.result=r;if(initial){this.camera=p.view.camera?structuredClone(p.view.camera):{azimuth:-.28,elevation:.6,distance:42*Math.max(1,1.7/(this.size().w/this.size().h)),target:[p.template.lengthM/2,0,p.template.widthM/2]}}else if(dimensionsChanged)this.camera.target=[p.template.lengthM/2,0,p.template.widthM/2];this.batch=sceneGeometry(p,r);this.backend.update(this.batch,p,r);this.draw()}
 screenPoint(v:Vec3){const {w,h}=this.size(),pt=project(v,matrix(this.camera,w/h),w,h),r=this.canvas.getBoundingClientRect();return {...pt,x:pt.x+r.left,y:pt.y+r.top}}
 private down=(e:PointerEvent)=>{
  if(!this.p||!this.batch||e.button>2)return;e.preventDefault();this.canvas.focus();const {x,y}=this.local(e),{w,h}=this.size(),m=matrix(this.camera,w/h);
  const hits=this.batch.hits.map(hit=>({...hit,screen:project(hit.position,m,w,h)})).filter(hit=>hit.screen.visible&&Math.hypot(hit.screen.x-x,hit.screen.y-y)<(hit.kind==='device'?16:10)).sort((a,b)=>{const delta=Math.hypot(a.screen.x-x,a.screen.y-y)-Math.hypot(b.screen.x-x,b.screen.y-y);return Math.abs(delta)<1?(b.priority??0)-(a.priority??0)||delta:delta});
  const hit=e.button===0&&!e.shiftKey?hits[0]:null;
  if(hit?.kind==='probe'){this.cb.selectProbe(hit.id);return}
  // Face selection: clicking a colored area face selects its representative probe.
  // Faces render at their own elevation (FaceRect.surfaceY), so intersect the click ray
  // with each elevation — projecting onto y=0 lands in a neighbouring face in oblique views.
  if(e.button===0&&!e.shiftKey&&!hit){
   const faces=buildFaces(buildLayout(this.p.template));
   for(const fy of [...new Set(faces.map(f=>f.surfaceY))].sort((a,b)=>b-a)){
    const q=planeAt(x,y,w,h,this.camera,fy);if(!q)continue;
    const face=faces.find(f=>f.surfaceY===fy&&q[0]>=f.x&&q[0]<=f.x+f.widthM&&q[2]>=f.y&&q[2]<=f.y+f.depthM);
    if(face){this.cb.selectProbe(face.probeId);return}
   }
  }
  let deviceId:string|null=null,height=0,offset:Vec3=[0,0,0];
  if(hit?.kind==='device'){this.cb.selectDevice(hit.id);if(!activeScenario(this.p).readOnly){deviceId=hit.id;height=hit.position[1];const q=planeAt(x,y,w,h,this.camera,height);if(q)offset=[hit.position[0]-q[0],0,hit.position[2]-q[2]]}}
  this.pointer={x,y,lastX:x,lastY:y,id:e.pointerId,deviceId,height,offset,started:false,pan:e.shiftKey||e.button===2,startCamera:structuredClone(this.camera)};this.canvas.setPointerCapture(e.pointerId);
 };
 private move=(e:PointerEvent)=>{
  const a=this.pointer;if(!a||!this.p)return;const {x,y}=this.local(e),{w,h}=this.size();if(!a.started&&Math.hypot(x-a.x,y-a.y)<3)return;
  try{
   if(a.deviceId){if(!a.started)this.cb.begin();const q=planeAt(x,y,w,h,this.camera,a.height);if(q)this.cb.preview(a.deviceId,{x:Math.max(0,Math.min(this.p.template.lengthM,q[0]+a.offset[0])),y:Math.max(0,Math.min(this.p.template.widthM,q[2]+a.offset[2]))})}
   else if(a.pan){const old=planeAt(a.lastX,a.lastY,w,h,this.camera,0),now=planeAt(x,y,w,h,this.camera,0);if(old&&now){this.camera.target[0]=Math.max(-50,Math.min(100,this.camera.target[0]+old[0]-now[0]));this.camera.target[2]=Math.max(-50,Math.min(100,this.camera.target[2]+old[2]-now[2]))}this.draw()}
   else{this.camera.azimuth-=(x-a.lastX)*.007;this.camera.elevation=Math.max(.14,Math.min(1.55,this.camera.elevation+(y-a.lastY)*.006));this.draw()}
   a.started=true;a.lastX=x;a.lastY=y;
  }catch(err){this.cb.error(err instanceof Error?err.message:String(err));this.cancel()}
 };
 private up=()=>{const a=this.pointer;this.pointer=null;if(!a)return;if(a.started&&a.deviceId)this.cb.commit();else if(a.started)this.cb.camera(structuredClone(this.camera));if(this.canvas.hasPointerCapture(a.id))this.canvas.releasePointerCapture(a.id)};
 private cancel=()=>{const a=this.pointer;this.pointer=null;if(!a)return;if(a.deviceId&&a.started)this.cb.cancel();else{this.camera=a.startCamera;this.draw()}if(this.canvas.hasPointerCapture(a.id))this.canvas.releasePointerCapture(a.id)};
 private wheel=(e:WheelEvent)=>{e.preventDefault();this.camera.distance=Math.max(8,Math.min(160,this.camera.distance*Math.exp(e.deltaY*.001)));this.draw();this.cb.camera(structuredClone(this.camera))};
 preset(name:'overview'|'top'|'side'){this.camera={azimuth:name==='side'?Math.PI/2:-.28,elevation:name==='top'?1.55:name==='side'?.2:.6,distance:(name==='top'?48:42)*Math.max(1,1.7/(this.size().w/this.size().h)),target:[this.p!.template.lengthM/2,0,this.p!.template.widthM/2]};this.draw();this.cb.camera(structuredClone(this.camera))}
 dispose(){this.abort.abort();this.observer.disconnect();this.backend.dispose();this.canvas.remove()}
}
