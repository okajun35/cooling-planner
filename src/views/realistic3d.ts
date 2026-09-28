import * as THREE from 'three';
import type {Project,SimulationResult,Vec3} from '../domain/project.js';
import {activeScenario} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {buildFaces,buildAreas} from '../template/faces.js';
import {world,direction,sprayDirections,rayAtHeight,fanContribution,segmentHitsBox} from '../model/geometry.js';
import {isOn} from '../model/physics.js';
import {metricColor,metricValue} from './common.js';
import type {RenderBackend} from './common.js';
import type {Batch} from './sceneGeometry.js';
import {eyeOf} from './math3d.js';
import {holsteinBody} from './holstein.js';
import type {Camera,Mat4} from './math3d.js';

const V=(v:Vec3)=>new THREE.Vector3(...v);
const UP=new THREE.Vector3(0,1,0);
const seed=(n:number)=>{const s=Math.sin(n*127.1+311.7)*43758.5453;return s-Math.floor(s)};

/** Small authored kit: one draw call for all copies of each shape/material pair. */
class Kit{
 private batches=new Map<string,{g:THREE.BufferGeometry;m:THREE.Material;matrices:THREE.Matrix4[]}>();
 add(g:THREE.BufferGeometry,m:THREE.Material,pos:Vec3,scale:Vec3,q=new THREE.Quaternion()){
  const key=g.uuid+m.uuid;let b=this.batches.get(key);if(!b){b={g,m,matrices:[]};this.batches.set(key,b)}
  b.matrices.push(new THREE.Matrix4().compose(V(pos),q,V(scale)));
 }
 finish(root:THREE.Group){for(const b of this.batches.values()){
  const mesh=new THREE.InstancedMesh(b.g,b.m,b.matrices.length);
  b.matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();root.add(mesh);
 }}
}
type Trail={a:THREE.Vector3;b:THREE.Vector3;speed:number;phase:number};

