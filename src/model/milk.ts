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
  if(!MILK_ZONES.every(k=>Number.isFinite(fractions[k])&&fractions[k]>=0))return {error:'区域の滞在割合が不正です'};
  const sum=MILK_ZONES.reduce((a,k)=>a+fractions[k],0);
  if(Math.abs(sum-1)>1e-9)return {error:'区域の滞在割合の合計が1ではありません'};
  const counts:Record<MilkZone,number>={stall:0,feeding:0,waiting:0};
  for(const q of probes){
    if(!MILK_ZONES.includes(q.kind as MilkZone))return {error:`評価地点 ${q.id} の区域対応がありません`};
    counts[q.kind as MilkZone]++;
  }
  for(const k of MILK_ZONES)if(counts[k]===0&&fractions[k]>0)return {error:'滞在割合に対応する評価地点がありません'};
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
  if(m.modelId!==MILK_MODEL_ID)r.push('乳量モデルIDが未対応です');
  if(m.mode!=='repeated-day')r.push('時間モードは代表日の繰り返しのみです');
  if(m.weatherMode!=='constant-environment')r.push('気象モードは固定気象のみです');
  if(m.operationPolicy!=='daily-window-reset-v1')r.push('運転ポリシーが未対応です');
  if(m.assumptionClass!=='demo_assumption')r.push('仮定の分類が不正です');
  if(!Number.isFinite(m.potentialMilkKgPerCowDay)||m.potentialMilkKgPerCowDay<=0)r.push('基準日乳量は正の有限値が必要です');
  if(!Number.isFinite(m.referenceCoolingWPerCow)||m.referenceCoolingWPerCow<0)r.push('基準放熱量は非負の有限値が必要です');
  if(!Number.isFinite(m.responseKgPerCowDayPerW)||m.responseKgPerCowDayPerW<0)r.push('換算係数は非負の有限値が必要です');
  if(!Number.isFinite(m.maxLossFraction)||m.maxLossFraction<0||m.maxLossFraction>1)r.push('低下上限率は0〜1が必要です');
  const w=m.lagWeights;
  if(!Array.isArray(w)||w.length!==3||!w.every(x=>Number.isFinite(x)&&x>=0))r.push('遅れの重みは非負の3要素が必要です');
  else if(Math.abs(w[0]+w[1]+w[2]-1)>1e-9)r.push('遅れの重みの合計が1ではありません');
  const o=m.occupancyFractions;
  if(!o||typeof o!=='object'||!MILK_ZONES.every(k=>Number.isFinite(o[k])&&o[k]>=0))r.push('区域の滞在割合は非負の3区域が必要です');
  else if(Math.abs(o.stall+o.feeding+o.waiting-1)>1e-9)r.push('区域の滞在割合の合計が1ではありません');
  const b=m.responseSensitivityKgPerCowDayPerW;
  if(!Array.isArray(b)||b.length!==3||!b.every(x=>Number.isFinite(x)&&x>=0))r.push('感度比較は非負の3条件が必要です');
  if(m.warmupDurationSec!==86400||m.evaluationDurationSec!==86400)r.push('準備・評価は各86400秒のみです');
  if(m.timeStepSec!==1)r.push('日計算の時間刻みは1秒のみです');
  return r;
}
