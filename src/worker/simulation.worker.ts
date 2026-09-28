import {simulate,inputHash} from '../model/simulation.js';
import {simulateDaily} from '../model/dailySimulation.js';
import {validateProject} from '../domain/validation.js';
import type {Job,Reply} from './protocol.js';
const scope=globalThis as unknown as {onmessage:(e:MessageEvent<Job>)=>void;postMessage:(v:Reply)=>void};
scope.onmessage=(e)=>{
 const {jobId,inputHash:expected,project}=e.data;
 try{
  validateProject(project);if(inputHash(project)!==expected)throw Error('入力ハッシュ不一致');
  // Stage 1: existing 60-minute result. Stage 2: representative-day milk aggregation.
  scope.postMessage({jobId,inputHash:expected,kind:'thermal-result',result:simulate(project)});
  try{
   const daily=simulateDaily(project);
   scope.postMessage({jobId,inputHash:expected,kind:'daily-result',daily:daily.daily,dailyMilkStatus:daily.status==='error'?'error':'complete'});
  }catch{scope.postMessage({jobId,inputHash:expected,kind:'daily-result',daily:{},dailyMilkStatus:'error'})}
 }catch(err){scope.postMessage({jobId,inputHash:expected,kind:'error',error:err instanceof Error?err.message:String(err)})}
};
