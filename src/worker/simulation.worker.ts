import {simulate,inputHash} from '../model/simulation.js';
import {validateProject} from '../domain/validation.js';
import type {Job,Reply} from './protocol.js';
const scope=globalThis as unknown as {onmessage:(e:MessageEvent<Job>)=>void;postMessage:(v:Reply)=>void};
scope.onmessage=(e)=>{const {jobId,inputHash:expected,project}=e.data;try{validateProject(project);if(inputHash(project)!==expected)throw Error('入力ハッシュ不一致');const result=simulate(project);scope.postMessage({jobId,inputHash:expected,result})}catch(err){scope.postMessage({jobId,inputHash:expected,error:err instanceof Error?err.message:String(err)})}};
