import type {Vec3,View} from '../domain/project.js';
import {subtract,normalize,cross,dot} from '../model/geometry.js';
export type Mat4=number[];
export function multiply(a:Mat4,b:Mat4):Mat4{const o=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o}
export function lookAt(eye:Vec3,target:Vec3):Mat4{const f=normalize(subtract(target,eye)),s=normalize(cross(f,[0,1,0])),u=cross(s,f);return [s[0],u[0],-f[0],0,s[1],u[1],-f[1],0,s[2],u[2],-f[2],0,-dot(s,eye),-dot(u,eye),dot(f,eye),1]}
export function perspective(aspect:number,fov=42*Math.PI/180):Mat4{const f=1/Math.tan(fov/2),near=.1,far=400,nf=1/(near-far);return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]}
export type Camera=NonNullable<View['camera']>;
export function eyeOf(c:Camera):Vec3{return [c.target[0]+Math.sin(c.azimuth)*Math.cos(c.elevation)*c.distance,c.target[1]+Math.sin(c.elevation)*c.distance,c.target[2]+Math.cos(c.azimuth)*Math.cos(c.elevation)*c.distance]}
export function matrix(c:Camera,aspect:number){return multiply(perspective(aspect),lookAt(eyeOf(c),c.target))}
export function project(v:Vec3,m:Mat4,w:number,h:number){const q=[...v,1].map((_,r)=>m[r]*v[0]+m[4+r]*v[1]+m[8+r]*v[2]+m[12+r]);return {x:(q[0]/q[3]+1)*w/2,y:(1-q[1]/q[3])*h/2,visible:q[3]>0&&q[2]/q[3]>=-1&&q[2]/q[3]<=1,depth:q[2]/q[3]}}
export function planeAt(x:number,y:number,w:number,h:number,c:Camera,height:number):Vec3|null{
 const eye=eyeOf(c),f=normalize(subtract(c.target,eye)),r=normalize(cross(f,[0,1,0])),u=cross(r,f),tan=Math.tan(21*Math.PI/180),sx=(x/w*2-1)*w/h*tan,sy=(1-y/h*2)*tan;
 const d=normalize([f[0]+r[0]*sx+u[0]*sy,f[1]+r[1]*sx+u[1]*sy,f[2]+r[2]*sx+u[2]*sy]);if(Math.abs(d[1])<1e-8)return null;const t=(height-eye[1])/d[1];return t>0?[eye[0]+d[0]*t,height,eye[2]+d[2]*t]:null;
}
