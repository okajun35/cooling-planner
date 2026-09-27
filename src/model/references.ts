import type {MilkReference,FertilityReference,ReferenceSettings} from '../domain/project.js';

/** Literal COWBELL No.178 table: NEVER interpolate, round or extrapolate. */
export const MILK_ROWS = [
  {temperatureC:27,speedMps:.18,ratioPct:85}, {temperatureC:27,speedMps:2.24,ratioPct:95},
  {temperatureC:27,speedMps:4.02,ratioPct:95}, {temperatureC:35,speedMps:.18,ratioPct:63},
  {temperatureC:35,speedMps:2.24,ratioPct:79}, {temperatureC:35,speedMps:4.02,ratioPct:79},
] as const;
export function milkReference(t:number,rh:number,v:number,baseline:number|null,staticInputs=true):MilkReference {
  if(![t,rh,v].every(Number.isFinite)||rh<0||rh>100||v<0||baseline!==null&&(!Number.isFinite(baseline)||baseline<0))
    return {status:'invalid_input',ratioPct:null,kgPerDay:null,reasons:['入力を確認してください']};
  const reasons:string[]=[];
  if(!staticInputs)reasons.push('時間変動する条件は対象外');
  if(![27,35].some(x=>Math.abs(x-t)<=1e-9))reasons.push('気温は27℃・35℃のみ');
  if(![.18,2.24,4.02].some(x=>Math.abs(x-v)<=1e-9))reasons.push('風速は0.18・2.24・4.02m/sのみ');
  if(rh<60||rh>70)reasons.push('湿度は60〜70%のみ');
  const row=MILK_ROWS.find(x=>Math.abs(x.temperatureC-t)<=1e-9&&Math.abs(x.speedMps-v)<=1e-9);
  if(reasons.length||!row)return {status:'out_of_scope',ratioPct:null,kgPerDay:null,reasons};
  return {status:'available',ratioPct:row.ratioPct,kgPerDay:baseline===null?null:baseline*row.ratioPct/100,reasons:[]};
}
/** Baccouri et al. 2025, Table 2. Preserve all reported coefficients, not just significant ones. */
export const FERTILITY_OR=[
  [1,.823,.697,.773], [1,.973,.913,1.005], [1,.926,.887,.693],
  [1,.941,.935,.922], [1,1.058,.941,.854],
] as const;
export const FERTILITY_CATEGORIES=['基準区分','軽度区分','中等度区分','高暑熱区分'];
export const fertilityTHI=(t:number,rh:number)=>(1.8*t+32)-(.55-.55*rh/100)*(1.8*t-26);
export function categoryOfTHI(thi:number){return thi<60?0:thi<68?1:thi<72?2:3}
export function fertilityByPeriods(ths:readonly number[],p0:number){
  if(ths.length!==5||!ths.every(Number.isFinite)||!Number.isFinite(p0)||p0<=0||p0>=1)throw Error('受胎シナリオの入力が不正です');
  const oddsRatio=ths.reduce((r,thi,i)=>r*FERTILITY_OR[i][categoryOfTHI(thi)],1);
  return {oddsRatio,probability:p0*oddsRatio/(1-p0+p0*oddsRatio)};
}
export function fertilityReference(settings:ReferenceSettings['fertility'],localT:number|null,localRH:number|null):FertilityReference{
  const blank={probability:null,oddsRatio:null,thi:null,category:null,source:settings.mode,exposureAssumed:settings.exposureAssumed};
  if(!settings.exposureAssumed)return {...blank,status:'out_of_scope',reasons:['授精前後52日間の代表条件の仮定が未採用です']};
  const t=settings.mode==='manual'?settings.temperatureC:localT,rh=settings.mode==='manual'?settings.relativeHumidityPct:localRH;
  if(t===null||rh===null)return {...blank,status:'out_of_scope',reasons:['地点の計算が無効です']};
  if(![t,rh,settings.p0].every(Number.isFinite)||rh<0||rh>100||settings.p0<=0||settings.p0>=1)return {...blank,status:'invalid_input',reasons:['受胎シナリオの入力が不正です']};
  const thi=fertilityTHI(t,rh),cat=categoryOfTHI(thi),calculation=fertilityByPeriods([thi,thi,thi,thi,thi],settings.p0);
  return {...blank,...calculation,thi,category:FERTILITY_CATEGORIES[cat],status:'available_reference',reasons:[]};
}
