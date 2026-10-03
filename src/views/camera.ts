import type {Template,View,Vec3} from '../domain/project.js';
export type Camera=NonNullable<View['camera']>;
export type CameraPreset='all'|'top'|'side';
export interface CameraControls {
 cameraPreset?:CameraPreset;
 /** Absolute camera values: angles in radians, distance and target in metres. */
 camera?:Partial<Camera>;
 /** Relative rotation in degrees, applied after preset and absolute settings. */
 orbit?:{azimuthDeg?:number;elevationDeg?:number};
 /** Relative ground-plane translation in barn coordinates, in metres. */
 pan?:{xM?:number;zM?:number};
 /** Multiplies distance: below 1 zooms in, above 1 zooms out. */
 zoomFactor?:number;
}
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
export function presetCamera(name:CameraPreset,template:Pick<Template,'lengthM'|'widthM'>,aspect=1.7):Camera {
 if(!['all','top','side'].includes(name))throw Error('cameraPreset must be all, top or side');
 if(!Number.isFinite(aspect)||aspect<=0)throw Error('Camera aspect ratio must be positive and finite');
 return{azimuth:name==='side'?Math.PI/2:-.28,elevation:name==='top'?1.55:name==='side'?.2:.6,distance:clamp((name==='top'?48:42)*Math.max(1,1.7/aspect),8,160),target:[template.lengthM/2,0,template.widthM/2]};
}
function finite(value:unknown,label:string):number {
 if(typeof value!=='number'||!Number.isFinite(value))throw Error(`${label} must be a finite number`);
 return value;
}
function fields(value:unknown,allowed:string[],label:string):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${label} must be an object`);
 const record=value as Record<string,unknown>;
 if(!Object.keys(record).length)throw Error(`${label} needs at least one field`);
 for(const key of Object.keys(record))if(!allowed.includes(key))throw Error(`${label}.${key} is not allowed`);
 return record;
}
/** Validate the whole request before any store, sheet or playback side effect. */
export function controlledCamera(current:View['camera'],controls:CameraControls,template:Pick<Template,'lengthM'|'widthM'>,aspect=1.7):Camera {
 const c=controls.cameraPreset!==undefined?presetCamera(controls.cameraPreset,template,aspect):structuredClone(current??presetCamera('all',template,aspect));
 if(controls.camera!==undefined){
  const patch=fields(controls.camera,['azimuth','elevation','distance','target'],'camera');
  for(const key of['azimuth','elevation','distance'] as const)if(patch[key]!==undefined)c[key]=finite(patch[key],`camera.${key}`);
  if(patch.target!==undefined){
   if(!Array.isArray(patch.target)||patch.target.length!==3)throw Error('camera.target needs three coordinates');
   c.target=patch.target.map((n,i)=>finite(n,`camera.target[${i}]`)) as Vec3;
  }
 }
 // Match saved-camera limits before applying relative gestures.
 if(c.azimuth<-100||c.azimuth>100||c.elevation<.1||c.elevation>1.56||c.distance<8||c.distance>160||c.target.some(n=>n<-100||n>200))throw Error('camera values are outside the allowed range');
 if(controls.orbit!==undefined){
  const orbit=fields(controls.orbit,['azimuthDeg','elevationDeg'],'orbit');
  if(orbit.azimuthDeg!==undefined){const angle=c.azimuth+(finite(orbit.azimuthDeg,'orbit.azimuthDeg')%360)*(Math.PI/180);c.azimuth=Math.atan2(Math.sin(angle),Math.cos(angle))}
  if(orbit.elevationDeg!==undefined)c.elevation=clamp(c.elevation+finite(orbit.elevationDeg,'orbit.elevationDeg')*(Math.PI/180),.14,1.55);
 }
 if(controls.pan!==undefined){
  const pan=fields(controls.pan,['xM','zM'],'pan');
  if(pan.xM!==undefined)c.target[0]=clamp(c.target[0]+finite(pan.xM,'pan.xM'),-50,100);
  if(pan.zM!==undefined)c.target[2]=clamp(c.target[2]+finite(pan.zM,'pan.zM'),-50,100);
 }
 if(controls.zoomFactor!==undefined){const factor=finite(controls.zoomFactor,'zoomFactor');if(factor<=0)throw Error('zoomFactor must be positive');c.distance=clamp(c.distance*factor,8,160)}
 return c;
}
