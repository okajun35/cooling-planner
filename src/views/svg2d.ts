import type {Project,SimulationResult} from '../domain/project.js';
import {activeScenario} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {buildFaces,buildAreas} from '../template/faces.js';
import {deficitUnreached} from '../model/areaStats.js';
import type {SceneView,ViewCallbacks} from './common.js';
import {escapeHtml as esc,zoneColor,metricColor,metricValue} from './common.js';
export class SVG2D implements SceneView{
 readonly rendererName='SVG 2D';private svg:SVGSVGElement;private p:Project|null=null;private r:SimulationResult|null=null;private abort=new AbortController();private drag:{id:string;startX:number;startY:number;offsetX:number;offsetY:number;pointerId:number;started:boolean}|null=null;
 constructor(container:HTMLElement,private cb:ViewCallbacks){
  this.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');this.svg.setAttribute('role','img');this.svg.setAttribute('aria-label','牛舎2D配置図。設備を選択してドラッグ');this.svg.classList.add('scene-svg');this.svg.dataset.testid='scene2d';container.append(this.svg);const opts={signal:this.abort.signal};this.svg.addEventListener('pointerdown',this.down,opts);this.svg.addEventListener('pointermove',this.move,opts);this.svg.addEventListener('pointerup',this.up,opts);this.svg.addEventListener('pointercancel',this.cancel,opts);this.svg.addEventListener('keydown',e=>{const id=(e.target as Element).closest('[data-device]')?.getAttribute('data-device'),probe=(e.target as Element).closest('[data-probe]')?.getAttribute('data-probe');if(e.key==='Enter'){if(id)this.cb.selectDevice(id);else if(probe)this.cb.selectProbe(probe)}},opts);window.addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel()},opts);
 }
 private xy(e:PointerEvent){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(this.svg.getScreenCTM()!.inverse());return {x:p.x,y:p.y}}
 sync(p:Project,r:SimulationResult|null){
  this.p=p;this.r=r;const l=buildLayout(p.template),s=activeScenario(p),out=r?.scenarios.find(x=>x.id===s.id),L=p.template.lengthM,W=p.template.widthM;
  this.svg.setAttribute('viewBox',`-1 -1 ${L+2} ${W+2}`);
  let html=`<rect x="-.5" y="-.5" width="${L+1}" height="${W+1}" rx=".3" fill="#c6d5cc"/><rect width="${L}" height="${W}" fill="#eef1e9"/>`;
  html+=`<defs><pattern id="invalid-hatch" width=".35" height=".35" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width=".35" height=".35" fill="#cdd4de"/><line x1="0" y1="0" x2="0" y2=".35" stroke="#97a4b3" stroke-width=".1"/></pattern></defs>`;
  for(const z of l.zones)html+=`<g><rect x="${z.x}" y="${z.y}" width="${z.widthM}" height="${z.depthM}" fill="${zoneColor[z.kind]}" stroke="#ffffff" stroke-width=".05"/><text x="${z.x+.4}" y="${z.y+.7}" font-size=".48" fill="#668075">${esc(z.name)}</text></g>`;
  // Area faces (v0.1): each face shows its single representative probe's value.
  const selectedArea=p.view.selectedAreaId?buildAreas(l).find(a=>a.id===p.view.selectedAreaId)??null:null;
  for(const f of buildFaces(l)){
    const q=out?.points.find(v=>v.probeId===f.probeId),valid=!!q&&q.status==='valid';
    const fill=!q?'#cdd4de':valid?metricColor(metricValue(q,p.view.metric),p.view.metric):'url(#invalid-hatch)';
    const unreached=q?deficitUnreached(q):false,inArea=!!selectedArea&&selectedArea.probeIds.includes(f.probeId);
    const over=p.view.metric==='deficit'&&q?.meanDeficitW!=null&&q.meanDeficitW>1200;
    html+=`<rect data-face="${esc(f.id)}" data-probe="${esc(f.probeId)}" x="${f.x+.02}" y="${f.y+.02}" width="${f.widthM-.04}" height="${f.depthM-.04}" rx=".06" fill="${fill}" stroke="${unreached?'#c2512b':inArea?'#dc9144':'#ffffff'}" stroke-width="${unreached||inArea?'.09':'.04'}"${unreached?' stroke-dasharray=".16 .1"':''}/>`;
    if(!valid&&q)html+=`<line data-probe="${esc(f.probeId)}" x1="${f.x+.08}" y1="${f.y+.08}" x2="${f.x+f.widthM-.08}" y2="${f.y+f.depthM-.08}" stroke="#97a4b3" stroke-width=".06" pointer-events="none"/>`;
    if(over)html+=`<text x="${f.x+f.widthM-.12}" y="${f.y+.32}" font-size=".3" fill="#8a3d12" text-anchor="end" pointer-events="none">!</text>`;
  }
  for(const q of l.probes){const value=out?.points.find(v=>v.probeId===q.id),val=metricValue(value,p.view.metric);html+=`<g data-probe="${esc(q.id)}" tabindex="0" role="button" aria-label="${esc(q.label)}"><circle cx="${q.x}" cy="${q.y}" r=".4" fill="${metricColor(val,p.view.metric)}" stroke="${p.view.selectedProbeId===q.id?'#da973f':'#ffffff'}" stroke-width="${p.view.selectedProbeId===q.id?'.16':'.06'}"/><circle cx="${q.x}" cy="${q.y}" r=".65" fill="transparent"/></g>`}
  for(const f of s.fans){const a=f.yawDeg*Math.PI/180;html+=`<g data-device="${esc(f.id)}" tabindex="0" role="button" aria-label="${esc(f.label)}"><path d="M${f.x} ${f.y}l${Math.cos(a)*2} ${Math.sin(a)*2}" stroke="#75a590" stroke-width=".13"/><circle cx="${f.x}" cy="${f.y}" r=".55" fill="${f.enabled?'#315e4f':'#b4c5ba'}" stroke="${p.view.selectedDeviceId===f.id?'#dc9844':'white'}" stroke-width=".14"/><path d="M${f.x-.3} ${f.y-.3}l.6 .6m0 -.6l-.6 .6" stroke="white" stroke-width=".11"/><circle cx="${f.x}" cy="${f.y}" r=".7" fill="transparent"/></g>`}
  // Offset only the marker glyph by +/- .18m so colocated water systems remain selectable.
  for(const w of s.waterSystems)for(const n of w.nozzles){const dy=w.kind==='mist'?.18:-.18,color=w.enabled&&n.enabled?(w.kind==='mist'?'#9980b5':'#458da8'):'#b8c6be';html+=`<g data-device="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(n.label)}"><circle cx="${n.x}" cy="${n.y+dy}" r=".22" fill="${color}" stroke="${p.view.selectedDeviceId===n.id?'#d38a32':'white'}" stroke-width=".09"/><circle cx="${n.x}" cy="${n.y+dy}" r=".3" fill="transparent"/></g>`}
  this.svg.innerHTML=html;
 }
 private down=(e:PointerEvent)=>{if(!this.p||e.button!==0)return;const target=e.target as Element,id=target.closest('[data-device]')?.getAttribute('data-device'),probe=target.closest('[data-probe]')?.getAttribute('data-probe');if(probe){this.cb.selectProbe(probe);return}if(!id)return;e.preventDefault();this.cb.selectDevice(id);if(activeScenario(this.p).readOnly)return;const d=[...activeScenario(this.p).fans,...activeScenario(this.p).waterSystems.flatMap(w=>w.nozzles)].find(d=>d.id===id)!,q=this.xy(e);this.drag={id,startX:e.clientX,startY:e.clientY,offsetX:d.x-q.x,offsetY:d.y-q.y,pointerId:e.pointerId,started:false};this.svg.setPointerCapture(e.pointerId)};
 private move=(e:PointerEvent)=>{const d=this.drag;if(!d||!this.p)return;if(!d.started&&Math.hypot(e.clientX-d.startX,e.clientY-d.startY)<3)return;try{if(!d.started)this.cb.begin();d.started=true;const q=this.xy(e);this.cb.preview(d.id,{x:Math.max(0,Math.min(this.p.template.lengthM,q.x+d.offsetX)),y:Math.max(0,Math.min(this.p.template.widthM,q.y+d.offsetY))})}catch(err){this.cb.error(String(err));this.cancel()}};
 private up=()=>{const d=this.drag;this.drag=null;if(d?.started)this.cb.commit();if(d&&this.svg.hasPointerCapture(d.pointerId))this.svg.releasePointerCapture(d.pointerId)};
 private cancel=()=>{const d=this.drag;this.drag=null;if(d?.started)this.cb.cancel();if(d&&this.svg.hasPointerCapture(d.pointerId))this.svg.releasePointerCapture(d.pointerId)};
 dispose(){this.abort.abort();this.svg.remove()}
}
