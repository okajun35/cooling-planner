import type {ScenarioResult} from '../domain/project.js';

/** Constrained candidate comparison (単位C): the LLM builds a few candidates and
 * this module supplies the numbers, constraint verdicts and a transparent order.
 * No opaque weighted score — ordering keys are fixed per ranking mode. */

export const EPS=1e-6;

export interface CandidateConstraints{
 maxWaterLPerDay?:number;
 maxElectricityKwhPerDay?:number;
 /** 'stalls'|'feeding'|'waiting'|'all' — area ids from buildAreas, 'all' = whole barn. */
 priorityArea:string;
 /** Area ids whose day mean deficit must not rise vs the start scenario. */
 protectAreas:string[];
 /** When true, the barn-wide max day deficit must not rise vs the start scenario. */
 protectWorst:boolean;
}
export type RankingMode='deficit'|'water'|'worst';

/** Day-scale summary of one scenario result, used for constraint checks. */
export interface CandidateSummary{
 status:'complete'|'invalid_input'|'calculation_error'|'missing';
 /** Cooling supply only (soaker+mist+roof); drinking/cleaning water excluded. */
 coolingWaterLPerDay:number|null;
 electricityKwhPerDay:number|null;
 /** id -> mean day deficit [W]; 'all' is the whole-barn simple mean. null = not evaluable. */
 areaMean:Record<string,number|null>;
 allMax:number|null;
 /** Points whose day deficit worsened vs the start scenario. Null when incomparable. */
 worsenedPoints:number|null;
 valid:boolean;
 reasons:string[];
}

export function summarizeDay(r:ScenarioResult|undefined):CandidateSummary{
 const t=r?.dailyThermal;
 if(!r||!t)return {status:'missing',coolingWaterLPerDay:null,electricityKwhPerDay:null,areaMean:{},allMax:null,worsenedPoints:null,valid:false,reasons:['日結果がありません']};
 const areaMean:Record<string,number|null>={};
 for(const a of t.areas)areaMean[a.id]=a.meanDeficitW;
 areaMean.all=t.all?.meanDeficitW??null;
 return{status:t.status,coolingWaterLPerDay:t.resources?.waterLPerDay??null,electricityKwhPerDay:t.resources?.totalKwhPerDay??null,
  areaMean,allMax:t.all?.maxDeficitW??null,
  worsenedPoints:null,valid:t.status==='complete'&&t.all?.meanDeficitW!=null,reasons:t.reasons};
}

/** Points-map accessor kept separate so the serializable summary stays flat. */
export function worsenedCount(r:ScenarioResult|undefined,start:ScenarioResult|undefined):number|null{
 const a=r?.dailyThermal?.points,b=start?.dailyThermal?.points;
 if(!a||!b)return null;
 const base=new Map(b.map(q=>[q.probeId,q.meanDeficitW]));
 let n=0;for(const q of a)if(q.meanDeficitW>(base.get(q.probeId)??0)+EPS)n++;
 return n;
}

export function checkConstraints(c:CandidateSummary,start:CandidateSummary,k:CandidateConstraints):string[]{
 const v:string[]=[];
 if(!c.valid)return['日計算が未評価です（0不足・0消費にはしません）'];
 if(k.maxWaterLPerDay!=null&&(c.coolingWaterLPerDay??Infinity)>k.maxWaterLPerDay+EPS)v.push(`冷却水 ${c.coolingWaterLPerDay} L/日が上限 ${k.maxWaterLPerDay} を超過`);
 if(k.maxElectricityKwhPerDay!=null&&(c.electricityKwhPerDay??Infinity)>k.maxElectricityKwhPerDay+EPS)v.push(`電力 ${c.electricityKwhPerDay} kWh/日が上限 ${k.maxElectricityKwhPerDay} を超過`);
 if(k.protectAreas.length||k.protectWorst){
  if(!start.valid)v.push('開始案の日結果が未評価のため保護条件を確認できません');
  else{
   for(const a of k.protectAreas){
    const cm=c.areaMean[a],sm=start.areaMean[a];
    if(cm==null||sm==null)v.push(`保護区域 ${a} の日結果が未評価のため比較不可`);
    else if(cm>sm+EPS)v.push(`保護区域 ${a} の日平均不足が開始案より増加（${sm}→${cm} W）`);
   }
   if(k.protectWorst){
    if(c.allMax==null||start.allMax==null)v.push('全地点の最大不足が未評価のため比較不可');
    else if(c.allMax>start.allMax+EPS)v.push(`全地点の最大不足が開始案より増加（${start.allMax}→${c.allMax} W）`);
   }
  }
 }
 return v;
}

export function improvesPriorityArea(c:CandidateSummary,start:CandidateSummary,priorityArea:string):boolean{
 const cm=c.areaMean[priorityArea],sm=start.areaMean[priorityArea];
 return cm!=null&&sm!=null&&cm<sm-EPS;
}

/** The fields ranking needs — CandidateSummary satisfies this structurally. */
export interface Rankable{areaMean:Record<string,number|null>;allMax:number|null;coolingWaterLPerDay:number|null;electricityKwhPerDay:number|null}
/** Deterministic ordering; returns candidate ids best-first. Only called on
 * constraint-satisfying candidates. Ties fall back to candidate id. */
export function rankCandidates(entries:{id:string;s:Rankable;improves:boolean}[],priorityArea:string,mode:RankingMode):string[]{
 const val=(s:Rankable,k:'priority'|'allMax'|'water'|'kwh')=>
  k==='priority'?(s.areaMean[priorityArea]??Infinity):k==='allMax'?(s.allMax??Infinity):k==='water'?(s.coolingWaterLPerDay??Infinity):(s.electricityKwhPerDay??Infinity);
 const pool=mode==='water'?entries.filter(e=>e.improves):entries;
 const keys:Record<RankingMode,('priority'|'allMax'|'water'|'kwh')[]>={
  deficit:['priority','allMax','water','kwh'],
  water:['water','priority','kwh'],
  worst:['allMax','priority','water','kwh'],
 };
 return [...pool].sort((a,b)=>{
  for(const k of keys[mode]){const d=val(a.s,k)-val(b.s,k);if(Math.abs(d)>EPS)return d}
  return a.id.localeCompare(b.id);
 }).map(e=>e.id);
}
