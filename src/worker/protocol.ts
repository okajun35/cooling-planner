import type {Project,SimulationResult,DailyMilkResult} from '../domain/project.js';
export interface Job {jobId:number;inputHash:string;project:Project}
/** Staged replies: the 60-minute thermal result first, then the daily milk result.
 * Both share jobId+inputHash so the gate can reject stale messages at either stage. */
export type Reply=
 |{jobId:number;inputHash:string;kind:'thermal-result';result:SimulationResult}
 |{jobId:number;inputHash:string;kind:'daily-result';daily:Record<string,DailyMilkResult>;dailyMilkStatus:'complete'|'error'}
 |{jobId:number;inputHash:string;kind:'error';error:string};
export class ResultGate{private jobId=0;private hash='';expect(hash:string){this.hash=hash;return ++this.jobId}accepts(r:{jobId:number;inputHash:string}){return r.jobId===this.jobId&&r.inputHash===this.hash}get expectedHash(){return this.hash}}