/** Presentation-only PBR scene. All numerical simulation stays in the existing Worker. */
export class RealisticBackend implements RenderBackend{
 readonly name='Three.js r180 · realistic';
 private renderer:THREE.WebGLRenderer;private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera(42,1,.1,400);
 private building=new THREE.Group();private equipment=new THREE.Group();private overlay=new THREE.Group();
 private sun=new THREE.DirectionalLight(0xfff0d5,3.1);private sunTarget=new THREE.Object3D();
 private env:THREE.WebGLRenderTarget;private textures:THREE.Texture[]=[];
 private box=new THREE.BoxGeometry(1,1,1);private sphere=new THREE.SphereGeometry(1,12,8);
 private cowBody=holsteinBody();
 private cylinder=new THREE.CylinderGeometry(1,1,1,12);private ring=new THREE.TorusGeometry(1,.04,6,36);
 private materials:Record<string,THREE.MeshStandardMaterial>;
 private lineMat=new THREE.LineBasicMaterial({color:0x328db1,transparent:true,opacity:.68,depthWrite:false,toneMapped:false});
 private dropMat=new THREE.LineBasicMaterial({color:0xadddf4,transparent:true,opacity:.85,depthWrite:false,toneMapped:false});
 private mistMat:THREE.PointsMaterial;
 private wind=new THREE.LineSegments(new THREE.BufferGeometry(),this.lineMat);
 private drops=new THREE.LineSegments(new THREE.BufferGeometry(),this.dropMat);
 private mist:THREE.Points;
 private winds:Trail[]=[];private waters:Trail[]=[];private fogs:Trail[]=[];
 private cowPoses={standing:0,lying:0,feeding:0};
 private buildingKey='';private equipmentKey='';private overlayKey='';private effectKey='';
 private p:Project|null=null;private frame=0;private lastFrame=0;private disposed=false;
 private reduced=matchMedia('(prefers-reduced-motion: reduce)');private clockStart=performance.now();
 private frameMs=0;private width=1;private height=1;
 constructor(canvas:HTMLCanvasElement){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
  this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
  this.scene.background=new THREE.Color(0xd8e3e7);this.scene.fog=new THREE.Fog(0xd8e3e7,105,235);
  this.scene.add(new THREE.HemisphereLight(0xdceeff,0x93816a,2.1),this.sun,this.sunTarget,this.building,this.equipment,this.overlay,this.wind,this.drops);
  this.sun.target=this.sunTarget;this.sun.castShadow=true;const shadowSize=innerWidth<600?1024:2048;this.sun.shadow.mapSize.set(shadowSize,shadowSize);
  this.sun.shadow.bias=-.00015;this.sun.shadow.normalBias=.045;
  // Procedural environment is baked once; no HDR downloads or addon bundler needed.
  const envScene=new THREE.Scene();envScene.background=new THREE.Color(0xc3d5df);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshBasicMaterial({color:0x858777,side:THREE.DoubleSide}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-4;envScene.add(ground);
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(25,25),new THREE.MeshBasicMaterial({color:new THREE.Color(3,2.7,2.2),side:THREE.DoubleSide}));
  panel.position.set(-20,35,10);panel.lookAt(0,0,0);envScene.add(panel);
  const pmrem=new THREE.PMREMGenerator(this.renderer);this.env=pmrem.fromScene(envScene,.08);this.scene.environment=this.env.texture;this.scene.environmentIntensity=.5;
  pmrem.dispose();ground.geometry.dispose();ground.material.dispose();panel.geometry.dispose();panel.material.dispose();
  const concrete=this.texture('concrete'),sand=this.texture('sand'),hide=this.texture('hide');
  const mat=(color:number,roughness:number,metalness=0,map?:THREE.Texture)=>new THREE.MeshStandardMaterial({color,roughness,metalness,map});
  this.materials={concrete:mat(0xbdb9af,.92,0,concrete),sand:mat(0xc2af88,1,0,sand),grass:mat(0x7e8763,1,0,sand),
   steel:mat(0x9ba8ac,.36,.78),darkSteel:mat(0x3a4648,.5,.65),roof:mat(0xa1adb3,.48,.65),rubber:mat(0x313331,.92),
   hide:mat(0xf2eee0,.92,0,hide),hide2:mat(0xf2eee0,.92,0,this.texture('hide',1)),hide3:mat(0xf2eee0,.92,0,this.texture('hide',2)),black:mat(0x252724,.95),nose:mat(0xb8a095,.93),white:mat(0xefede6,.6),
   brass:mat(0xb58b49,.38,.75),blue:mat(0x266c80,.5,.25),purple:mat(0x7a648d,.5,.25),feed:mat(0x867647,1,0,sand)};
  const sprite=document.createElement('canvas');sprite.width=sprite.height=32;const ctx=sprite.getContext('2d')!;
  const grad=ctx.createRadialGradient(16,16,0,16,16,16);grad.addColorStop(0,'rgba(255,255,255,.8)');grad.addColorStop(.4,'rgba(255,255,255,.35)');grad.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,32,32);
  const mistTexture=new THREE.CanvasTexture(sprite);this.textures.push(mistTexture);
  this.mistMat=new THREE.PointsMaterial({map:mistTexture,color:0xe4f1f5,size:.24,transparent:true,opacity:.5,depthWrite:false,toneMapped:false});
  this.mist=new THREE.Points(new THREE.BufferGeometry(),this.mistMat);this.scene.add(this.mist);
  for(const obj of [this.wind,this.drops,this.mist])obj.frustumCulled=false;
  this.frame=requestAnimationFrame(this.animate);
 }
 private texture(kind:'concrete'|'sand'|'hide',variant=0){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d')!;
  c.fillStyle=kind==='hide'?'#eee9db':kind==='sand'?'#d7c7a3':'#ccc8bf';c.fillRect(0,0,256,256);
  if(kind==='hide'){
   // Few broad asymmetric islands; each animal uses one of three shared coats.
   const patches=[[20,30,44,59],[157,45,64,48],[71,137,55,47],[213,179,59,68],[24,242,44,38]];
   for(const [i,patch]of patches.entries()){
    const [px,py,rx,ry]=patch,x=(px+variant*37)%256,y=(py+variant*23)%256;
    c.fillStyle='#202321';
    for(const ox of [-256,0,256])for(const oy of [-256,0,256]){
     c.beginPath();for(let j=0;j<=48;j++){const a=j/48*Math.PI*2,r=1+.13*Math.sin(a*3+i+variant)+.09*Math.cos(a*5-i);
      c.lineTo(x+ox+Math.cos(a)*rx*r,y+oy+Math.sin(a)*ry*r)}c.closePath();c.fill();
    }
   }
  }else{
   for(let i=0;i<8500;i++){const n=Math.floor(100+seed(i+17)*110);c.fillStyle=`rgba(${n},${n-5},${n-12},.18)`;c.fillRect(seed(i)*256,seed(i+19)*256,kind==='sand'?3:1,1)}
   if(kind==='concrete'){c.strokeStyle='rgba(55,52,44,.18)';c.lineWidth=1;for(let y=0;y<256;y+=16){c.beginPath();c.moveTo(0,y);c.lineTo(256,y);c.stroke()}}
  }
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
  this.textures.push(t);return t;
 }
 private clear(root:THREE.Group,ownGeometry=false){
  for(const child of [...root.children]){root.remove(child);if(child instanceof THREE.InstancedMesh)child.dispose();
   if(ownGeometry&&child instanceof THREE.Mesh){child.geometry.dispose();const mats=Array.isArray(child.material)?child.material:[child.material];mats.forEach(m=>m.dispose())}}
 }
 private bar(k:Kit,a:Vec3,b:Vec3,r:number,material:THREE.Material){const d=V(b).sub(V(a));k.add(this.cylinder,material,V(a).add(V(b)).multiplyScalar(.5).toArray() as Vec3,[r,d.length(),r],new THREE.Quaternion().setFromUnitVectors(UP,d.normalize()))}
 private cow(k:Kit,x:number,z:number,floor:number,id:number,pose:'standing'|'lying'|'feeding'){
  this.cowPoses[pose]++;
  const m=this.materials,hide=[m.hide,m.hide2,m.hide3][id%3],lying=pose==='lying',feeding=pose==='feeding';
  const scale=.95+seed(id+401)*.08,bodyY=lying?.47:1.01;
  const at=(p:Vec3):Vec3=>[x+p[0]*scale,floor+p[1]*scale,z+p[2]*scale];
  const part=(g:THREE.BufferGeometry,mat:THREE.Material,p:Vec3,size:Vec3,q=new THREE.Quaternion())=>k.add(g,mat,at(p),size.map(n=>n*scale) as Vec3,q);
  const bone=(a:Vec3,b:Vec3,r:number,mat:THREE.Material)=>this.bar(k,at(a),at(b),r*scale,mat);
  const ellipsoid=(a:Vec3,b:Vec3,r:number,depth:number,mat:THREE.Material)=>{
   const axis=V(b).sub(V(a));part(this.sphere,mat,V(a).add(V(b)).multiplyScalar(.5).toArray() as Vec3,[r,axis.length()/2,depth],new THREE.Quaternion().setFromUnitVectors(UP,axis.normalize()));
  };
  part(this.cowBody,hide,[0,bodyY,0],[1,1,1]);
  // Bony hooks, brisket and tapered neck separate the shoulder and pelvis from the barrel.
  for(const sign of [-1,1])part(this.sphere,hide,[sign*.28,bodyY+.23,.51],[.105,.11,.17]);
  const poll:Vec3=[.025*(seed(id+73)-.5),bodyY+(feeding?-.35:.35),feeding?-1.08:-.99];
  const muzzle:Vec3=[poll[0],poll[1]-.38,poll[2]-.29];
  ellipsoid([0,bodyY+.15,-.53],poll,.18,.23,hide);
  ellipsoid([0,bodyY-.13,-.56],[poll[0],poll[1]-.19,poll[2]+.04],.12,.12,m.white);
  ellipsoid(poll,muzzle,.145,.17,m.black);
  // Long white blaze on the face, broad muzzle and two nostrils.
  ellipsoid([poll[0],poll[1]+.01,poll[2]-.12],[muzzle[0],muzzle[1]+.06,muzzle[2]-.105],.047,.037,m.white);
  part(this.sphere,m.nose,muzzle,[.185,.10,.125]);
  for(const sign of [-1,1]){
   part(this.sphere,m.black,[muzzle[0]+sign*.105,muzzle[1]+.025,muzzle[2]-.093],[.035,.022,.022]);
   part(this.sphere,m.black,[poll[0]+sign*.18,poll[1]-.12,poll[2]-.09],[.022,.024,.032]);
   part(this.sphere,hide,[poll[0]+sign*.24,poll[1]+.02,poll[2]+.045],[.17,.05,.087],new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),sign*.18));
   part(this.sphere,m.nose,[poll[0]+sign*.25,poll[1]+.035,poll[2]+.025],[.105,.016,.054]);
   if(sign===1)part(this.box,m.brass,[poll[0]+.29,poll[1]-.04,poll[2]-.025],[.06,.08,.012]);
   for(const rear of [false,true]){
    const legX=sign*.24,hipZ=rear?.56:-.54;
    if(lying){
     ellipsoid([legX,.37,hipZ],[legX+sign*.055,.11,hipZ+.15],.10,.105,hide);
     bone([legX+sign*.055,.11,hipZ+.15],[legX+sign*.06,.095,hipZ-.15],.043,m.white);
     part(this.sphere,m.black,[legX+sign*.06,.08,hipZ-.18],[.062,.065,.10]);
    }else{
     const knee:Vec3=[legX,.47,hipZ+(rear?.15:-.045)],ankle:Vec3=[legX,.14,hipZ+(rear?.04:.02)];
     ellipsoid([legX,1.04,hipZ],knee,rear?.11:.077,rear?.14:.085,hide);
     bone(knee,ankle,.044,m.white);part(this.sphere,m.white,knee,[.063,.077,.075]);
     for(const toe of [-1,1])part(this.box,m.black,[legX+toe*.026,.065,ankle[2]-.035],[.045,.11,.14]);
    }
   }
  }
  // Udder, teats and a hanging tail provide dairy-cow cues in side/rear views.
  part(this.sphere,m.nose,[0,bodyY-.37,.39],[.18,lying?.09:.145,.22]);
  if(!lying)for(const sx of [-.085,.085])for(const sz of [.30,.46])bone([sx,bodyY-.46,sz],[sx,bodyY-.56,sz],.018,m.nose);
  bone([0,bodyY+.19,.76],[.04,bodyY-.22,.91],.025,m.white);
  bone([.04,bodyY-.22,.91],[.10,lying?.16:.28,.96],.016,m.white);
  part(this.sphere,m.black,[.10,lying?.12:.22,.96],[.045,.10,.04]);
 }
 private buildBarn(p:Project){
  this.cowPoses={standing:0,lying:0,feeding:0};
  this.clear(this.building);const k=new Kit(),m=this.materials,l=buildLayout(p.template),L=p.template.lengthM,W=p.template.widthM;
  k.add(this.box,m.grass,[L/2,-.42,W/2],[L+32,.15,W+28]);
  k.add(this.box,m.concrete,[L/2,-.17,W/2],[L+2,.4,W+2]);
  // Expansion joints and the grooved walking surface give the slab a readable scale.
  for(let x=0;x<L;x+=3)k.add(this.box,m.darkSteel,[x,.035,W/2],[.015,.006,W]);
  for(const z of l.zones){
   if(z.kind==='feed'){k.add(this.box,m.feed,[z.x+z.widthM/2,.10,z.y+z.depthM/2],[z.widthM,.13,z.depthM*.68]);
    this.bar(k,[z.x,.22,z.y+z.depthM],[z.x+z.widthM,.22,z.y+z.depthM],.085,m.concrete)}
   if(z.solid){k.add(this.box,m.white,[z.x+z.widthM/2,1.25,z.y+z.depthM/2],[z.widthM,2.5,z.depthM]);
    k.add(this.box,m.steel,[z.x+z.widthM/2,2.52,z.y+z.depthM/2],[z.widthM+.12,.08,z.depthM+.12]);
    k.add(this.box,m.darkSteel,[z.x+z.widthM/2,1.1,z.y-.015],[.92,2.1,.025]);
    k.add(this.box,m.blue,[z.x+z.widthM*.8,1.65,z.y-.025],[.7,.65,.025])}
  }
  for(const [i,s]of l.stalls.entries()){
   const x=s.x,y=s.y,w=s.widthM,d=s.depthM;
   k.add(this.box,m.concrete,[x+w/2,.09,y+d/2],[w-.04,.12,d-.04]);
   k.add(this.box,m.sand,[x+w/2,.15,y+d/2],[w-.13,.035,d-.12]);
   for(const dx of [0,w]){
    this.bar(k,[x+dx,.18,y+.2],[x+dx,.82,y+.42],.028,m.steel);
    this.bar(k,[x+dx,.82,y+.42],[x+dx,.82,y+d-.4],.028,m.steel);
    this.bar(k,[x+dx,.82,y+d-.4],[x+dx,.2,y+d-.18],.028,m.steel);
   }
   // Three existing animals are shown at the soaker/feed alley instead of their beds.
   if(!p.view.analysis&&![2,18,37].includes(i))this.cow(k,x+w/2,y+d/2,.17,i,seed(i+101)>.4?'standing':'lying');
  }
  if(!p.view.analysis){
   const feeding=l.probes.filter(q=>q.kind==='feeding');
   for(const [j,index]of [2,6,10].entries()){const q=feeding[index];if(q)this.cow(k,q.x,q.y-.45,.035,[2,18,37][j],'feeding')}
  }
  // Structural columns and open trusses remain visible when the cutaway roof is off.
  for(let i=0;i<=6;i++){
   const x=L*i/6;
   for(const z of [0,W]){k.add(this.box,m.concrete,[x,.2,z],[.46,.4,.46]);k.add(this.box,m.darkSteel,[x,2.12,z],[.14,4,.18])}
   this.bar(k,[x,4,0],[x,8.7,W/2],.065,m.steel);this.bar(k,[x,8.7,W/2],[x,4,W],.065,m.steel);
   this.bar(k,[x,4,0],[x,4,W],.042,m.steel);
   for(let j=1;j<6;j++){const z=W*j/6,top=4+4.7*(1-Math.abs(z-W/2)/(W/2));
    this.bar(k,[x,4,z],[x,top,z],.023,m.steel);
    this.bar(k,[x,4,z-W/6],[x,top,z],.02,m.steel)}
  }
  for(const z of [0,W/2,W])this.bar(k,[0,z===W/2?8.7:4,z],[L,z===W/2?8.7:4,z],.06,m.darkSteel);
  if(p.view.roof&&!p.view.analysis){
   const slope=Math.atan2(4.7,W/2),length=Math.hypot(4.7,W/2);
   m.roof.color.set(activeScenario(p).roof.reflectance>.5?0xe9e8df:0x88969e);
   k.add(this.box,m.roof,[L/2,6.38,W/4],[L+.5,.055,length+.25],new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),slope));
   for(let x=0;x<=L;x+=.32)this.bar(k,[x,4.05,0],[x,8.75,W/2],.018,m.steel);
  }
  const feed=l.zones.find(z=>z.kind==='feeding');
  if(feed){for(const h of [.55,1.25])this.bar(k,[feed.x,h,feed.y],[feed.x+feed.widthM,h,feed.y],.032,m.steel);
   for(let x=feed.x;x<feed.x+feed.widthM;x+=.65)this.bar(k,[x,.55,feed.y],[x+.25,1.25,feed.y],.022,m.steel)}
  const robot=l.zones.find(z=>z.kind==='robot')!;
  k.add(this.box,m.darkSteel,[robot.x+1.5,.8,robot.y+1.2],[2.1,1.5,1.6]);
  k.add(this.box,m.blue,[robot.x+1.5,1.55,robot.y+1.2],[2.3,.35,1.8]);
  k.add(this.box,m.white,[robot.x+.42,1.05,robot.y+1.2],[.09,.8,1.5]);
  k.finish(this.building);this.renderer.shadowMap.needsUpdate=true;
  this.sunTarget.position.set(L/2,0,W/2);this.sun.position.set(L/2-20,35,W/2+18);
  const span=Math.max(L,W)*.8+8;Object.assign(this.sun.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:.5,far:110});this.sun.shadow.camera.updateProjectionMatrix();
 }
 private buildEquipment(p:Project){
  this.clear(this.equipment);const k=new Kit(),m=this.materials,s=activeScenario(p);
  for(const f of s.fans){
   const c=V(world(f)),axis=V(direction(f.yawDeg,f.pitchDownDeg)),rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),axis),r=f.diameterM/2;
   const local=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z).applyQuaternion(rotation).add(c).toArray() as Vec3;
   for(const z of [-.13,.13])k.add(this.ring,f.enabled?m.steel:m.rubber,local(0,0,z),[r,r,r],rotation);
   for(let i=0;i<12;i++){const a=i*Math.PI/6;this.bar(k,local(Math.cos(a)*r,Math.sin(a)*r,-.13),local(Math.cos(a)*r,Math.sin(a)*r,.13),.015,m.steel)}
   for(const radius of [.35,.65,.9])k.add(this.ring,m.steel,local(0,0,.15),[r*radius,r*radius,r*.2],rotation);
   for(let i=0;i<4;i++){const a=i*Math.PI/2,spin=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),a+.4);
    k.add(this.box,f.enabled?m.darkSteel:m.rubber,local(Math.cos(a)*r*.43,Math.sin(a)*r*.43,0),[r*.65,r*.19,.028],rotation.clone().multiply(spin))}
   k.add(this.sphere,m.darkSteel,local(0,0,-.04),[r*.22,r*.22,.23],rotation);
   this.bar(k,[f.x,Math.max(4,f.heightM+.3),f.y],world(f),.032,m.steel);
   if(p.view.selectedDeviceId===f.id)k.add(this.ring,m.brass,local(0,0,.19),[r+.17,r+.17,.6],rotation);
  }
  for(const w of [...s.waterSystems].sort((a,b)=>Number(a.enabled)-Number(b.enabled))){
   const ordered=[...w.nozzles].sort((a,b)=>a.x-b.x);
   for(let i=1;i<ordered.length;i++)this.bar(k,[ordered[i-1].x,ordered[i-1].heightM+.16,ordered[i-1].y],[ordered[i].x,ordered[i].heightM+.16,ordered[i].y],.025,m.rubber);
   for(const n of w.nozzles){
    const axis=V(direction(n.yawDeg,n.pitchDownDeg)),q=new THREE.Quaternion().setFromUnitVectors(UP,axis);
    const enabled=w.enabled&&n.enabled;
    k.add(this.cylinder,enabled?(w.kind==='soaker'?m.blue:m.purple):m.rubber,world(n),[.085,.18,.085],q);
    k.add(this.sphere,m.brass,V(world(n)).addScaledVector(axis,.12).toArray() as Vec3,[.055,.055,.055]);
    if(p.view.selectedDeviceId===n.id)k.add(this.ring,m.brass,world(n),[.26,.26,.4],new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
   }
  }
  k.finish(this.equipment);this.renderer.shadowMap.needsUpdate=true;
 }
 private buildOverlay(p:Project,result:SimulationResult|null){
  this.clear(this.overlay,true);const layout=buildLayout(p.template),out=result?.scenarios.find(s=>s.id===p.activeScenarioId);
  const selected=buildAreas(layout).find(a=>a.id===p.view.selectedAreaId);
  const positions:number[]=[],colors:number[]=[];const outline:number[]=[],invalidLines:number[]=[];
  for(const f of buildFaces(layout)){
   const corners:Vec3[]=[[f.x+.035,f.surfaceY+.025,f.y+.035],[f.x+f.widthM-.035,f.surfaceY+.025,f.y+.035],[f.x+f.widthM-.035,f.surfaceY+.025,f.y+f.depthM-.035],[f.x+.035,f.surfaceY+.025,f.y+f.depthM-.035]];
   if(p.view.heatmap||p.view.analysis){const point=out?.points.find(q=>q.probeId===f.probeId);const c=new THREE.Color(metricColor(metricValue(point,p.view.metric),p.view.metric));
    if(point?.status==='invalid')invalidLines.push(...corners[0],...corners[2]);
    for(const i of [0,2,1,0,3,2]){positions.push(...corners[i]);colors.push(c.r,c.g,c.b)}}
   if(f.probeId===p.view.selectedProbeId||selected?.probeIds.includes(f.probeId))for(let i=0;i<4;i++)outline.push(...corners[i],...corners[(i+1)%4]);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  this.overlay.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,toneMapped:false})));
  const o=new THREE.BufferGeometry();o.setAttribute('position',new THREE.Float32BufferAttribute(outline,3));
  // LineSegments cleanup is handled explicitly on the next update/dispose.
  const line=new THREE.LineSegments(o,new THREE.LineBasicMaterial({color:0xe2a947,toneMapped:false}));this.overlay.add(line);
  const invalidGeometry=new THREE.BufferGeometry();invalidGeometry.setAttribute('position',new THREE.Float32BufferAttribute(invalidLines,3));
  this.overlay.add(new THREE.LineSegments(invalidGeometry,new THREE.LineBasicMaterial({color:0x626e7b,toneMapped:false,depthTest:false})));
  const probe=layout.probes.find(q=>q.id===p.view.selectedProbeId);
  if(probe){const ring=new THREE.Mesh(new THREE.TorusGeometry(.4,.025,6,32),new THREE.MeshBasicMaterial({color:0xe2a947,toneMapped:false}));ring.rotation.x=Math.PI/2;ring.position.set(probe.x,probe.heightM+.15,probe.y);this.overlay.add(ring)}
 }
 private resetParticles(obj:THREE.LineSegments|THREE.Points,count:number){obj.geometry.dispose();obj.geometry=new THREE.BufferGeometry();obj.geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3).setUsage(THREE.DynamicDrawUsage))}
 private buildEffects(p:Project){
  this.winds=[];this.waters=[];this.fogs=[];const s=activeScenario(p),layout=buildLayout(p.template),time=Math.min(p.view.timeSec,3599),profile=p.model.profiles.find(x=>x.id==='reference')!;
  if(p.view.flow)for(const [fi,f]of s.fans.entries()){
   if(!f.enabled||f.outletSpeedMps<=0||time>=f.hoursPerDay*3600)continue;
   const axis=V(direction(f.yawDeg,f.pitchDownDeg)),u=new THREE.Vector3().crossVectors(axis,Math.abs(axis.y)>.9?new THREE.Vector3(1,0,0):UP).normalize(),v=new THREE.Vector3().crossVectors(axis,u),c=V(world(f));
   for(let j=0;j<12;j++){
    const angle=j*2.39996,rad=Math.sqrt((j+.5)/12)*.7;let previous=c.clone().addScaledVector(axis,.2).addScaledVector(u,Math.cos(angle)*rad*f.diameterM/2).addScaledVector(v,Math.sin(angle)*rad*f.diameterM/2);const origin=previous.clone();
    for(let step=1;step<=16;step++){
     const distance=step*.65,spread=f.diameterM/2+p.model.kSpread*distance;
     const next=c.clone().addScaledVector(axis,distance).addScaledVector(u,Math.cos(angle)*rad*spread).addScaledVector(v,Math.sin(angle)*rad*spread);
     if(next.y<.12||next.x<0||next.z<0||next.x>p.template.lengthM||next.z>p.template.widthM||layout.solids.some(b=>segmentHitsBox(previous.toArray() as Vec3,next.toArray() as Vec3,b)))break;
     const speed=fanContribution(f,next.toArray() as Vec3,p.model,profile,layout.solids);if(speed<.15)break;
     previous=next;
    }
    if(previous.distanceTo(origin)>.3){const middle=origin.clone().lerp(previous,.5),speed=fanContribution(f,middle.toArray() as Vec3,p.model,profile,layout.solids);
     for(let dash=0;dash<3;dash++)this.winds.push({a:origin,b:previous,speed,phase:(seed(fi*123+j*31)+dash/3)%1})}
   }
  }
  if(p.view.particles)for(const w of s.waterSystems){
   if(!w.enabled||!isOn(time,w.onSec,w.offSec,w.hoursPerDay))continue;
   for(const [ni,n]of w.nozzles.entries()){
    if(!n.enabled||n.flowLpm<=0)continue;
    const c=world(n);
    for(const [i,d]of sprayDirections(n,w.kind==='mist'?48:24).entries()){
     const hit=rayAtHeight(c,d,.19);if(!hit||hit[0]<0||hit[2]<0||hit[0]>p.template.lengthM||hit[2]>p.template.widthM||layout.solids.some(b=>segmentHitsBox(c,hit,b)))continue;
     const trail={a:V(c),b:V(hit),speed:w.kind==='mist'?.28:.65,phase:seed(ni*79+i)};
     (w.kind==='mist'?this.fogs:this.waters).push(trail);
    }
   }
  }
  this.resetParticles(this.wind,this.winds.length*2);this.resetParticles(this.drops,this.waters.length*2);this.resetParticles(this.mist,this.fogs.length);
 }
 private moveEffects(t:number){
  const lines=(obj:THREE.LineSegments,trails:Trail[],wind:boolean)=>{const attr=obj.geometry.getAttribute('position') as THREE.BufferAttribute;
   trails.forEach((r,i)=>{const phase=(r.phase+t*(wind?Math.min(r.speed,8)/Math.max(.5,r.a.distanceTo(r.b)):r.speed))%1;
    const a=r.a.clone().lerp(r.b,phase),b=r.a.clone().lerp(r.b,Math.min(1,phase+(wind?.09:.045)));
    attr.setXYZ(i*2,a.x,a.y,a.z);attr.setXYZ(i*2+1,b.x,b.y,b.z)});if(trails.length)attr.needsUpdate=true};
  lines(this.wind,this.winds,true);lines(this.drops,this.waters,false);
  const attr=this.mist.geometry.getAttribute('position') as THREE.BufferAttribute;
  this.fogs.forEach((r,i)=>{const phase=(r.phase+t*r.speed)%1,pos=r.a.clone().lerp(r.b,phase);pos.x+=Math.sin(i+t)*.07*phase;attr.setXYZ(i,pos.x,pos.y,pos.z)});if(this.fogs.length)attr.needsUpdate=true;
 }
 update(_batch:Batch,p?:Project,result?:SimulationResult|null){
  if(!p)return;this.p=p;const s=activeScenario(p);
  const barn=JSON.stringify([p.template,p.view.analysis,p.view.roof,s.roof.reflectance]);if(barn!==this.buildingKey){this.buildingKey=barn;this.buildBarn(p)}
  const devices=JSON.stringify([s.fans,s.waterSystems,p.view.selectedDeviceId]);if(devices!==this.equipmentKey){this.equipmentKey=devices;this.buildEquipment(p)}
  const overlay=JSON.stringify([p.template,p.activeScenarioId,result?.inputHash,p.view.metric,p.view.heatmap,p.view.analysis,p.view.selectedProbeId,p.view.selectedAreaId]);
  if(overlay!==this.overlayKey){this.overlayKey=overlay;this.disposeOverlayLines();this.buildOverlay(p,result??null)}
  const effects=JSON.stringify([s.fans,s.waterSystems,p.template,p.environment,p.model,p.view.flow,p.view.particles,p.view.timeSec]);
  if(effects!==this.effectKey){this.effectKey=effects;this.buildEffects(p)}
 }
 private disposeOverlayLines(){for(const c of this.overlay.children)if(c instanceof THREE.LineSegments){c.geometry.dispose();(c.material as THREE.Material).dispose()}}
 draw(_m:Mat4,w:number,h:number,c?:Camera){
  if(!c||!this.p)return;this.width=w;this.height=h;const shadowSize=innerWidth<600?1024:2048;
  if(this.sun.shadow.mapSize.x!==shadowSize){this.sun.shadow.mapSize.set(shadowSize,shadowSize);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;this.renderer.shadowMap.needsUpdate=true}
  this.renderer.setSize(w,h,false);this.camera.aspect=w/h;
  this.camera.position.copy(V(eyeOf(c)));this.camera.lookAt(V(c.target));this.camera.updateProjectionMatrix();this.renderFrame();
 }
 private renderFrame(){if(!this.p)return;const start=performance.now();this.moveEffects(this.reduced.matches?0:(start-this.clockStart)/1000);this.renderer.render(this.scene,this.camera);this.frameMs=performance.now()-start}
 private animate=(time:number)=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);if(document.hidden||this.reduced.matches||time-this.lastFrame<33)return;this.lastFrame=time;this.renderFrame()};
 diagnostics(){return {calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures,
  materials:Object.keys(this.materials).length+5,shadowLights:1,shadowMap:this.sun.shadow.mapSize.x,dpr:this.renderer.getPixelRatio(),postPasses:0,frameMs:this.frameMs,width:this.width,height:this.height,
  cowPoses:{...this.cowPoses},windSegments:this.winds.length,soakerDrops:this.waters.length,mistParticles:this.fogs.length,reducedMotion:this.reduced.matches}}
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.disposeOverlayLines();this.clear(this.overlay,true);this.clear(this.building);this.clear(this.equipment);
  for(const obj of [this.wind,this.drops,this.mist])obj.geometry.dispose();for(const g of [this.box,this.sphere,this.cylinder,this.ring,this.cowBody])g.dispose();
  for(const m of Object.values(this.materials))m.dispose();this.lineMat.dispose();this.dropMat.dispose();this.mistMat.dispose();this.textures.forEach(t=>t.dispose());this.env.dispose();this.sun.shadow.map?.dispose();this.renderer.dispose()}
}
