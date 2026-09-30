import {test} from 'node:test';import assert from 'node:assert/strict';
import {ProjectStore} from '../../.compiled/state/store.js';
import {positionFromAnchor,buildLayout} from '../../.compiled/template/layout.js';
import {inputHash} from '../../.compiled/model/simulation.js';

test('addFan(pose) places at given coordinates, one atomic undo, selects new fan',()=>{
 const s=new ProjectStore(),before=s.serialize();
 const id=s.addFan({x:12.3,y:17.8});
 const f=s.project.scenarios[1].fans.find(f=>f.id===id);
 assert.ok(f);assert.equal(f.x,12.3);assert.equal(f.y,17.8);
 const xy=positionFromAnchor(f,s.project.template,buildLayout(s.project.template));
 assert.ok(Math.abs(xy.x-f.x)<1e-9&&Math.abs(xy.y-f.y)<1e-9,'anchor must match placed pose');
 assert.equal(s.project.view.selectedDeviceId,id);
 assert.equal(s.undoCount,1,'single edit = single undo entry');
 s.undo();assert.equal(s.serialize(),before);
});

test('addNozzle(kind,pose) places on the matching system, atomic undo',()=>{
 const s=new ProjectStore();
 const id=s.addNozzle('mist',{x:8,y:6.5});
 const sys=s.project.scenarios[1].waterSystems.find(w=>w.kind==='mist');
 const n=sys.nozzles.find(n=>n.id===id);
 assert.ok(n);assert.equal(n.x,8);assert.equal(n.y,6.5);
 assert.equal(s.project.view.selectedDeviceId,id);
 assert.equal(s.undoCount,1);
 s.undo();assert.equal(sys===undefined?0:s.project.scenarios[1].waterSystems.find(w=>w.kind==='mist').nozzles.length,12);
});

test('argument-less add keeps legacy default position (MCP path unchanged)',()=>{
 const s=new ProjectStore();
 const id=s.addFan();
 const f=s.project.scenarios[1].fans.find(f=>f.id===id);
 assert.equal(f.x,s.project.template.lengthM/2);assert.equal(f.y,6);
 const nid=s.addNozzle('soaker');
 const nz=s.project.scenarios[1].waterSystems[0].nozzles.find(n=>n.id===nid);
 assert.equal(nz.x,s.project.template.lengthM/2);assert.equal(nz.y,5.75);
});

test('placement outside the barn is rejected atomically — nothing committed',()=>{
 const s=new ProjectStore(),before=s.serialize(),h=inputHash(s.committed);
 assert.throws(()=>s.addFan({x:99,y:5}));
 assert.throws(()=>s.addNozzle('soaker',{x:5,y:99}));
 assert.equal(s.serialize(),before);assert.equal(s.undoCount,0);
 assert.equal(inputHash(s.committed),h);
});

test('baseline scenario refuses posed additions',()=>{
 const s=new ProjectStore();s.switchScenario('baseline');
 assert.throws(()=>s.addFan({x:5,y:5}),/baseline/i);
 assert.throws(()=>s.addNozzle('mist',{x:5,y:5}),/baseline/i);
});
