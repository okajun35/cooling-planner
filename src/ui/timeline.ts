import type {Project,SimulationResult,PointSample} from '../domain/project.js';
import {selectedResults} from './panels.js';
import {num,el,setHTML} from './dom.js';
export type ChartMetric='qW'|'temperatureC'|'filmKg';
export function renderTimeline(p:Project,r:SimulationResult|null,metric:ChartMetric){
 const {point:q,baseline:b}=selectedResults(p,r),series=q?.series??[],base=b?.series??[];
 if(!series.length){setHTML('timeline-chart','<div class="chart-placeholder">計算結果を待っています…</div>');return}
 const values=[...series,...base].map(x=>x[metric]);let lo=Math.min(...values),hi=Math.max(...values);if(hi-lo<.1){lo-=metric==='qW'?25:metric==='filmKg'?.03:1;hi+=metric==='qW'?25:metric==='filmKg'?.03:1}else{const pad=(hi-lo)*.12;lo-=pad;hi+=pad}if(metric==='filmKg')lo=0;
 const w=700,h=142,L=49,R=18,T=12,B=26,x=(t:number)=>L+t/3600*(w-L-R),y=(v:number)=>T+(hi-v)/(hi-lo)*(h-T-B);
 const path=(ss:PointSample[])=>ss.map((s,i)=>`${i?'L':'M'}${x(s.timeSec).toFixed(2)},${y(s[metric]).toFixed(2)}`).join(' ');
 let grid='';for(let i=0;i<4;i++){const v=lo+(hi-lo)*i/3;grid+=`<line x1="${L}" x2="${w-R}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${num(v,metric==='qW'?0:metric==='filmKg'?2:1)}</text>`}
 for(let i=0;i<=6;i++)grid+=`<text x="${x(i*600)}" y="${h-5}" text-anchor="middle">${i*10}分</text>`;
 setHTML('timeline-chart',`<div class="chart-legend"><span><i class="before"></i>基準案</span><span><i class="after"></i>選択案</span><b>${metric==='qW'?'代表表面の放熱量 (W)':metric==='temperatureC'?'局所気温 (℃)':'牛体の保持水 (kg)'}</b></div><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="選択地点の60分間の${metric==='qW'?'放熱量':metric==='temperatureC'?'気温':'保持水'}。基準と編集案の比較">${grid}<path d="${path(base)}" class="line-before"/><path d="${path(series)}" class="line-after"/><line id="chart-playhead" x1="${x(p.view.timeSec)}" x2="${x(p.view.timeSec)}" y1="${T}" y2="${h-B}" class="playhead"/></svg>`);
}
export function updateTime(p:Project,r:SimulationResult|null){
 const time=p.view.timeSec;el<HTMLInputElement>('time-slider').value=String(time);el('time-display').textContent=`${Math.floor(time/60).toString().padStart(2,'0')}:${Math.floor(time%60).toString().padStart(2,'0')}`;
 const line=document.getElementById('chart-playhead'),x=49+time/3600*(700-49-18);line?.setAttribute('x1',String(x));line?.setAttribute('x2',String(x));
 const {point:q}=selectedResults(p,r);if(!q?.series.length){el('scene-live').textContent='';return}
 // Sample nearest to selected display time only; model input is never snapped or altered.
 const sample=q.series.reduce((a,b)=>Math.abs(b.timeSec-time)<Math.abs(a.timeSec-time)?b:a);
 el('scene-live').innerHTML=`<small>時系列サンプル ${Math.floor(sample.timeSec/60)}分${Math.round(sample.timeSec%60)}秒</small><strong>放熱量 ${num(sample.qW,0)} W</strong><span>保持水 ${num(sample.filmKg,2)} kg</span>`;
}
