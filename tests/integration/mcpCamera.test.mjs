import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCommands} from '../../.compiled/mcp/commands.js';
import {startWebMcp} from '../../.compiled/mcp/webmcp.js';
import {ProjectStore} from '../../.compiled/state/store.js';
import {inputHash} from '../../.compiled/model/simulation.js';
import {Viewport3D} from '../../.compiled/views/viewport3d.js';

function setup(){
 const store=new ProjectStore(),sheets=[];let stopped=0;
 const commands=createCommands({store,currentResult:()=>null,status:()=>({pendingInput:false,invalidInput:false,calculating:false,workerError:null}),stopPlayback:()=>stopped++,openSheet:tab=>sheets.push(tab),cameraAspectRatio:()=>1.7,evaluate:async()=>{throw Error('No test worker')}});
 return{store,commands,sheets,stopped:()=>stopped};
}
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('All/Top/Side presets work in both 3D render modes and frame the barn centre',()=>{
 const{store,commands}=setup(),hash=inputHash(store.committed);
 for(const realistic of[false,true])for(const cameraPreset of['all','top','side']){
  const view=commands.set_view({mode:'3d',realistic,cameraPreset});
  assert.equal(view.realistic,realistic);assert.equal(view.mode,'3d');
  assert.deepEqual(view.camera.target,[store.committed.template.lengthM/2,0,store.committed.template.widthM/2]);
  close(view.camera.azimuth,cameraPreset==='side'?Math.PI/2:-.28);
  close(view.camera.elevation,cameraPreset==='top'?1.55:cameraPreset==='side'?.2:.6);
  assert.equal(view.camera.distance,cameraPreset==='top'?48:42);
 }
 assert.equal(inputHash(store.committed),hash);assert.equal(store.undoCount,0);
});

test('absolute settings, orbit, pan and zoom compose in documented order without edits or recalculation',()=>{
 const{store,commands}=setup(),hash=inputHash(store.committed);
 const view=commands.set_view({cameraPreset:'side',camera:{azimuth:0,elevation:.4,distance:40,target:[10,2,15]},orbit:{azimuthDeg:90,elevationDeg:10},pan:{xM:3,zM:-4},zoomFactor:.5});
 close(view.camera.azimuth,Math.PI/2);close(view.camera.elevation,.4+Math.PI/18);
 assert.equal(view.camera.distance,20);assert.deepEqual(view.camera.target,[13,2,11]);
 assert.equal(inputHash(store.committed),hash);assert.equal(store.undoCount,0);
 const previous=structuredClone(view.camera);
 const next=commands.set_view({orbit:{azimuthDeg:30},zoomFactor:2}).camera;
 close(next.azimuth,Math.PI/2+Math.PI/6);assert.equal(next.distance,40);
 assert.deepEqual(view.camera,previous);
 assert.deepEqual(commands.get_state().view.camera,next);
});

test('relative gestures clamp to UI limits and large finite rotations remain valid',()=>{
 const{commands}=setup();
 let c=commands.set_view({cameraPreset:'all',orbit:{azimuthDeg:Number.MAX_VALUE,elevationDeg:1000},pan:{xM:1000,zM:-1000},zoomFactor:1000}).camera;
 assert.ok(Number.isFinite(c.azimuth));assert.equal(c.elevation,1.55);assert.equal(c.distance,160);assert.equal(c.target[0],100);assert.equal(c.target[2],-50);
 c=commands.set_view({orbit:{elevationDeg:-1000},zoomFactor:.001}).camera;
 assert.equal(c.elevation,.14);assert.equal(c.distance,8);
});

test('camera controls reject 2D, but a single call can switch to either 3D mode and move the camera',()=>{
 const{commands,store}=setup();
 commands.set_view({mode:'2d'});const before=store.serialize();
 assert.throws(()=>commands.set_view({cameraPreset:'top'}),/require 3D/);
 assert.equal(store.serialize(),before);
 const view=commands.set_view({mode:'3d',realistic:true,cameraPreset:'top'});
 assert.equal(view.mode,'3d');assert.equal(view.realistic,true);assert.equal(view.camera.elevation,1.55);
});

test('invalid camera arguments fail before sheet/playback/store side effects',()=>{
 const{store,commands,sheets,stopped}=setup(),before=store.serialize();
 for(const args of[
  {cameraPreset:'overview'},
  {camera:{distance:7}}, {camera:{elevation:2}}, {camera:{target:[1,2]}}, {camera:{target:[1,2,NaN]}},
  {camera:{azimuth:Infinity}}, {camera:{extra:1}}, {camera:{}}, {orbit:{}}, {pan:{}},
  {orbit:{azimuthDeg:'90'}}, {pan:{xM:NaN}}, {zoomFactor:0}, {zoomFactor:-1}, {zoomFactor:Infinity},
  {mode:'2d',cameraPreset:'side'},
 ])assert.throws(()=>commands.set_view({...args,sheet:'compare',timeSec:900}),/camera|Camera|orbit|pan|zoomFactor/);
 assert.deepEqual(sheets,[]);assert.equal(stopped(),0);assert.equal(store.serialize(),before);
});

test('WebMCP camera calls update live state, and malformed calls cannot change it',async()=>{
 const{store,commands}=setup(),tools=new Map();
 await startWebMcp({context:{registerTool:tool=>tools.set(tool.name,tool)},commands,notify:()=>{}});
 const tool=tools.get('set_view');
 const top=JSON.parse(await tool.execute({mode:'3d',realistic:true,cameraPreset:'top'}));
 assert.equal(top.camera.elevation,1.55);
 await tool.execute({cameraPreset:'all',orbit:{azimuthDeg:45},pan:{xM:2},zoomFactor:.8});
 close(store.committed.view.camera.azimuth,-.28+Math.PI/4);
 close(store.committed.view.camera.distance,42*.8);
 const before=store.serialize();
 for(const args of[{cameraPreset:'overview'},{orbit:{azimuthDeg:'90'}},{pan:{yM:2}},{camera:{distance:1}},{camera:{target:[1,2]}}])await assert.rejects(()=>tool.execute(args));
 assert.equal(store.serialize(),before);
});

test('camera-only renderer update draws immediately without rebuilding geometry or changing the supplied camera',()=>{
 // Exercise the renderer method without constructing a DOM/WebGL browser.
 const scene=Object.create(Viewport3D.prototype),draws=[],commits=[];
 scene.container={clientWidth:1700,clientHeight:1000};
 scene.backend={draw:(...args)=>draws.push(args),update:()=>{throw Error('Camera changes must not rebuild geometry')}};
 scene.cb={camera:c=>commits.push(c)};scene.p=new ProjectStore().committed;
 const camera={azimuth:1,elevation:.5,distance:30,target:[10,0,12]};
 scene.setCamera(camera);
 assert.equal(draws.length,1);assert.deepEqual(draws[0][3],camera);assert.equal(commits.length,0);
 camera.target[0]=99;assert.equal(scene.camera.target[0],10);
 scene.preset('top');assert.equal(commits.length,1);assert.equal(commits[0].elevation,1.55);assert.equal(commits[0].distance,48);
});
