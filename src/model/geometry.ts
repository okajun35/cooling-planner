import type {Vec3,Pose,Box3,Fan,Environment,Model,Profile,Probe,Nozzle} from '../domain/project.js';
export const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const subtract=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const length=(v:Vec3)=>Math.hypot(...v);
export const normalize=(v:Vec3):Vec3=>{const n=length(v);return n?v.map(x=>x/n) as Vec3:[0,0,0]};
export const world=(p:Pick<Pose,'x'|'y'|'heightM'>):Vec3=>[p.x,p.heightM,p.y];
/** Adapted from the uploaded v0.3 domain/geometry.ts; yaw/pitch convention retained. */
export function direction(yaw:number,pitch:number):Vec3{const a=yaw*Math.PI/180,p=pitch*Math.PI/180;return [Math.cos(p)*Math.cos(a),-Math.sin(p),Math.cos(p)*Math.sin(a)]}
export const insideBox=(p:Vec3,b:Box3)=>p.every((x,i)=>x>=b.min[i]&&x<=b.max[i]);
export function segmentHitsBox(a:Vec3,b:Vec3,box:Box3){
 let lo=0,hi=1;
 for(let i=0;i<3;i++){
  const d=b[i]-a[i];
  if(Math.abs(d)<1e-12){if(a[i]<box.min[i]||a[i]>box.max[i])return false;continue}
  const t1=(box.min[i]-a[i])/d,t2=(box.max[i]-a[i])/d;
  lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return false;
 }
 return hi>=0&&lo<=1;
}
export const blocked=(a:Vec3,b:Vec3,solids:Box3[])=>solids.some(box=>segmentHitsBox(a,b,box));
export function fanContribution(f:Fan,p:Vec3,m:Model,profile:Profile,solids:Box3[]=[]){
 if(!f.enabled)return 0;
 const delta=subtract(p,world(f)),d=direction(f.yawDeg,f.pitchDownDeg),s=dot(delta,d);
 if(s<0||blocked(world(f),p,solids))return 0;
 const r2=Math.max(0,dot(delta,delta)-s*s),b=f.diameterM/2+m.kSpread*s;
 return f.outletSpeedMps*profile.outletMultiplier/(1+s/(m.kDecay*f.diameterM))*Math.exp(-.5*r2/(b*b));
}
export function windAt(fans:Fan[],p:Vec3,e:Environment,m:Model,profile:Profile,solids:Box3[]=[],seconds=0){
 const contributions=fans.map(f=>({f,u:seconds<f.hoursPerDay*3600?fanContribution(f,p,m,profile,solids):0})).sort((a,b)=>b.u-a.u);
 const u=contributions[0]?.u??0,other=contributions[1];
 const interference=!!other&&other.u>0&&u>0&&other.u/u>.7&&dot(direction(contributions[0].f.yawDeg,contributions[0].f.pitchDownDeg),direction(other.f.yawDeg,other.f.pitchDownDeg))<-.7;
 return {speed:Math.sqrt(e.backgroundSpeedMps**2+u**2),interference,dominant:contributions[0]?.f.id};
}
const rayCache=new Map<string,Vec3[]>();
/** Deterministic equal-area disk samples. Ray count is unrelated to rendering quality. */
export function sprayDirections(n:Nozzle,count=256):Vec3[]{
 const key=`${n.yawDeg}:${n.pitchDownDeg}:${n.halfAngleDeg}:${count}`;const old=rayCache.get(key);if(old)return old;
 if(count<1||!Number.isInteger(count))throw Error('積分レイ数が不正です');
 const axis=direction(n.yawDeg,n.pitchDownDeg),u=normalize(cross(axis,Math.abs(axis[1])>.9?[1,0,0]:[0,1,0])),v=cross(axis,u),scale=Math.tan(n.halfAngleDeg*Math.PI/180);
 const rays=Array.from({length:count},(_,i)=>{const r=Math.sqrt((i+.5)/count)*scale,angle=i*Math.PI*(3-Math.sqrt(5)),c=Math.cos(angle)*r,s=Math.sin(angle)*r;return normalize([axis[0]+c*u[0]+s*v[0],axis[1]+c*u[1]+s*v[1],axis[2]+c*u[2]+s*v[2]])});
 if(rayCache.size>256)rayCache.clear();rayCache.set(key,rays);return rays;
}
export function rayAtHeight(origin:Vec3,d:Vec3,h:number):Vec3|null{if(d[1]>=-1e-12)return null;const t=(h-origin[1])/d[1];return t<0?null:[origin[0]+d[0]*t,h,origin[2]+d[2]*t]}
export function captureFraction(n:Nozzle,p:Probe,m:Model,solids:Box3[],count=256){
 if(!n.enabled)return 0;const o=world(n),a=p.patchYawDeg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);let hits=0;
 for(const ray of sprayDirections(n,count)){
  const q=rayAtHeight(o,ray,p.heightM);if(!q||blocked(o,q,solids))continue;
  const dx=q[0]-p.x,dy=q[2]-p.y,l=dx*c+dy*s,w=-dx*s+dy*c;
  if(Math.abs(l)<=m.patchLengthM/2&&Math.abs(w)<=m.patchWidthM/2)hits++;
 }
 return hits/count;
}
