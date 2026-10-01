import type {Project,SimulationResult,PointResult} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {buildAreas} from '../template/faces.js';
import {comparisonStats} from '../model/comparisonStats.js';
import {hasDeficit,noLocalAction} from '../model/areaStats.js';
import {esc,num,signed} from './dom.js';

const watts=(v:number|null|undefined)=>v==null?'N/A':`${num(v,0)} W`;
const count=(v:number|null|undefined)=>v==null?'N/A':String(v);
const reduction=(v:number|null|undefined)=>v==null?'N/A':`${signed(v,0)} W`;

export function comparisonContent(p:Project,r:SimulationResult|null){
 const l=buildLayout(p.template),areas=buildAreas(l),base=r?.scenarios.find(s=>s.id===p.baselineScenarioId);
 const cards=p.scenarios.map(sc=>{
  const s=r?.scenarios.find(s=>s.id===sc.id),stats=s?comparisonStats(s.points,base?.points??[],{id:'all',label:'All points',probeIds:l.probes.map(q=>q.id)}):null;
  const res=s?.dailyMilk?.resources,baseRes=base?.dailyMilk?.resources;
  const areaLines=['stalls','feeding','waiting'].map(id=>{
   const a=areas.find(a=>a.id===id)!,st=s?comparisonStats(s.points,base?.points??[],a):null;
   return `<tr><th>${esc(a.label.replace(' (subtotal)',''))}</th><td>${watts(st?.meanDeficitW)}</td><td>${watts(st?.maxDeficitW)}</td></tr>`;
  }).join('');
  return `<article class="comparison-card ${sc.id===p.activeScenarioId?'active':''}" data-comparison="${sc.id}"><h3><button data-scenario="${sc.id}">${esc(sc.name)}${sc.id===p.activeScenarioId?' (selected)':' — view'}</button></h3>
   <div><strong>${stats?.meanDeficitW==null?'N/A':num(stats.meanDeficitW,0)}</strong><small> W mean cooling deficit</small></div>
   <p>Deficit reduction vs baseline <b>${reduction(stats?.deficitReductionW)}</b><br>Worst deficit <b>${watts(stats?.maxDeficitW)}</b><br>Points with remaining deficit <b>${stats?.meanDeficitW==null?'N/A':`${stats.deficitCount}/${stats.probeCount}`}</b><br>No local action <b>${stats?.meanDeficitW==null?'N/A':stats.deficitNoActionCount}</b> points<br>Deficit not reduced <b>${count(stats?.unchangedOrWorseDeficitCount)}</b> points / deficit increased <b>${count(stats?.worsenedDeficitCount)}</b> points</p>
   <table class="micro-table"><thead><tr><th>Area</th><th>Mean deficit</th><th>Max deficit</th></tr></thead><tbody>${areaLines}</tbody></table>
   <p>Water <b>${res?num(res.waterLPerDay,0)+' L/day':'Not calculated'}</b>${res&&baseRes?` (Δ ${signed(res.waterLPerDay-baseRes.waterLPerDay,0)})`:''}<br>Energy use <b>${res?num(res.totalKwhPerDay,1)+' kWh/day':'Not calculated'}</b>${res&&baseRes?` (Δ ${signed(res.totalKwhPerDay-baseRes.totalKwhPerDay,1)})`:''}<br>Daily point-mean deficit <b>${watts(s?.dailyThermal?.all?.meanDeficitW)}</b>${s?.dailyThermal?` (max ${watts(s.dailyThermal.all?.maxDeficitW)} · ${s.dailyThermal.weatherMode==='hourly'?'hourly':'fixed'} weather)`:''}</p>
   <span class="micro">${sc.roof.reflectance>.5?'Reflective coating':'No coating'} / ${sc.roof.insulationM>0?'Insulated':'No insulation'}</span></article>`;
 }).join('');
 const active=r?.scenarios.find(s=>s.id===p.activeScenarioId);
 const st=active?comparisonStats(active.points,base?.points??[],{id:'all',label:'All points',probeIds:l.probes.map(q=>q.id)}):null;
 const worst=st?.topRemaining.map(q=>`<li><button class="text-button" data-inspect-probe="${esc(q.probeId)}">${esc(l.probes.find(p=>p.id===q.probeId)?.label??q.probeId)}: deficit ${watts(q.deficitW)}</button> · reduced vs baseline ${reduction(q.deficitReductionW)}${q.noLocalAction?' · no local action':''}</li>`).join('');
 return `<div class="comparison-toolbar"><button data-action="copy-scenario" id="copy-scenario">Copy to other draft</button><button data-action="reset-active" id="reset-active">Reset to baseline</button><button data-action="paste-project">Import MCP scenario JSON</button></div>
  <div class="comparison-grid">${cards}</div>
  <div class="assumption-box" id="remaining-deficits"><strong>Highest cooling-deficit locations in the selected scenario</strong>${worst?`<ol>${worst}</ol>`:'<p>No deficit points, or not evaluated.</p>'}${st&&st.invalidCount?`<p>${st.invalidCount}/${st.probeCount} points not evaluated. Top entries cover evaluated points only.</p>`:''}</div>
  <p class="micro">Deficits and areas are 60-min representative-point means under fixed weather. Means are simple averages over 70 points — not weighted by headcount or occupancy time. "Max" is the largest per-point 60-min mean deficit. "Reduction" is baseline deficit − scenario deficit (positive = improvement). "Not reduced" means a point still has a deficit that is no smaller than baseline. "No local action" is a diagnostic that fan, soaker and mist have no effect there; it excludes roof measures.</p>
  <p class="micro">Water and energy use integrate 24-hour operation on a separate evaluation day. The 60-min deficit and daily resources cover different aggregation windows, and do not identify an all-day optimum. Milk, conception and running cost are under the reference tab.</p>`;
}

