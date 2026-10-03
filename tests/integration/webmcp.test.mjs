import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startWebMcp,findModelContext,WEBMCP_TOOLS} from '../../.compiled/mcp/webmcp.js';
import {createCommands} from '../../.compiled/mcp/commands.js';
import {ProjectStore} from '../../.compiled/state/store.js';

async function setup(overrides={}){
 const store=new ProjectStore(),tools=new Map(),statuses=[],sheets=[];
 const commands=createCommands({store,currentResult:()=>null,status:()=>({pendingInput:false,invalidInput:false,calculating:true,workerError:null}),stopPlayback:()=>{},openSheet:tab=>sheets.push(tab),evaluate:async()=>{throw Error('No test worker')},...overrides});
 await startWebMcp({context:{registerTool:async tool=>tools.set(tool.name,tool)},commands,notify:(...args)=>statuses.push(args)});
 return{store,tools,statuses,sheets,call:async(name,args)=>JSON.parse(await tools.get(name).execute(args))};
}

test('document API is preferred, navigator API is supported, unsupported browsers are detected',()=>{
 const modern={registerTool(){}},legacy={registerTool(){}};
 assert.equal(findModelContext({modelContext:modern},{modelContext:legacy}),modern);
 assert.equal(findModelContext({}, {modelContext:legacy}),legacy);
 assert.equal(findModelContext({modelContext:{}},{}),undefined);
});

test('WebMCP tools operate the live store and comparison sheet through existing commands',async()=>{
 const{call,store,sheets,statuses,tools}=await setup();
 assert.deepEqual([...tools.keys()],WEBMCP_TOOLS.map(t=>t.name));
 assert.deepEqual(statuses,[['ready','WebMCP ready']]);
 const initial=await call('get_state',{}),fan=store.committed.scenarios[1].fans[0],originalX=fan.x;
 assert.equal(initial.activeScenarioId,'working-soaker');
 assert.equal(tools.get('edit').annotations.readOnlyHint,false);
 assert.equal(tools.get('get_results').annotations.readOnlyHint,true);
 await call('edit',{operation:'update_device',deviceId:fan.id,patch:{x:originalX+1}});
 assert.equal(store.committed.scenarios[1].fans[0].x,originalX+1);
 assert.equal(store.undoCount,1);
 await call('set_view',{sheet:'compare',mode:'2d',metric:'deficit'});
 assert.deepEqual(sheets,['compare']);
 assert.equal(store.committed.view.mode,'2d');
 assert.equal(store.committed.view.metric,'deficit');
 const results=await call('get_results',{});
 assert.equal(results.status,'calculating');assert.equal(results.result,null);
 assert.ok((await call('describe_model',{})).modelNotes.length>0);
 assert.equal((await call('undo',{})).changed,true);
 assert.equal(store.committed.scenarios[1].fans[0].x,originalX);
});

test('malformed tool inputs never reach or mutate the live store or sheet',async()=>{
 const{call,store,sheets}=await setup(),before=store.serialize();
 const bad=[
  ['edit',{operation:'update_roof',patch:{reflectance:'0.8'}}],
  ['edit',{operation:'update_device',patch:{x:1}}],
  ['edit',{operation:'update_device',deviceId:'fan-feeding-1',patch:{x:NaN}}],
  ['edit',{operation:'update_roof',patch:{id:'renamed'}}],
  ['edit',{operation:'update_model',patch:{roof:{conductivity:'bad'}}}],
  ['edit',{operation:'update_milk',patch:{lagWeights:[1,0]}}],
  ['edit',{operation:'update_references',patch:{fertility:{exposureAssumed:'yes'}}}],
  ['edit',{operation:'update_daily_weather',patch:{mode:'hourly',hours:[{hour:1.5,temperatureC:30,relativeHumidityPct:50,solarRoofWm2:0}]}}],
  ['edit',{operation:'unknown'}],
  ['edit',{operation:'copy_to_other',project:{}}],
  ['set_view',{sheet:'compare',metric:'milk'}],
  ['set_view',{sheet:'compare',timeSec:3601}],
  ['set_view',{sheet:'compare',flow:'false'}],
  ['get_state',null],
  ['undo',{extra:true}],
  ['compare_candidates',{candidates:[]}],
 ];
 for(const[name,args]of bad)await assert.rejects(()=>call(name,args),/must be|required|not allowed|unsupported|unknown|range|length/);
 assert.equal(store.serialize(),before);assert.deepEqual(sheets,[]);
});

test('existing baseline protection and pending-input errors propagate through WebMCP',async()=>{
 const{call,store}=await setup();
 await call('edit',{operation:'switch_scenario',scenarioId:'baseline'});
 const before=store.serialize();
 await assert.rejects(()=>call('edit',{operation:'update_roof',patch:{reflectance:0.8}}),/read.only|baseline/i);
 assert.equal(store.serialize(),before);
 const pending=await setup({status:()=>({pendingInput:true,invalidInput:false,calculating:false,workerError:null})});
 await assert.rejects(()=>pending.call('undo',{}),/Confirm/);
});

test('async tools serialize awaited data and preserve async errors',async()=>{
 const notifications=[],tools=[];
 const commands=Object.fromEntries(WEBMCP_TOOLS.map(t=>[t.name,async()=>({ok:true})]));
 commands.evaluate=async args=>({scenarioId:args.scenarioId});
 commands.compare_candidates=async()=>{throw Error('worker failed')};
 await startWebMcp({context:{registerTool:tool=>tools.push(tool)},commands,notify:(...args)=>notifications.push(args)});
 assert.deepEqual(JSON.parse(await tools.find(t=>t.name==='evaluate').execute({operations:[],scenarioId:'working-mist'})),{scenarioId:'working-mist'});
 await assert.rejects(()=>tools.find(t=>t.name==='compare_candidates').execute({candidates:[{id:'a',operations:[]}]}),/worker failed/);
});

test('unsupported browser leaves commands untouched and reports unavailable',async()=>{
 const statuses=[];
 await startWebMcp({commands:{},notify:(...args)=>statuses.push(args)});
 assert.equal(statuses.length,1);assert.equal(statuses[0][0],'unavailable');
});

test('registration failure cleans up successfully registered tools and reports error',async()=>{
 const removed=[],statuses=[];
 await startWebMcp({context:{registerTool:async tool=>{if(tool.name==='set_view')throw Error('registration denied')},unregisterTool:async name=>removed.push(name)},commands:{},notify:(...args)=>statuses.push(args)});
 assert.deepEqual(removed,['get_state','edit']);
 assert.equal(statuses[0][0],'error');assert.match(statuses[0][1],/registration denied/);
});
