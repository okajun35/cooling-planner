import {test} from 'node:test';import assert from 'node:assert/strict';
import {createWorkspace,startPlacement,moveCandidate,confirmCandidate,cancelPlacement,openPanel,closePanel,openSheet,closeSheet,guideAdvance,guideSkip,guideRestart,notifyExternalChange} from '../../.compiled/ui/workspaceState.js';

test('initial workspace: no panel, no sheet, no placement, guide undecided',()=>{
 const w=createWorkspace();
 assert.equal(w.panel,null);assert.equal(w.sheet,null);assert.equal(w.placement,null);
 assert.equal(w.guide.done,false);assert.equal(w.guide.step,0);
});

test('placement lifecycle: start → candidate → confirm returns pose and exits',()=>{
 const w=createWorkspace();
 startPlacement(w,'fan');
 assert.equal(w.placement?.kind,'fan');assert.equal(w.placement?.valid,false);
 moveCandidate(w,10,5,true);
 assert.deepEqual([w.placement.x,w.placement.y,w.placement.valid],[10,5,true]);
 const placed=confirmCandidate(w);
 assert.deepEqual(placed,{kind:'fan',x:10,y:5});
 assert.equal(w.placement,null);
});

test('confirm without candidate or invalid candidate stays in placement, returns null',()=>{
 const w=createWorkspace();startPlacement(w,'soaker');
 assert.equal(confirmCandidate(w),null);
 moveCandidate(w,99,99,false);
 assert.equal(confirmCandidate(w),null);
 assert.ok(w.placement,'invalid candidate must not exit placement');
 cancelPlacement(w);assert.equal(w.placement,null);
});

test('cancel clears placement without touching panel/sheet',()=>{
 const w=createWorkspace();openPanel(w,'device');startPlacement(w,'mist');
 cancelPlacement(w);assert.equal(w.placement,null);assert.equal(w.panel,'device');
});

test('external project change or scenario/mode switch cancels pending placement',()=>{
 const w=createWorkspace();startPlacement(w,'fan');moveCandidate(w,5,5,true);
 notifyExternalChange(w,'project');assert.equal(w.placement,null);
 startPlacement(w,'fan');
 notifyExternalChange(w,'view');assert.equal(w.placement,null);
 const w2=createWorkspace();startPlacement(w2,'fan');
 notifyExternalChange(w2,'draft');
 assert.equal(w2.placement,null,'a device drag draft should also cancel placement');
});

test('right panel holds one selection kind; closing keeps no state',()=>{
 const w=createWorkspace();
 openPanel(w,'device');assert.equal(w.panel,'device');
 openPanel(w,'probe');assert.equal(w.panel,'probe');
 closePanel(w);assert.equal(w.panel,null);
});

test('sheet opens one tab at a time; closing returns to scene',()=>{
 const w=createWorkspace();openSheet(w,'compare');assert.equal(w.sheet,'compare');
 openSheet(w,'timeline');assert.equal(w.sheet,'timeline');
 closeSheet(w);assert.equal(w.sheet,null);
});

test('guide advances through 4 steps then marks done; skip finishes; restart resets',()=>{
 const w=createWorkspace();
 guideAdvance(w);assert.equal(w.guide.step,1);assert.equal(w.guide.done,false);
 guideAdvance(w);guideAdvance(w);guideAdvance(w);
 assert.equal(w.guide.step,4);assert.equal(w.guide.done,true);
 guideRestart(w);assert.equal(w.guide.step,0);assert.equal(w.guide.done,false);
 guideSkip(w);assert.equal(w.guide.done,true);
});
