import type {Project,SimulationResult,PointResult} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {buildAreas} from '../template/faces.js';
import {comparisonStats} from '../model/comparisonStats.js';
import {hasDeficit,noLocalAction} from '../model/areaStats.js';
import {esc,num,signed} from './dom.js';

const watts=(v:number|null|undefined)=>v==null?'未評価':`${num(v,0)} W`;
const count=(v:number|null|undefined)=>v==null?'未評価':String(v);
const reduction=(v:number|null|undefined)=>v==null?'比較不可':`${signed(v,0)} W`;

export function comparisonContent(p:Project,r:SimulationResult|null){
 const l=buildLayout(p.template),areas=buildAreas(l),base=r?.scenarios.find(s=>s.id===p.baselineScenarioId);
 const cards=p.scenarios.map(sc=>{
  const s=r?.scenarios.find(s=>s.id===sc.id),stats=s?comparisonStats(s.points,base?.points??[],{id:'all',label:'全地点',probeIds:l.probes.map(q=>q.id)}):null;
  const res=s?.dailyMilk?.resources,baseRes=base?.dailyMilk?.resources;
  const areaLines=['stalls','feeding','waiting'].map(id=>{
   const a=areas.find(a=>a.id===id)!,st=s?comparisonStats(s.points,base?.points??[],a):null;
   return `<tr><th>${esc(a.label.replace('（小計）',''))}</th><td>${watts(st?.meanDeficitW)}</td><td>${watts(st?.maxDeficitW)}</td></tr>`;
  }).join('');
  return `<article class="comparison-card ${sc.id===p.activeScenarioId?'active':''}" data-comparison="${sc.id}"><h3><button data-scenario="${sc.id}">${esc(sc.name)}${sc.id===p.activeScenarioId?'（選択中）':'で表示'}</button></h3>
   <div><strong>${stats?.meanDeficitW==null?'未評価':num(stats.meanDeficitW,0)}</strong><small> W 平均放熱不足</small></div>
   <p>基準から不足低減 <b>${reduction(stats?.deficitReductionW)}</b><br>最大の不足 <b>${watts(stats?.maxDeficitW)}</b><br>不足が残る地点 <b>${stats?.meanDeficitW==null?'未評価':`${stats.deficitCount}/${stats.probeCount}`}</b><br>局所作用なし <b>${stats?.meanDeficitW==null?'未評価':stats.deficitNoActionCount}</b> 地点<br>不足が減らず残る <b>${count(stats?.unchangedOrWorseDeficitCount)}</b> 地点 / 不足増加 <b>${count(stats?.worsenedDeficitCount)}</b> 地点</p>
   <table class="micro-table"><thead><tr><th>場所</th><th>平均不足</th><th>最大不足</th></tr></thead><tbody>${areaLines}</tbody></table>
   <p>水 <b>${res?num(res.waterLPerDay,0)+' L/日':'未計算'}</b>${res&&baseRes?`（差 ${signed(res.waterLPerDay-baseRes.waterLPerDay,0)}）`:''}<br>電力 <b>${res?num(res.totalKwhPerDay,1)+' kWh/日':'未計算'}</b>${res&&baseRes?`（差 ${signed(res.totalKwhPerDay-baseRes.totalKwhPerDay,1)}）`:''}</p>
   <span class="micro">${sc.roof.reflectance>.5?'遮熱あり':'遮熱なし'} / ${sc.roof.insulationM>0?'断熱あり':'断熱なし'}</span></article>`;
 }).join('');
 const active=r?.scenarios.find(s=>s.id===p.activeScenarioId);
 const st=active?comparisonStats(active.points,base?.points??[],{id:'all',label:'全地点',probeIds:l.probes.map(q=>q.id)}):null;
 const worst=st?.topRemaining.map(q=>`<li><button class="text-button" data-inspect-probe="${esc(q.probeId)}">${esc(l.probes.find(p=>p.id===q.probeId)?.label??q.probeId)}：不足 ${watts(q.deficitW)}</button> · 基準から低減 ${reduction(q.deficitReductionW)}${q.noLocalAction?' · 局所作用なし':''}</li>`).join('');
 return `<div class="comparison-toolbar"><button data-action="copy-scenario" id="copy-scenario">別案へコピー</button><button data-action="reset-active" id="reset-active">基準に戻す</button><button data-action="paste-project">MCP案のJSONを読込</button></div>
  <div class="comparison-grid">${cards}</div>
  <div class="assumption-box" id="remaining-deficits"><strong>選択案で不足が大きい場所</strong>${worst?`<ol>${worst}</ol>`:'<p>不足地点なし、または未評価です。</p>'}${st&&st.invalidCount?`<p>未評価 ${st.invalidCount}/${st.probeCount} 地点。上位は評価できた地点のみ。</p>`:''}</div>
  <p class="micro">不足・場所は固定気象60分の代表点平均。平均は70地点の単純平均で、頭数・滞在時間の重みではありません。最大は地点ごとの60分平均不足の最大です。不足低減は基準の不足−案の不足（正が改善）。「減らず残る」は不足があり、基準より不足が減っていない地点。「局所作用なし」は送風・牛体散水・ミストの作用がない診断で、屋根対策の効果は含みません。</p>
  <p class="micro">水・電力は別の評価日24時間の運転を積算。60分不足と日資源は集計期間が異なり、日全体の最適案を示すものではありません。乳量・受胎と運転費は参考影響タブで確認できます。</p>`;
}