export function areaContent(p:Project,r:SimulationResult|null){
 const l=buildLayout(p.template),s=r?.scenarios.find(s=>s.id===p.activeScenarioId),base=r?.scenarios.find(s=>s.id===p.baselineScenarioId);
 if(!s)return '<p class="micro">Waiting for calculation</p>';
 const rows=buildAreas(l).map(a=>{
  const st=comparisonStats(s.points,base?.points??[],a);
  return `<tr data-area="${esc(a.id)}" class="${p.view.selectedAreaId===a.id?'selected':''}${a.subtotal?' subtotal':''}"><th>${esc(a.label)}</th><td>${watts(st.meanDeficitW)}</td><td>${watts(st.maxDeficitW)}</td><td>${reduction(st.deficitReductionW)}</td><td>${st.meanDeficitW===null?'N/A':`${st.deficitCount}/${st.probeCount}`}</td><td>${count(st.unchangedOrWorseDeficitCount)}</td><td>${st.meanDeficitW===null?'N/A':st.deficitNoActionCount}</td><td>${st.topRemaining.map(q=>`<button class="text-button" data-inspect-probe="${esc(q.probeId)}">${esc(l.probes.find(p=>p.id===q.probeId)?.label??q.probeId)} ${watts(q.deficitW)}</button>`).join('<br>')||'—'}</td></tr>`;
 }).join('');
 return `<div class="table-scroll"><table class="area-table"><thead><tr><th>Area</th><th>Mean deficit</th><th>Max deficit</th><th>Deficit reduction</th><th>Deficit points</th><th>Not reduced</th><th>No local action</th><th>Top 3 deficits (inspect)</th></tr></thead><tbody>${rows}</tbody></table></div><p class="micro">Click a row to highlight the area; the top-point buttons show location and heat-loss breakdown. Deficit is the 60-min mean of per-second integration against Qref; max is across points. Reduction = baseline − scenario. "Not reduced" means a point still has a deficit that is no smaller than baseline. "No local action" means a deficit remains while fan, soaker and mist have no action there; roof effects are excluded. Means are simple averages of representative points. If even one point is invalid, the mean/max/counts are N/A and top entries cover evaluated points only.</p>`;
}

export function heatExplanation(q:PointResult|undefined,b:PointResult|undefined){
 if(q?.status!=='valid'||!q.components)return '';
 const names={convectionW:'Convection',radiationW:'Radiation',baseEvaporationW:'Base evaporation',soakerEvaporationW:'Soaker evaporation',condensationW:'Condensation'} as const;
 const rows=Object.entries(names).map(([k,name])=>{
  const key=k as keyof typeof names,v=q.components![key],bv=b?.status==='valid'?b.components?.[key]:null;
  return `<tr><th>${name}</th><td>${watts(v)}</td><td>${bv==null?'N/A':signed(v-bv,0)+' W'}</td></tr>`;
 }).join('');
 const observations=[];
 if(hasDeficit(q))observations.push('Cooling deficit remains. Review the improvement and the remaining deficit together.');
 if(noLocalAction(q))observations.push('No local action from fans, soakers or mist. This diagnostic is separate from roof-measure improvement.');
 if(q.components.radiationW<0)observations.push('Radiation is negative heat loss: the surroundings still add heat.');
 if(q.components.convectionW<0)observations.push('Convection is negative heat loss: the air is adding heat.');
 if(q.film&&q.film.runoffKg>1e-6)observations.push(`${num(q.film.runoffKg,3)} kg of captured water ran off. Not all supplied water evaporates.`);
 return `<div class="assumption-box" id="heat-explanation"><strong>Heat-loss breakdown here vs baseline (60-min mean)</strong><table><thead><tr><th>Path</th><th>Scenario loss</th><th>vs baseline</th></tr></thead><tbody>${rows}</tbody></table>${observations.map(t=>`<p>${esc(t)}</p>`).join('')}<p>Positive is heat loss, negative is heat gain. Breakdown differences come from a simultaneous multi-device calculation, not independent per-device contributions.</p></div>`;
}
