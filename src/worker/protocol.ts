import type {Project,SimulationResult} from '../domain/project.js';
export interface Job {jobId:number;inputHash:string;project:Project}
export type Reply={jobId:number;inputHash:string;result:SimulationResult}|{jobId:number;inputHash:string;error:string};
export class ResultGate{private jobId=0;private hash='';expect(hash:string){this.hash=hash;return ++this.jobId}accepts(r:{jobId:number;inputHash:string}){return r.jobId===this.jobId&&r.inputHash===this.hash}get expectedHash(){return this.hash}}