export function areaContent(p:Project,r:SimulationResult|null){
 const l=buildLayout(p.template),s=r?.scenarios.find(s=>s.id===p.activeScenarioId),base=r?.scenarios.find(s=>s.id===p.baselineScenarioId);
 if(!s)return '<p class="micro">計算待ち</p>';
 const rows=buildAreas(l).map(a=>{
  const st=comparisonStats(s.points,base?.points??[],a);
  return `<tr data-area="${esc(a.id)}" class="${p.view.selectedAreaId===a.id?'selected':''}${a.subtotal?' subtotal':''}"><th>${esc(a.label)}</th><td>${watts(st.meanDeficitW)}</td><td>${watts(st.maxDeficitW)}</td><td>${reduction(st.deficitReductionW)}</td><td>${st.meanDeficitW===null?'未評価':`${st.deficitCount}/${st.probeCount}`}</td><td>${count(st.unchangedOrWorseDeficitCount)}</td><td>${st.meanDeficitW===null?'未評価':st.deficitNoActionCount}</td><td>${st.topRemaining.map(q=>`<button class="text-button" data-inspect-probe="${esc(q.probeId)}">${esc(l.probes.find(p=>p.id===q.probeId)?.label??q.probeId)} ${watts(q.deficitW)}</button>`).join('<br>')||'—'}</td></tr>`;
 }).join('');
 return `<div class="table-scroll"><table class="area-table"><thead><tr><th>エリア</th><th>平均不足</th><th>最大不足</th><th>不足低減</th><th>不足点</th><th>減らず残る</th><th>局所作用なし</th><th>不足上位3（地点を確認）</th></tr></thead><tbody>${rows}</tbody></table></div><p class="micro">行でエリアを強調、上位地点のボタンで場所・放熱内訳を確認。不足はQrefに対する秒積算の60分平均で、最大はその地点間の最大。低減は基準−案。「減らず残る」は不足があり基準より不足が減っていない地点。「局所作用なし」は不足があり送風・牛体散水・ミストの作用がない地点で、屋根効果は含みません。平均は代表点の単純平均。1点でも無効なら全体平均・最大・件数は未評価、上位は評価できた地点のみ。</p>`;
}

export function heatExplanation(q:PointResult|undefined,b:PointResult|undefined){
 if(q?.status!=='valid'||!q.components)return '';
 const names={convectionW:'対流',radiationW:'放射',baseEvaporationW:'通常蒸発',soakerEvaporationW:'牛体散水の蒸発',condensationW:'結露'} as const;
 const rows=Object.entries(names).map(([k,name])=>{
  const key=k as keyof typeof names,v=q.components![key],bv=b?.status==='valid'?b.components?.[key]:null;
  return `<tr><th>${name}</th><td>${watts(v)}</td><td>${bv==null?'比較不可':signed(v-bv,0)+' W'}</td></tr>`;
 }).join('');
 const observations=[];
 if(hasDeficit(q))observations.push('放熱不足が残っています。改善量と残る不足を一緒に確認してください。');
 if(noLocalAction(q))observations.push('送風・牛体散水・ミストの局所作用はありません。屋根対策の改善とは別の診断です。');
 if(q.components.radiationW<0)observations.push('放射は負の放熱：周囲から受ける熱が残っています。');
 if(q.components.convectionW<0)observations.push('対流は負の放熱：空気から熱を受けています。');
 if(q.film&&q.film.runoffKg>1e-6)observations.push(`捕水のうち ${num(q.film.runoffKg,3)} kg が流出。供給した水がすべて蒸発するわけではありません。`);
 return `<div class="assumption-box" id="heat-explanation"><strong>この場所の放熱内訳と基準差（60分平均）</strong><table><thead><tr><th>経路</th><th>案の放熱</th><th>基準との差</th></tr></thead><tbody>${rows}</tbody></table>${observations.map(t=>`<p>${esc(t)}</p>`).join('')}<p>正は放熱、負は受熱。内訳の差は複合設備を同時計算した結果で、設備別の独立した寄与ではありません。</p></div>`;
}
