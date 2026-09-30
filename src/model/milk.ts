import type {MilkSimulation,Probe} from '../domain/project.js';

export const MILK_MODEL_ID='milk-heat-deficit-v0.1' as const;
/** Spec v0.1 demo assumptions. These are hypothesis placeholders, not fitted values. */
export const DEFAULT_MILK_SIMULATION:MilkSimulation={
  modelId:MILK_MODEL_ID,
  mode:'repeated-day',
  weatherMode:'constant-environment',
  operationPolicy:'daily-window-reset-v1',
  potentialMilkKgPerCowDay:40,
  referenceCoolingWPerCow:630,
  responseKgPerCowDayPerW:0.010,
  maxLossFraction:0.25,
  lagWeights:[0.2,0.5,0.3],
  occupancyFractions:{stall:14/24,feeding:6/24,waiting:4/24},
  responseSensitivityKgPerCowDayPerW:[0.005,0.010,0.015],
  warmupDurationSec:86400,evaluationDurationSec:86400,timeStepSec:1,
  assumptionClass:'demo_assumption'
};

/** Per-point heat deficit against the fixed reference cooling rate. Q>Qref counts as 0, never negative. */
export const deficitW=(qW:number,referenceCoolingWPerCow:number)=>Math.max(0,referenceCoolingWPerCow-qW);

export type MilkZone='stall'|'feeding'|'waiting';
const MILK_ZONES:MilkZone[]=['stall','feeding','waiting'];
/**
 * Herd occupancy distribution over evaluation points. Each zone's fraction is split
 * evenly across its probes; a missing zone or unknown kind is an error — never renormalise.
 */
export function occupancyWeights(probes:readonly Pick<Probe,'id'|'kind'>[],fractions:MilkSimulation['occupancyFractions']):
  {weights:Map<string,number>;counts:Record<MilkZone,number>}|{error:string}{
  if(!MILK_ZONES.every(k=>Number.isFinite(fractions[k])&&fractions[k]>=0))return {error:'invalid zone occupancy fractions'};
  const sum=MILK_ZONES.reduce((a,k)=>a+fractions[k],0);
  if(Math.abs(sum-1)>1e-9)return {error:'zone occupancy fractions do not sum to 1'};
  const counts:Record<MilkZone,number>={stall:0,feeding:0,waiting:0};
  for(const q of probes){
    if(!MILK_ZONES.includes(q.kind as MilkZone))return {error:`evaluation point ${q.id} has no zone mapping`};
    counts[q.kind as MilkZone]++;
  }
  for(const k of MILK_ZONES)if(counts[k]===0&&fractions[k]>0)return {error:'no evaluation points exist for a zone with nonzero occupancy'};
  const weights=new Map<string,number>();
  for(const q of probes)weights.set(q.id,fractions[q.kind as MilkZone]/counts[q.kind as MilkZone]);
  return {weights,counts};
}

/** Lagged deficit: E = w0*D[d] + w1*D[d-1] + w2*D[d-2]. Weights are ordered today-first. */
export const laggedDeficit=(d0:number,d1:number,d2:number,w:readonly[number,number,number])=>w[0]*d0+w[1]*d1+w[2]*d2;

/** Loss and yield from a lagged deficit. L = min(Y0*rmax, beta*E); Y = Y0 - L. */
export function milkFromDeficit(laggedDeficitWPerCow:number,s:MilkSimulation){
  const cap=s.potentialMilkKgPerCowDay*s.maxLossFraction,raw=s.responseKgPerCowDayPerW*laggedDeficitWPerCow;
  const lossKgPerCowDay=Math.min(cap,Math.max(0,raw));
  return {lossKgPerCowDay,yieldKgPerCowDay:s.potentialMilkKgPerCowDay-lossKgPerCowDay,lossCapped:raw>=cap};
}

/** Repeated-day mode: the evaluation-day deficit stands in for the past two days, so E = D. */
export function dailyFromDeficit(dailyDeficitWPerCow:number,s:MilkSimulation){
  const lagged=laggedDeficit(dailyDeficitWPerCow,dailyDeficitWPerCow,dailyDeficitWPerCow,s.lagWeights);
  return {dailyDeficitWPerCow,laggedDeficitWPerCow:lagged,...milkFromDeficit(lagged,s)};
}

/** Sensitivity over the fixed three beta assumptions; all scenarios share the same set. */
export function sensitivityYields(dailyDeficitWPerCow:number,s:MilkSimulation){
  return s.responseSensitivityKgPerCowDayPerW.map(beta=>({beta,...milkFromDeficit(laggedDeficit(dailyDeficitWPerCow,dailyDeficitWPerCow,dailyDeficitWPerCow,s.lagWeights),{...s,responseKgPerCowDayPerW:beta})}));
}

export const deltaYield=(a:{yieldKgPerCowDay:number}|null|undefined,b:{yieldKgPerCowDay:number}|null|undefined)=>
  a&&b?a.yieldKgPerCowDay-b.yieldKgPerCowDay:null;

/** Settings validation for the v0.1 contract. Returns reasons; empty means usable. Never repairs values. */
export function validateMilkSettings(m:MilkSimulation):string[]{
  const r:string[]=[];
  if(m.modelId!==MILK_MODEL_ID)r.push('unsupported milk model ID');
  if(m.mode!=='repeated-day')r.push('the time mode only supports a repeating representative day');
  if(m.weatherMode!=='constant-environment'&&m.weatherMode!=='hourly-representative-day')r.push('unsupported weather mode');
  if(m.operationPolicy!=='daily-window-reset-v1')r.push('unsupported operation policy');
  if(m.assumptionClass!=='demo_assumption')r.push('invalid assumption class');
  if(!Number.isFinite(m.potentialMilkKgPerCowDay)||m.potentialMilkKgPerCowDay<=0)r.push('baseline daily milk must be a positive finite value');
  if(!Number.isFinite(m.referenceCoolingWPerCow)||m.referenceCoolingWPerCow<0)r.push('reference cooling must be a non-negative finite value');
  if(!Number.isFinite(m.responseKgPerCowDayPerW)||m.responseKgPerCowDayPerW<0)r.push('the response coefficient must be a non-negative finite value');
  if(!Number.isFinite(m.maxLossFraction)||m.maxLossFraction<0||m.maxLossFraction>1)r.push('max loss fraction must be 0–1');
  const w=m.lagWeights;
  if(!Array.isArray(w)||w.length!==3||!w.every(x=>Number.isFinite(x)&&x>=0))r.push('lag weights must be 3 non-negative elements');
  else if(Math.abs(w[0]+w[1]+w[2]-1)>1e-9)r.push('lag weights do not sum to 1');
  const o=m.occupancyFractions;
  if(!o||typeof o!=='object'||!MILK_ZONES.every(k=>Number.isFinite(o[k])&&o[k]>=0))r.push('occupancy fractions must cover 3 non-negative zones');
  else if(Math.abs(o.stall+o.feeding+o.waiting-1)>1e-9)r.push('zone occupancy fractions do not sum to 1');
  const b=m.responseSensitivityKgPerCowDayPerW;
  if(!Array.isArray(b)||b.length!==3||!b.every(x=>Number.isFinite(x)&&x>=0))r.push('sensitivity comparison requires 3 non-negative betas');
  if(m.warmupDurationSec!==86400||m.evaluationDurationSec!==86400)r.push('warmup and evaluation must each be 86400 s');
  if(m.timeStepSec!==1)r.push('the daily calculation time step is 1 s only');
  return r;
}
