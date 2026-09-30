import type {Project,SimulationResult,Vec3} from '../domain/project.js';
import {activeScenario} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {buildFaces,buildAreas} from '../template/faces.js';
import {deficitUnreached} from '../model/areaStats.js';
import {world,direction,normalize,cross,sprayDirections,rayAtHeight,windAt} from '../model/geometry.js';
import {isOn} from '../model/physics.js';
import {zoneColor,metricColor,metricValue} from './common.js';
export interface Batch {triangles:Float32Array;lines:Float32Array;hits:{id:string;kind:'device'|'probe';position:Vec3;priority?:number}[]}
const rgb=(s:string):Vec3=>[parseInt(s.slice(1,3),16)/255,parseInt(s.slice(3,5),16)/255,parseInt(s.slice(5,7),16)/255];
export function sceneGeometry(p:Project,result:SimulationResult|null):Batch{
 const tri:number[]=[],lines:number[]=[],hits:Batch['hits']=[],layout=buildLayout(p.template),scenario=activeScenario(p),out=result?.scenarios.find(s=>s.id===scenario.id),L=p.template.lengthM,W=p.template.widthM;
 const vertex=(arr:number[],v:Vec3,col:Vec3)=>arr.push(...v,...col);
 const triangle=(a:Vec3,b:Vec3,c:Vec3,color:string,shade=1)=>{const col=rgb(color).map(v=>v*shade) as Vec3;vertex(tri,a,col);vertex(tri,b,col);vertex(tri,c,col)};
 const segment=(a:Vec3,b:Vec3,color:string)=>{const col=rgb(color);vertex(lines,a,col);vertex(lines,b,col)};
 const quad=(a:Vec3,b:Vec3,c:Vec3,d:Vec3,color:string,shade=1)=>{triangle(a,b,c,color,shade);triangle(a,c,d,color,shade)};
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,color:string)=>{
  const a:Vec3=[x,y,z],b:Vec3=[x+w,y,z],c:Vec3=[x+w,y,z+d],e:Vec3=[x,y,z+d],A:Vec3=[x,y+h,z],B:Vec3=[x+w,y+h,z],C:Vec3=[x+w,y+h,z+d],E:Vec3=[x,y+h,z+d];
  quad(A,B,C,E,color);quad(a,b,B,A,color,.78);quad(b,c,C,B,color,.88);quad(c,e,E,C,color,.9);quad(e,a,A,E,color,.76);
 };
 const ring=(center:Vec3,u:Vec3,v:Vec3,r:number,color:string)=>{for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;segment(center.map((n,k)=>n+r*(u[k]*Math.cos(a)+v[k]*Math.sin(a))) as Vec3,center.map((n,k)=>n+r*(u[k]*Math.cos(b)+v[k]*Math.sin(b))) as Vec3,color)}};
 const disk=(c:Vec3,r:number,color:string)=>{for(let i=0;i<20;i++){const a=i*Math.PI/10,b=(i+1)*Math.PI/10;triangle(c,[c[0]+Math.cos(a)*r,c[1],c[2]+Math.sin(a)*r],[c[0]+Math.cos(b)*r,c[1],c[2]+Math.sin(b)*r],color)}};
 box(-.45,-.28,-.45,L+.9,.24,W+.9,'#c6d5cc');box(0,-.04,0,L,.05,W,'#eef1e9');
 for(const z of layout.zones){box(z.x,.01,z.y,z.widthM,.015,z.depthM,zoneColor[z.kind]);if(z.solid)box(z.x,.03,z.y,z.widthM,2.2,z.depthM,'#b4c4c9')}
 for(let x=0;x<=L;x+=2)segment([x,.039,0],[x,.039,W],'#d5dfd7');for(let y=0;y<=W;y+=2)segment([0,.039,y],[L,.039,y],'#d5dfd7');
 for(const cell of layout.stalls){
  const x=cell.x,y=cell.y;box(x+.07,.03,y+.1,cell.widthM-.14,.12,cell.depthM-.2,'#edf1e9');
  for(const dx of [0,cell.widthM]){segment([x+dx,.25,y+.05],[x+dx,.65,y+.4],'#a4b5ac');segment([x+dx,.65,y+.4],[x+dx,.65,y+2.1],'#a4b5ac');segment([x+dx,.65,y+2.1],[x+dx,.2,y+2.4],'#a4b5ac')}
  // Simple resting-cow silhouettes are presentation only, never flow obstacles.
  if(!p.view.analysis){box(x+.29,.16,y+.64,.62,.42,1.30,'#fcfcf7');box(x+.42,.58,y+1.05,.36,.025,.45,'#778b80');box(x+.35,.33,y+.35,.5,.34,.43,'#455d51')}
 }
 const robot=layout.zones.find(z=>z.kind==='robot')!;box(robot.x+.4,.05,robot.y+.4,2.2,1.5,1.9,'#62938c');box(robot.x+.8,1.56,robot.y+.55,1.4,.3,1.5,'#d8e4db');
 if(p.view.roof&&!p.view.analysis){const roofColor=scenario.roof.reflectance>.5?'#f6f8fc':'#b9c2d0';quad([0,4,0],[L,4,0],[L,8.7,W/2],[0,8.7,W/2],roofColor);if(scenario.roof.insulationM>0)segment([0,8.57,W/2],[L,8.57,W/2],'#e8ae54');for(let x=0;x<=L+.1;x+=L/6){segment([x,0,0],[x,4,0],'#9bafa4');segment([x,0,W],[x,4,W],'#9bafa4');segment([x,4,0],[x,8.7,W/2],'#acbeb1');segment([x,8.7,W/2],[x,4,W],'#acbeb1')}for(const [h,z]of [[4,0],[4,W],[8.7,W/2]])segment([0,h,z],[L,h,z],'#a3b8ab')}
 // Area faces (v0.1): flat quads at floor level, one per representative probe.
 const selectedArea=p.view.selectedAreaId?buildAreas(layout).find(a=>a.id===p.view.selectedAreaId)??null:null;
 for(const f of buildFaces(layout)){
  const q=out?.points.find(r=>r.probeId===f.probeId),valid=!!q&&q.status==='valid';
  const color=!q?'#cdd4de':valid?metricColor(metricValue(q,p.view.metric),p.view.metric):'#cdd4de';
  const fy=f.surfaceY;// stall faces sit just above the stall base block
  quad([f.x+.03,fy,f.y+.03],[f.x+f.widthM-.03,fy,f.y+.03],[f.x+f.widthM-.03,fy,f.y+f.depthM-.03],[f.x+.03,fy,f.y+f.depthM-.03],color);
  if(q&&!valid)segment([f.x+.08,fy+.006,f.y+.08],[f.x+f.widthM-.08,fy+.006,f.y+f.depthM-.08],'#8d99a8');
  if(q&&deficitUnreached(q)){
   segment([f.x+.08,fy+.006,f.y+.08],[f.x+f.widthM-.08,fy+.006,f.y+f.depthM-.08],'#c2512b');
   ring([f.x+f.widthM/2,fy+.008,f.y+f.depthM/2],[1,0,0],[0,0,1],Math.min(f.widthM,f.depthM)*.28,'#c2512b');
  }
  if(selectedArea?.probeIds.includes(f.probeId)){
   segment([f.x+.04,fy+.008,f.y+.04],[f.x+f.widthM-.04,fy+.008,f.y+.04],'#dc9144');segment([f.x+f.widthM-.04,fy+.008,f.y+.04],[f.x+f.widthM-.04,fy+.008,f.y+f.depthM-.04],'#dc9144');
   segment([f.x+f.widthM-.04,fy+.008,f.y+f.depthM-.04],[f.x+.04,fy+.008,f.y+f.depthM-.04],'#dc9144');segment([f.x+.04,fy+.008,f.y+f.depthM-.04],[f.x+.04,fy+.008,f.y+.04],'#dc9144');
  }
 }
 const profile=p.model.profiles.find(x=>x.id==='reference')!;
 for(const q of layout.probes){
  const value=out?.points.find(r=>r.probeId===q.id),selected=q.id===p.view.selectedProbeId,center:Vec3=[q.x,q.heightM+.1,q.y],color=metricColor(metricValue(value,p.view.metric),p.view.metric);
  disk(center,selected?.46:.28,color);if(selected){ring([q.x,q.heightM+.12,q.y],[1,0,0],[0,0,1],.58,'#dc9144');segment([q.x,.1,q.y],[q.x,q.heightM+.1,q.y],'#ce934f')}hits.push({id:q.id,kind:'probe',position:center});
  if(p.view.flow){const v=windAt(scenario.fans,world(q),p.environment,p.model,profile,layout.solids),f=scenario.fans.find(f=>f.id===v.dominant);if(f&&v.speed>.35){const d=direction(f.yawDeg,f.pitchDownDeg),len=Math.min(2.6,v.speed),start:Vec3=[q.x,.25,q.y],end:Vec3=[q.x+d[0]*len,.25,q.y+d[2]*len];segment(start,end,'#238abf');segment(end,[end[0]-d[0]*.3-d[2]*.16,.25,end[2]-d[2]*.3+d[0]*.16],'#238abf');segment(end,[end[0]-d[0]*.3+d[2]*.16,.25,end[2]-d[2]*.3-d[0]*.16],'#238abf')}}
 }
 for(const f of scenario.fans){
  const c=world(f),d=direction(f.yawDeg,f.pitchDownDeg),u=normalize(cross(d,Math.abs(d[1])>.9?[1,0,0]:[0,1,0])),v=cross(d,u),color=f.enabled?'#244e45':'#a9b6ad',r=f.diameterM/2;
  const at=(a:number,rad:number,offset=0):Vec3=>c.map((n,i)=>n+rad*(Math.cos(a)*u[i]+Math.sin(a)*v[i])+offset*d[i]) as Vec3;
  for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;quad(at(a,r,-.14),at(b,r,-.14),at(b,r,.14),at(a,r,.14),color);quad(at(a,r),at(b,r),at(b,r*.78),at(a,r*.78),color)}
  for(let i=0;i<4;i++){const a=i*Math.PI/2+(f.enabled?p.view.timeSec*.12:0);triangle(c,at(a,r*.7),at(a+.55,r*.6),'#6f9c83')}
  box(f.x-.1,f.heightM-.1,f.y-.1,.2,.2,.2,'#315d50');segment([f.x,.08,f.y],c,'#a2b5a8');hits.push({id:f.id,kind:'device',position:c});
  if(p.view.selectedDeviceId===f.id){ring(c,u,v,r+.23,'#d48b37');const tip=c.map((n,i)=>n+d[i]*3) as Vec3;segment(c,tip,'#d48b37')}
 }
 for(const w of [...scenario.waterSystems].sort((a,b)=>Number(a.enabled)-Number(b.enabled)))for(const n of w.nozzles){
  const c=world(n),enabled=w.enabled&&n.enabled,color=enabled?(w.kind==='mist'?'#8b76ab':'#428ba4'):'#b9c4bc';
  box(n.x-.12,n.heightM-.1,n.y-.12,.24,.2,.24,color);segment([n.x,4,n.y],c,'#becdc2');hits.push({id:n.id,kind:'device',position:c,priority:p.view.selectedDeviceId===n.id?3:enabled?2:1});
  if(p.view.selectedDeviceId===n.id){ring(c,[1,0,0],[0,0,1],.45,'#d48b37');segment(c,[n.x,.15,n.y],'#d48b37')}
  if(p.view.particles&&enabled&&n.flowLpm>0&&isOn(Math.min(p.view.timeSec,3599),w.onSec,w.offSec,w.hoursPerDay)){const rays=sprayDirections(n,16);for(let i=0;i<rays.length;i+=2){const hit=rayAtHeight(c,rays[i],.15);if(hit&&hit[0]>=0&&hit[0]<=L&&hit[2]>=0&&hit[2]<=W){segment(c,hit,w.kind==='mist'?'#c8c0e0':'#8dc6e4');const f=((p.view.timeSec*.37+i*.19)%1),pos=c.map((v,k)=>v+(hit[k]-v)*f) as Vec3;box(pos[0]-.04,pos[1],pos[2]-.04,.08,.15,.08,w.kind==='mist'?'#918bd3':'#289bdb')}}}
 }
 return {triangles:new Float32Array(tri),lines:new Float32Array(lines),hits};
}
