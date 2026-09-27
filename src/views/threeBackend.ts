import * as THREE from 'three';
import type {Batch} from './sceneGeometry.js';
import type {Mat4} from './math3d.js';
import type {RenderBackend} from './common.js';
/** Three.js renderer. Consumes the same world-space vertex-coloured batch and the
 *  math3d MVP matrix, so picking and projection stay identical to the WebGL path. */
export class ThreeBackend implements RenderBackend{
 readonly name='Three.js r180';
 private renderer:THREE.WebGLRenderer;private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera();private tri:THREE.Mesh;private lines:THREE.LineSegments;
 constructor(canvas:HTMLCanvasElement){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});
  this.renderer.setClearColor(0xf2f6fa,1);this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
  this.camera.matrixAutoUpdate=false;this.camera.matrixWorldAutoUpdate=false;
  this.tri=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));this.tri.frustumCulled=false;
  this.lines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({vertexColors:true}));this.lines.frustumCulled=false;this.lines.renderOrder=1;
  this.scene.add(this.tri,this.lines);
 }
 private replace(target:THREE.Mesh|THREE.LineSegments,data:Float32Array){
  const geometry=new THREE.BufferGeometry(),buffer=new THREE.InterleavedBuffer(data,6);
  geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('color',new THREE.InterleavedBufferAttribute(buffer,3,3));
  target.geometry.dispose();target.geometry=geometry;
 }
 update(b:Batch){this.replace(this.tri,b.triangles);this.replace(this.lines,b.lines)}
 draw(m:Mat4,w:number,h:number){this.renderer.setSize(w,h,false);this.camera.projectionMatrix.fromArray(m);this.renderer.render(this.scene,this.camera)}
 dispose(){this.tri.geometry.dispose();this.lines.geometry.dispose();(this.tri.material as THREE.Material).dispose();(this.lines.material as THREE.Material).dispose();this.renderer.dispose()}
}
