import type {PointResult} from '../domain/project.js';
import type {AreaGroup} from '../template/faces.js';
import {areaStats,hasDeficit,noLocalAction} from './areaStats.js';

/** Display diagnostics only. A reduction compares accumulated deficits, not mean Q.
 * The epsilon is a numerical-zero guard, never a biological adequacy threshold. */
export function comparisonStats(points:readonly PointResult[],baseline:readonly PointResult[],area:Pick<AreaGroup,'id'|'label'|'probeIds'>){
 const stats=areaStats(points,area),base=areaStats(baseline,area);
 const reduction=(q:PointResult)=>{
  const b=baseline.find(b=>b.probeId===q.probeId);
  return q.status==='valid'&&q.meanDeficitW!=null&&b?.status==='valid'&&b.meanDeficitW!=null?b.meanDeficitW-q.meanDeficitW:null;
 };
 const remaining=points.filter(q=>area.probeIds.includes(q.probeId)&&q.status==='valid'&&hasDeficit(q));
 const comparable=stats.meanDeficitW!==null&&base.meanDeficitW!==null;
 return {...stats,
  maxDeficitW:stats.meanDeficitW===null?null:stats.maxDeficitW,
  deficitReductionW:comparable?base.meanDeficitW!-stats.meanDeficitW!:null,
  unchangedOrWorseDeficitCount:comparable?remaining.filter(q=>reduction(q)!<=1e-6).length:null,
  worsenedDeficitCount:comparable?points.filter(q=>area.probeIds.includes(q.probeId)&&reduction(q)! < -1e-6).length:null,
  topRemaining:[...remaining].sort((a,b)=>b.meanDeficitW!-a.meanDeficitW!||a.probeId.localeCompare(b.probeId)).slice(0,3).map(q=>({probeId:q.probeId,deficitW:q.meanDeficitW!,deficitReductionW:reduction(q),noLocalAction:noLocalAction(q)})),
 };
}
