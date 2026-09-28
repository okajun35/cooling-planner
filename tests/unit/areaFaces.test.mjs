import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../../.compiled/data/defaults.js';
import {buildLayout} from '../../.compiled/template/layout.js';
import {buildFaces,buildAreas} from '../../.compiled/template/faces.js';
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tol ${tol})`);

test('faces cover exactly the 70 evaluated areas, 1:1 with probes',()=>{
  const l=buildLayout(createProject().template),faces=buildFaces(l);
  assert.equal(faces.length,70);
  assert.equal(new Set(faces.map(f=>f.probeId)).size,70);
  assert.equal(new Set(faces.map(f=>f.id)).size,70);
  assert.equal(faces.filter(f=>f.kind==='stall').length,50);
  assert.equal(faces.filter(f=>f.kind==='feeding').length,12);
  assert.equal(faces.filter(f=>f.kind==='waiting').length,8);
  for(const f of faces){
    const q=l.probes.find(q=>q.id===f.probeId);
    assert.ok(q,`face ${f.id} probe ${f.probeId} missing`);
    assert.ok(q.x>=f.x-1e-9&&q.x<=f.x+f.widthM+1e-9&&q.y>=f.y-1e-9&&q.y<=f.y+f.depthM+1e-9,`${f.id} does not contain ${q.id}`);
  }
});
test('stall faces are the stall rectangles',()=>{
  const l=buildLayout(createProject().template),faces=buildFaces(l);
  for(const st of l.stalls){
    const f=faces.find(f=>f.probeId===st.id);
    assert.ok(f,`missing face for ${st.id}`);
    near(f.x,st.x);near(f.y,st.y);near(f.widthM,st.widthM);near(f.depthM,st.depthM);
  }
});
test('feeding faces tile the zone along its long side without gaps or overlap',()=>{
  const l=buildLayout(createProject().template),faces=buildFaces(l);
  const zone=l.zones.find(z=>z.kind==='feeding');
  const ff=faces.filter(f=>f.kind==='feeding').sort((a,b)=>a.x-b.x);
  assert.equal(ff.length,12);
  near(ff[0].x,zone.x,1e-6);
  near(ff[ff.length-1].x+ff[ff.length-1].widthM,zone.x+zone.widthM,1e-6);
  for(let i=1;i<ff.length;i++)near(ff[i].x,ff[i-1].x+ff[i-1].widthM,1e-6);
  for(const f of ff){near(f.y,zone.y,1e-6);near(f.depthM,zone.depthM,1e-6)}
  // probe-to-segment correspondence is order-preserving (feed-01..feed-12)
  assert.deepEqual(ff.map(f=>f.probeId),[...Array(12)].map((_,i)=>`feed-${String(i+1).padStart(2,'0')}`));
});
test('waiting faces form a 2-column x 4-row grid inside the zone',()=>{
  const l=buildLayout(createProject().template),faces=buildFaces(l);
  const zone=l.zones.find(z=>z.kind==='waiting');
  const wf=faces.filter(f=>f.kind==='waiting');
  assert.equal(wf.length,8);
  const xs=[...new Set(wf.map(f=>f.x))].sort((a,b)=>a-b),ys=[...new Set(wf.map(f=>f.y))].sort((a,b)=>a-b);
  assert.equal(xs.length,2);assert.equal(ys.length,4);
  near(wf[0].widthM,zone.widthM/2,1e-6);near(wf[0].depthM,zone.depthM/4,1e-6);
  for(const f of wf){
    assert.ok(f.x>=zone.x-1e-9&&f.x+f.widthM<=zone.x+zone.widthM+1e-9);
    assert.ok(f.y>=zone.y-1e-9&&f.y+f.depthM<=zone.y+zone.depthM+1e-9);
  }
});
test('areas: stall rows, feeding, waiting, plus a stall subtotal',()=>{
  const l=buildLayout(createProject().template),areas=buildAreas(l);
  const get=id=>areas.find(a=>a.id===id);
  assert.equal(get('stall-A').probeIds.length,13);
  assert.equal(get('stall-B').probeIds.length,12);
  assert.equal(get('stall-C').probeIds.length,13);
  assert.equal(get('stall-D').probeIds.length,12);
  assert.equal(get('feeding').probeIds.length,12);
  assert.equal(get('waiting').probeIds.length,8);
  assert.equal(get('stalls').probeIds.length,50);
  for(const a of areas)for(const id of a.probeIds)assert.ok(l.probes.some(q=>q.id===id),`${a.id}: ${id}`);
});
test('face ids are stable across template resize (derived, not stored)',()=>{
  const t=createProject().template;const a=buildFaces(buildLayout(t));
  const b=buildFaces(buildLayout({...t,lengthM:t.lengthM+4,widthM:t.widthM+2}));
  assert.deepEqual(a.map(f=>f.id),b.map(f=>f.id));
  assert.deepEqual(a.map(f=>f.probeId),b.map(f=>f.probeId));
});
