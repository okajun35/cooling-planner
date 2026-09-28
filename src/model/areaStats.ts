import type {PointResult} from '../domain/project.js';
import type {AreaGroup} from '../template/faces.js';

/** Display-only flags from area-cooling-visualization-v0.1. The tiny epsilons are
 * numerical-zero guards, never health or adequacy thresholds. */
export const hasDeficit=(q:Pick<PointResult,'meanDeficitW'>)=>q.meanDeficitW!=null&&q.meanDeficitW>1e-6;
export const noLocalAction=(q:Pick<PointResult,'fanActionFraction'|'soakerArrivalFraction'|'mistEvaporationActionFraction'>)=>(q.fanActionFraction??0)<=0&&(q.soakerArrivalFraction??0)<=0&&(q.mistEvaporationActionFraction??0)<=0;
export const deficitUnreached=(q:Pick<PointResult,'meanDeficitW'|'fanActionFraction'|'soakerArrivalFraction'|'mistEvaporationActionFraction'>)=>hasDeficit(q)&&noLocalAction(q);

export interface AreaStats {
  id:string;label:string;probeCount:number;validCount:number;invalidCount:number;
  meanDeficitW:number|null;meanImprovementW:number|null;
  meanSpeedMps:number|null;meanAirTemperatureC:number|null;meanRelativeHumidityPct:number|null;
  maxDeficitW:number|null;deficitCount:number;noActionCount:number;deficitNoActionCount:number;
  topDeficit:{probeId:string;value:number}[];
}

/**
 * Point-wise (unweighted) means over an area's representative points. If ANY member
 * is invalid the area mean is reported as unevaluated — never a silent partial mean.
 * The same applies per metric: a valid point whose metric is null (e.g. deltaQrefW
 * when the baseline is unevaluated) makes that area mean null rather than a silent zero.
 * These are layout diagnostics, not herd or occupancy-weighted averages.
 */
export function areaStats(points:readonly PointResult[],area:Pick<AreaGroup,'id'|'label'|'probeIds'>):AreaStats{
  const members=area.probeIds.map(id=>points.find(q=>q.probeId===id));
  const valid=members.filter((q):q is PointResult=>!!q&&q.status==='valid');
  const allValid=valid.length===area.probeIds.length;
  const mean=(f:(q:PointResult)=>number|null)=>allValid&&valid.every(q=>f(q)!==null)?valid.reduce((a,q)=>a+(f(q) as number),0)/valid.length:null;
  return {
    id:area.id,label:area.label,probeCount:area.probeIds.length,validCount:valid.length,invalidCount:area.probeIds.length-valid.length,
    meanDeficitW:mean(q=>q.meanDeficitW),meanImprovementW:mean(q=>q.deltaQrefW),
    meanSpeedMps:mean(q=>q.meanSpeedMps),meanAirTemperatureC:mean(q=>q.meanAirTemperatureC),meanRelativeHumidityPct:mean(q=>q.meanRelativeHumidityPct),
    maxDeficitW:valid.length?Math.max(...valid.map(q=>q.meanDeficitW??0)):null,
    deficitCount:valid.filter(hasDeficit).length,noActionCount:valid.filter(noLocalAction).length,deficitNoActionCount:valid.filter(deficitUnreached).length,
    topDeficit:[...valid].sort((a,b)=>(b.meanDeficitW??0)-(a.meanDeficitW??0)||a.probeId.localeCompare(b.probeId)).filter(hasDeficit).slice(0,3).map(q=>({probeId:q.probeId,value:q.meanDeficitW!}))
  };
}
