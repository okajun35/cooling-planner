import type {Project,SimulationResult,PointResult,ScenarioResult} from '../domain/project.js';
import {activeScenario,devices,isFan} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {thi} from '../model/physics.js';
import {MILK_ROWS,milkReference,fertilityReference,FERTILITY_OR} from '../model/references.js';
import {esc,num,signed,icon,field,toggle,setHTML,el} from './dom.js';
import {buildAreas} from '../template/faces.js';
import {areaStats,deficitUnreached} from '../model/areaStats.js';
import type {Workspace} from './workspaceState.js';

export function selectedResults(p:Project,r:SimulationResult|null){
 const scenario=r?.scenarios.find(s=>s.id===p.activeScenarioId),base=r?.scenarios.find(s=>s.id===p.baselineScenarioId);
 return {scenario,base,point:scenario?.points.find(q=>q.probeId===p.view.selectedProbeId),baseline:base?.points.find(q=>q.probeId===p.view.selectedProbeId)};
}

/** Header: scenario tabs + shared-weather chip + fixed-baseline notice. */
export function renderHeader(p:Project){
 const s=activeScenario(p),e=p.environment;
 setHTML('scenario-tabs',p.scenarios.map(sc=>`<button data-scenario="${sc.id}" class="${s.id===sc.id?'active':''}">${esc(sc.name)}${sc.readOnly?' <span class="lock">固定</span>':''}</button>`).join(''));
 setHTML('weather-chip',`${icon('sun',15)}<b>${num(e.temperatureC,0)}℃</b> / ${num(e.relativeHumidityPct,0)}%<small>THI ${num(thi(e.temperatureC,e.relativeHumidityPct))} · 全案共通</small>`);
 el('baseline-notice').hidden=!s.readOnly;
}

/** Top summary strip: selected-point deficit (60min) + scenario daily water/power. */
export function renderSummary(p:Project,r:SimulationResult|null){
 const {scenario:s,point:q}=selectedResults(p,r);
 const probe=buildLayout(p.template).probes.find(x=>x.id===p.view.selectedProbeId);
 el('sum-deficit-label').textContent=`${probe?.label??'—'} · 放熱不足（60分平均）`;
 const dv=el('sum-deficit-value');
 if(!r)dv.textContent='計算中…';
 else if(!q||q.status!=='valid'||q.meanDeficitW===null)dv.textContent='未評価';
 else dv.innerHTML=`${num(q.meanDeficitW,0)}<small> W</small>`;
 const dm=s?.dailyMilk,w=el('sum-water'),k=el('sum-power');
 if(!r||r.dailyMilkStatus==='pending'){w.textContent='計算中…';k.textContent='計算中…'}
 else if(dm?.status==='available'&&dm.resources){w.innerHTML=`${num(dm.resources.waterLPerDay,0)}<small> L/日</small>`;k.innerHTML=`${num(dm.resources.totalKwhPerDay,1)}<small> kWh/日</small>`}
 else{w.textContent='比較不可';k.textContent='比較不可'}
}

/** Weather panel: primary env fields (shared across scenarios). */
export function renderWeatherPanel(p:Project){
 setHTML('environment-fields',`${field('env-temperature','外気温',p.environment.temperatureC,'℃','data-env="temperatureC"',20,40,.5)}${field('env-humidity','相対湿度',p.environment.relativeHumidityPct,'%','data-env="relativeHumidityPct"',10,100,1)}${field('env-solar','屋根面日射',p.environment.solarRoofWm2,'W/m²','data-env="solarRoofWm2"',0,1200,50)}<div class="thi-badge"><small>外気THI</small><strong>${num(thi(p.environment.temperatureC,p.environment.relativeHumidityPct))}</strong></div>`);
 el('dimensions-label').textContent=`フリーストール / 50床 · ${p.template.lengthM} × ${p.template.widthM} m · 70評価点`;
}

/** Roof panel: whole-barn measures (existing toggles/details). */
export function renderRoofPanel(p:Project){
 const s=activeScenario(p),disabled=s.readOnly;
 setHTML('roof-controls',`
 ${toggle('roof-coating','遮熱塗装',`現在の日射反射率 ${num(s.roof.reflectance*100,0)}%`,s.roof.reflectance>.5,'data-roof-toggle="coating"','sun',disabled)}
 ${toggle('roof-insulation',`断熱材 ${num(s.roof.insulationM>0?s.roof.insulationM*1000:20,0)}mm`,'熱抵抗を追加する',s.roof.insulationM>0,'data-roof-toggle="insulation"','layers',disabled)}
 ${toggle('roof-spray','屋根散水',`${num(s.roof.onSec/60,1)}分ON / ${num(s.roof.offSec/60,1)}分OFF`,s.roof.sprayEnabled,'data-roof-toggle="sprayEnabled"','roof',disabled)}
 <details id="roof-details"><summary>屋根の詳細設定</summary><div class="field-grid">${field('roof-reflectance','日射反射率',s.roof.reflectance,'','data-roof="reflectance"',0,1,.05,disabled)}${field('roof-insulation-m','断熱材厚さ',s.roof.insulationM,'m','data-roof="insulationM"',0,.1,.01,disabled)}${field('roof-flow','散水量',s.roof.flowLpmM2,'L/分/m²','data-roof="flowLpmM2"',0,1,.01,disabled)}${field('roof-start','運転開始',s.roof.dailyStartHour,'時','data-roof="dailyStartHour"',0,23.75,.25,disabled)}${field('roof-hours','運転時間',s.roof.hoursPerDay,'h/日','data-roof="hoursPerDay"',0,24,1,disabled)}${field('roof-on','ON',s.roof.onSec/60,'分','data-roof="onSec" data-factor="60"',0,1440,1,disabled)}${field('roof-off','OFF',s.roof.offSec/60,'分','data-roof="offSec" data-factor="60"',0,1440,1,disabled)}</div><p class="micro">日運転は「運転開始＋運転時間」で繰り返します。上の60分結果は機器ONからの経過です。</p></details>
 ${disabled?'<p class="micro warn">基準案は固定です。下部の「編集案 A で試す」で編集案へ切り替えます。</p>':''}`);
}

/** Devices panel: per-system ON/OFF and the device picker. */
export function renderDevicesPanel(p:Project){
 const s=activeScenario(p),disabled=s.readOnly,soak=s.waterSystems.find(w=>w.kind==='soaker')!,mist=s.waterSystems.find(w=>w.kind==='mist')!;
 setHTML('system-controls',`
 ${toggle('fans-enabled','循環ファン',`${s.fans.filter(f=>f.enabled).length} / ${s.fans.length} 台が有効`,s.fans.some(f=>f.enabled),'data-all-fans','fan',disabled)}
 ${toggle('soaker-enabled','ソーカー',`${soak.nozzles.filter(n=>n.enabled).length}個 · 牛体を濡らす`,soak.enabled,`data-system-enabled="${soak.id}"`,'drop',disabled)}
 ${toggle('mist-enabled','ミスト',`${mist.nozzles.filter(n=>n.enabled).length}個 · 空気を冷やす`,mist.enabled,`data-system-enabled="${mist.id}"`,'mist',disabled)}`);
 setHTML('device-selector',`<label class="sr-only" for="device-select">編集する設備</label><select id="device-select"><option value="">設備を選択してください</option>${devices(s).map(d=>`<option value="${esc(d.id)}" ${p.view.selectedDeviceId===d.id?'selected':''}>${esc(d.label)}</option>`).join('')}</select>`);
}

/** Device editor: shown when a device is selected. */
export function renderDevicePanel(p:Project){
 const s=activeScenario(p),disabled=s.readOnly;
 const d=devices(s).find(d=>d.id===p.view.selectedDeviceId);
 if(!d){setHTML('device-properties',`<div class="empty-inspector">${icon('fan',30)}<p>牛舎の設備をクリック。<br>位置・向き・高さを変えて試します。</p><button data-action="select-first-fan" class="quiet">最初のファンを選択 →</button></div>`);return}
 const fan=isFan(d),sys=s.waterSystems.find(w=>w.nozzles.some(n=>n.id===d.id));
 setHTML('device-properties',`<div class="selected-device"><strong>${esc(d.label)}</strong><label><input type="checkbox" id="device-enabled" data-device-enabled ${d.enabled?'checked':''} ${disabled?'disabled':''}> 有効</label></div><div class="field-grid">
 ${field('device-x','長手 X',d.x,'m','data-device="x"',0,p.template.lengthM,.1,disabled)}${field('device-y','幅 Y',d.y,'m','data-device="y"',0,p.template.widthM,.1,disabled)}
 ${field('device-height','高さ',d.heightM,'m','data-device="heightM"',fan?d.diameterM/2:1.8,4,.1,disabled)}${field('device-yaw','向き',d.yawDeg,'°','data-device="yawDeg"',0,360,5,disabled)}${field('device-pitch','下向き角',d.pitchDownDeg,'°','data-device="pitchDownDeg"',fan?0:30,90,5,disabled)}
 ${fan?field('device-outlet','出口風速',d.outletSpeedMps,'m/s','data-device="outletSpeedMps"',0,30,.5,disabled):field('device-flow','ノズル流量',d.flowLpm,'L/分','data-device="flowLpm"',0,20,.1,disabled)}
 ${fan?field('device-hours','運転時間',d.hoursPerDay,'h/日','data-device="hoursPerDay"',0,24,1,disabled):field('device-angle','噴霧半角',d.halfAngleDeg,'°','data-device="halfAngleDeg"',1,85,5,disabled)}
 ${fan?field('device-start','日運転の開始',d.dailyStartHour,'時','data-device="dailyStartHour"',0,23.75,.25,disabled):''}
 </div>${sys?`<div class="section-label">系統全体の周期</div><div class="field-grid">${field('system-start','運転開始',sys.dailyStartHour,'時',`data-system="dailyStartHour" data-system-id="${sys.id}"`,0,23.75,.25,disabled)}${field('system-hours','運転時間',sys.hoursPerDay,'h/日',`data-system="hoursPerDay" data-system-id="${sys.id}"`,0,24,1,disabled)}${field('system-on','ON',sys.onSec/60,'分',`data-system="onSec" data-system-id="${sys.id}" data-factor="60"`,0,1440,1,disabled)}${field('system-off','OFF',sys.offSec/60,'分',`data-system="offSec" data-system-id="${sys.id}" data-factor="60"`,0,1440,1,disabled)}</div>`:''}<div class="device-actions"><button data-action="rotate" ${disabled?'disabled':''}>90° 回転</button><button data-action="duplicate" ${disabled?'disabled':''}>複製</button><button data-action="remove" class="danger" ${disabled?'disabled':''}>削除</button></div>${disabled?'<p class="micro warn">基準案は閲覧のみです。</p>':''}`);
}

function kpi(label:string,value:number|null|undefined,unit:string,before:number|null|undefined,ic:string,description:string){
 const diff=value!=null&&before!=null?value-before:null;
 return `<div class="kpi"><div class="kpi-icon">${icon(ic,19)}</div><div><h3>${label}</h3><div class="kpi-value">${num(value)}<small>${unit}</small></div><p>基準 ${num(before)} ${unit} <b class="${diff!==null&&diff<0?'good':''}">${diff===null?'':`→ ${signed(diff)} ${unit}`}</b></p><small class="micro">${description}</small></div></div>`;
}
function milkCard(p:Project,r:SimulationResult|null,s:ScenarioResult|null|undefined){
 const ms=p.milkSimulation,dm=s?.dailyMilk??null;
 const head=`<div class="reference-heading">${icon('cow',17)}<h3>乳量への参考影響</h3><span class="tag">仮説モデル</span></div>`;
 if(!r)return `<div class="reference-card">${head}<strong class="out-of-scope">—</strong><p>計算待ち</p></div>`;
 if(r.dailyMilkStatus==='pending')return `<div class="reference-card">${head}<strong class="out-of-scope">乳量を計算中…</strong><p>60分結果とは別に、代表日48時間の牛群平均を計算しています。</p></div>`;
 if(!dm||dm.status!=='available'){
  const reasons=dm?.reasons?.length?dm.reasons:['日乳量はこの案では計算できません'];
  return `<div class="reference-card">${head}<strong class="out-of-scope">計算不可</strong><p>${reasons.map(esc).join('<br>')}</p><p class="micro">0 kg には置き換えません。環境・放熱・資源量は引き続き使えます。</p></div>`;
 }
 const delta=dm.deltaKgPerCowDay;
 return `<div class="reference-card milk-card">${head}
 <strong class="reference-value">${num(dm.yieldKgPerCowDay)} kg/頭/日</strong>
 <p>基準案との差 <b class="${delta!==null&&delta<0?'':'good'}">${delta===null?'—':`${signed(delta)} kg/頭/日`}</b>${delta===null?'（基準案が計算不可）':''}</p>
 ${dm.lossCapped?`<p class="micro"><b>低下上限に到達</b>：低下量は最大 ${num(dm.potentialMilkKgPerCowDay*dm.maxLossFraction)} kg に止めています。</p>`:''}
 <p class="micro">牛群平均・同じ代表日が続いた場合。現在の気象・日射を24時間固定して繰り返す仮想日です。</p>
 <details id="milk-details"><summary>仮定と計算を見る</summary>
 <div class="field-grid">${field('milk-y0','基準日乳量 Y0',ms.potentialMilkKgPerCowDay,'kg/頭/日','data-milk="potentialMilkKgPerCowDay"',.1,100,.5)}${field('milk-beta','換算係数 beta',ms.responseKgPerCowDayPerW,'kg/頭/日/W','data-milk="responseKgPerCowDayPerW"',0,1,.001)}</div>
 <p class="micro"><button data-action="reset-milk" class="text-button">乳量の仮定を初期値に戻す</button></p>
 <table class="micro-table"><tbody>
 <tr><th>日負荷 D</th><td>${num(dm.dailyDeficitWPerCow,1)} W/頭（時間・区域加重）</td></tr>
 <tr><th>遅れ込み E</th><td>${num(dm.laggedDeficitWPerCow,1)} W/頭（同日反復モードでは D=E）</td></tr>
 <tr><th>式</th><td>Y = Y0 − min(Y0×${dm.maxLossFraction}, beta×E)、Qref=${num(dm.referenceCoolingWPerCow,0)} W</td></tr>
 <tr><th>滞在割合</th><td>牛床 ${dm.zoneCounts.stall}点・採食 ${dm.zoneCounts.feeding}点・その他 ${dm.zoneCounts.waiting}点で 14/6/4 時間相当。「その他」はロボット前地点の代理です。</td></tr>
 <tr><th>運転</th><td>準備24h＋評価24h・1秒刻み・日運転枠は各設備の開始時刻（既定08:00）から。残水は日付をまたいで継続します。</td></tr>
 </tbody></table>
 <table class="micro-table"><thead><tr><th>beta</th><th>Y</th><th>基準差</th></tr></thead><tbody>${dm.sensitivities.map(sx=>`<tr><td>${sx.beta}</td><td>${num(sx.yieldKgPerCowDay)} kg${sx.lossCapped?' <small>(上限)</small>':''}</td><td>${sx.deltaKgPerCowDay===null?'—':signed(sx.deltaKgPerCowDay)}</td></tr>`).join('')}</tbody></table>
 <p class="micro">仮定の分類：demo_assumption。係数は文献回帰値ではなく、実農場での精度は未検証です。掲載6条件の乳量表は資料タブに残しています。</p>
 </details>
 <button data-action="references" class="text-button">掲載表（資料）を見る →</button></div>`;
}

/** Probe panel: selected evaluation point — name, 60-min means, baseline deltas, detail entry. */
export function renderProbePanel(p:Project,r:SimulationResult|null){
 const {point:q,baseline:b,scenario:s}=selectedResults(p,r),delta=q?.deltaQrefW??null;
 const probe=buildLayout(p.template).probes.find(x=>x.id===p.view.selectedProbeId);
 const fractions=(v:number|null|undefined)=>v==null?'—':`${num(v*100,0)}%`;
 el<HTMLSelectElement>('probe-select').innerHTML=buildLayout(p.template).probes.map(q=>`<option value="${q.id}" ${q.id===p.view.selectedProbeId?'selected':''}>${esc(q.label)} · 高さ ${q.heightM}m</option>`).join('');
 setHTML('results',`<div class="hero-result"><span>${icon('cow',18)} 牛の放熱改善 <small>参考</small></span><div class="hero-value">${signed(delta,0)}<small>W</small></div><p>基準案と同じ代表牛の表面を比較</p><div class="range">仮定を変えた範囲 ${q?.parameterEnvelopeW?`${signed(q.parameterEnvelopeW[0],0)} 〜 ${signed(q.parameterEnvelopeW[1],0)} W`:'—'}</div></div>
 ${kpi('放熱不足',q?.meanDeficitW,'W',b?.meanDeficitW,'temp',`Qref ${num(p.milkSimulation.referenceCoolingWPerCow,0)} W に対する秒積算の平均。0は不足なし`)}
 ${kpi('牛位置の気温',q?.meanAirTemperatureC,'℃',b?.meanAirTemperatureC,'temp',`局所湿度 ${num(q?.meanRelativeHumidityPct)}%`)}
 ${kpi('屋根裏の温度',s?.roof.meanUnderC,'℃',s?selectedResults(p,r).base?.roof.meanUnderC:null,'roof',`平均放射温度 ${num(q?.meanRadiantC)}℃`)}
 ${kpi('送風体感温度',q?.meanFeelsLikeC,'℃',b?.meanFeelsLikeC,'fan',`全酪連掲載式 · 風速 ${num(q?.meanSpeedMps,2)}m/s`)}
 <details id="probe-detail" class="probe-detail"><summary>濡れ方・放熱内訳・設備の作用</summary><table class="micro-table"><tbody>
 <tr><th>評価高さ</th><td>${num(probe?.heightM,2)} m（${esc(probe?.label??'')}）</td></tr>
 <tr><th>濡れ方</th><td>捕水 ${num(q?.film?.capturedKg,3)} kg・凝縮 ${num(q?.film?.condensedKg,3)} kg・蒸発 ${num(q?.film?.evaporatedKg,3)} kg・流出 ${num(q?.film?.runoffKg,3)} kg（60分累積）</td></tr>
 <tr><th>保持水</th><td>平均 ${num(q?.meanFilmKg,3)} kg・終端 ${num(q?.film?.finalKg,3)} kg・最大残差 ${num(q?.film?.maxResidualKg,4)} kg</td></tr>
 <tr><th>放熱内訳</th><td>対流 ${num(q?.components?.convectionW)} + 放射 ${num(q?.components?.radiationW)} + 通常蒸発 ${num(q?.components?.baseEvaporationW)} + 散水蒸発 ${num(q?.components?.soakerEvaporationW)} + 結露 ${num(q?.components?.condensationW)} W（符号付きの60分平均）</td></tr>
 <tr><th>設備の作用</th><td>ファン増分 ${fractions(q?.fanActionFraction)}・ソーカー到達 ${fractions(q?.soakerArrivalFraction)}・ミスト蒸発 ${fractions(q?.mistEvaporationActionFraction)}（供給 ${fractions(q?.mistSupplyFraction)}）— 60分中の時間割合</td></tr>
 ${q?.status==='invalid'?`<tr><th>無効理由</th><td>${q.warnings.map(esc).join('<br>')}</td></tr>`:''}
 </tbody></table>
 ${q&&deficitUnreached(q)?'<p class="micro warn">放熱不足が残り、局所設備の作用はありません（面の位置・向きを変えて試せます）。作用=届いた診断で、効果とは別です。</p>':''}
 <p class="micro">濡れ方の内訳は60分累積kg、保持水の平均はkgです。放熱改善0は「不足がない」とは別の意味です。</p></details>
 <p class="micro"><button data-action="results" class="text-button">案比較・参考影響を開く →</button></p>
 ${s?.warnings.length?`<details id="warning-detail"><summary>計算の注意 ${s.warnings.length}件</summary>${s.warnings.map(w=>`<p class="micro">${esc(w)}</p>`).join('')}</details>`:''}`);
}

/** Reference-impact tab: daily milk hypothesis, fertility scenario, daily resources. */
export function renderReferencePane(p:Project,r:SimulationResult|null){
 const {point:q,baseline:b,scenario:s}=selectedResults(p,r),fert=q?.fertility;
 const fdelta=fert?.probability!=null&&b?.fertility.probability!=null?(fert.probability-b.fertility.probability)*100:null;
 const res=s?.dailyMilk?.resources??null;
 setHTML('reference-pane',`
 ${milkCard(p,r,s)}
 <div class="reference-card"><div class="reference-heading">${icon('heart',17)}<h3>受胎率シナリオ</h3></div><div class="fertility-value">${num(fert?.probability==null?null:fert.probability*100)}<small>%</small><span class="tag">${p.references.fertility.mode==='manual'?'独立した代表環境':'地点の温湿度を適用'}</span></div><p>${p.references.fertility.mode==='manual'?`代表 ${p.references.fertility.temperatureC}℃ / ${p.references.fertility.relativeHumidityPct}%RH`: `基準案との差 ${signed(fdelta,2)}ポイント · ${fdelta===0?'同じ参照区分':'温湿度区分の比較'}`}<br>授精前21日〜後30日の代表条件を仮定。基準受胎率 ${num(p.references.fertility.p0*100,0)}%。日乳量とは別の時間モデルです。</p><button data-action="references" class="text-button">期間の仮定・入力を確認 →</button></div>
 <div class="resource-cards"><div>${icon('drop',18)}<span>水 <small>案全体 / 日</small></span><strong>${res===null?'未計算':num(res.waterLPerDay,0)}${res===null?'':'<small>L</small>'}</strong></div><div>${icon('bolt',18)}<span>電力 <small>案全体 / 日</small></span><strong>${res===null?'未計算':num(res.totalKwhPerDay,1)}${res===null?'':'<small>kWh</small>'}</strong></div></div>
 <p class="micro">上の気温・放熱カードは「機器ONから60分」の地点別平均。水・電力と乳量は評価日24時間の運転マスクから積算します。</p>
 <div class="result-note">放熱Wの乳量への変換は仮説モデル milk-heat-deficit-v0.1 のみ。牛の深部体温や実農場の効果を保証する値ではありません。</div>`);
}

export function renderComparison(p:Project,r:SimulationResult|null){
 const qid=p.view.selectedProbeId;
 setHTML('comparison',`<div class="comparison-toolbar"><button data-action="copy-scenario" id="copy-scenario">別案へコピー</button><button data-action="reset-active" id="reset-active">基準に戻す</button><span class="micro">コピー・戻すは現在の編集案に対して実行します</span></div><div class="comparison-grid">${p.scenarios.map(sc=>{const s=r?.scenarios.find(v=>v.id===sc.id),q=s?.points.find(v=>v.probeId===qid),dres=s?.dailyMilk?.resources??null,cost=dres&&p.prices.electricityYenKwh!==null&&p.prices.waterYenM3!==null?dres.totalKwhPerDay*p.prices.electricityYenKwh+dres.waterLPerDay/1000*p.prices.waterYenM3:null,dm=s?.dailyMilk;
 const milkLine=dm?.status==='available'?`日乳量 <b>${num(dm.yieldKgPerCowDay)}</b> kg（${dm.deltaKgPerCowDay===null?'—':signed(dm.deltaKgPerCowDay)}）`:dm?`日乳量 <b>計算不可</b>`:'日乳量 <b>計算中…</b>';
 return `<button data-scenario="${sc.id}" class="comparison-card ${sc.id===p.activeScenarioId?'active':''}"><h3>${esc(sc.name)}</h3><div><strong>${signed(q?.deltaQrefW,0)}</strong><small>W 放熱改善</small></div><p>局所気温 <b>${num(q?.meanAirTemperatureC)}℃</b><br>${milkLine}<br>日運転費 <b>${num(cost,0)}円</b></p><span class="micro">${sc.roof.reflectance>.5?'遮熱あり':'遮熱なし'} / ${sc.roof.insulationM>0?'断熱あり':'断熱なし'}</span></button>`}).join('')}</div><p class="micro">運転費は入力単価による試算。初期設備費・投資回収は計算しません。日乳量は仮説モデルの牛群平均です。</p>`);
 el<HTMLButtonElement>('reset-active').disabled=activeScenario(p).readOnly;el<HTMLButtonElement>('copy-scenario').disabled=activeScenario(p).readOnly;
}
export function renderAreas(p:Project,r:SimulationResult|null){
 const l=buildLayout(p.template),s=r?.scenarios.find(x=>x.id===p.activeScenarioId);
 if(!s){setHTML('area-summary','<p class="micro">計算待ち</p>');return}
 const rows=buildAreas(l).map(a=>{
  const st=areaStats(s.points,a);
  return `<tr data-area="${esc(a.id)}" class="${p.view.selectedAreaId===a.id?'selected':''}${a.subtotal?' subtotal':''}"><th>${esc(a.label)}</th><td>${st.meanDeficitW===null?`未評価 ${st.validCount}/${st.probeCount}`:`${num(st.meanDeficitW,0)} W`}</td><td>${st.meanImprovementW===null?'—':signed(st.meanImprovementW,0)}</td><td>${st.deficitCount}/${st.probeCount}</td><td>${st.deficitNoActionCount}</td><td>${st.topDeficit.map(t=>esc(t.probeId)).join('、')||'—'}</td></tr>`;
 }).join('');
 setHTML('area-summary',`<div class="table-scroll"><table class="area-table"><thead><tr><th>エリア</th><th>不足</th><th>改善</th><th>不足点</th><th>未到達</th><th>不足上位3</th></tr></thead><tbody>${rows}</tbody></table></div><p class="micro">行をクリックすると対象の面を強調します。不足=Qrefに対する秒積算平均 / 未到達=不足があり局所設備の作用もない地点数。代表点の単純平均で、滞在時間・頭数の重みではありません。1点でも無効なら未評価です。</p>`);
}
export function renderSettings(p:Project){setHTML('settings-body',`<h3>モデル牛舎</h3><p>寸法は全案共通。設備の相対位置と牛床を一緒に更新します。</p><div class="field-grid">${field('barn-length','長さ',p.template.lengthM,'m','data-template="lengthM"',32,48,.1)}${field('barn-width','幅',p.template.widthM,'m','data-template="widthM"',23.5,30,.1)}${field('background-wind','背景風速',p.environment.backgroundSpeedMps,'m/s','data-env="backgroundSpeedMps"',0,10,.01)}${field('ventilation','空気交換',p.environment.ventilationM3sPerM2,'m³/s/m²','data-env="ventilationM3sPerM2"',.0001,1,.001)}</div><p class="micro">循環ファンを増やしても換気量は増えません。50床・軒4m・棟8.7mは固定。</p><h3>日運転費の試算単価</h3><div class="field-grid">${field('price-electricity','電力',p.prices.electricityYenKwh,'円/kWh','data-price="electricityYenKwh"',0,1e6,1)}${field('price-water','水',p.prices.waterYenM3,'円/m³','data-price="waterYenM3"',0,1e6,1)}</div><p class="micro">実際の料金ではない仮単価です。空欄なら費用のみ非表示。</p><h3>保存と復元</h3><p>新しい保存形式はschemaVersion 9です。旧版（v8・v4など）は読み込みません。読み込み失敗時には現在の案を保持します。</p><button data-action="restore-local">この端末の前回保存を復元</button><p class="micro">端末内に保存。サーバーには送信しません。ブラウザ設定によって端末内保存が使えない場合も、JSON保存は利用できます。</p>`)}
export function renderReference(p:Project){
 const f=p.references.fertility,calc=fertilityReference({...f,mode:'manual',exposureAssumed:true},null,null);
 setHTML('reference-body',`<h3>乳量：掲載表をそのまま参照</h3><p>この表の表示は、現在の牛舎計算とは別です。実際の局所条件が一致する場合だけ結果カードへ反映します。</p>${field('baseline-milk','適温時の基準乳量',p.references.baselineMilkKgPerDay,'kg/頭/日','data-milk-baseline',0,100,.5)}<div class="table-scroll"><table><thead><tr><th>気温</th><th>風速</th><th>乳量比</th><th>参考kg/頭/日</th></tr></thead><tbody>${MILK_ROWS.map(row=>`<tr><td>${row.temperatureC}℃</td><td>${row.speedMps} m/s</td><td>${row.ratioPct}%</td><td>${num(milkReference(row.temperatureC,65,row.speedMps,p.references.baselineMilkKgPerDay).kgPerDay,2)}</td></tr>`).join('')}</tbody></table></div><p class="micro">全酪連COWBELL No.178 p.8、日本飼養標準2017・柴田ら1984の抜粋。相対湿度60〜70%。時間変動、補間、外挿、最近傍への丸めなし。</p>
 <hr><h3>受胎：52日間の代表環境</h3><p>人工授精1回あたりの参考成功確率です。今この瞬間の受精確率ではありません。</p><div class="assumption-box"><label><input id="fertility-linked" type="checkbox" data-fertility-linked ${f.mode==='simulation'?'checked':''}> 選択地点の60分平均温湿度を、授精21日前〜後30日の代表環境として採用する</label><p class="micro">この操作は期間全体の環境を測定・予報したことにはなりません。全5期間が同じ条件とする追加仮定です。</p></div>
 <div class="field-grid">${field('fertility-baseline','仮の基準受胎率',f.p0*100,'%','data-fertility="p0" data-factor="0.01"',.1,99.9,1)}${field('fertility-t','手動の代表気温',f.temperatureC,'℃','data-fertility="temperatureC"',-20,50,.5,f.mode==='simulation')}${field('fertility-rh','手動の代表湿度',f.relativeHumidityPct,'%','data-fertility="relativeHumidityPct"',0,100,1,f.mode==='simulation')}</div><p>手動条件の参考値：<strong>${num((calc.probability??0)*100)}%</strong> / THI ${num(calc.thi,2)}</p><p class="micro">Baccouri et al. (2025) Table 2の5期間ORを使用。基準40%は仮定。屋外観測所THIを牛位置へ適用することも追加仮定です。同じTHI区分なら値は変わりません。放射・送風・牛体散水の直接効果は上乗せしません。</p>`);
}
export function renderEvidence(p:Project,r:SimulationResult|null){
 const {point:q}=selectedResults(p,r);
 setHTML('evidence-body',`<div class="assumption-box"><strong>このアプリが計算すること</strong><p>設備配置 → 屋根・局所環境 → 代表牛の放熱を比較します。乳量と受胎は、それぞれ根拠がある条件だけを使う別の参照モデルです。</p></div><h3>出力を混ぜない</h3><table><tbody><tr><th>送風体感温度</th><td>T − 6√v。放射・水を℃へ上乗せしません。</td></tr><tr><th>放熱改善</th><td>対流＋放射＋蒸発−結露の、基準案からの差。体表35℃を固定した比較です。</td></tr><tr><th>乳量</th><td>日乳量は仮説モデル milk-heat-deficit-v0.1 の牛群平均です。掲載表の乳量は6条件のみ・対象外はnull・補間しません。</td></tr><tr><th>受胎</th><td>5期間のTHI区分OR × 仮の基準オッズ。60分結果の52日代表化は明示的な仮定です。</td></tr></tbody></table>
 <h3>現在の放熱内訳 <small>60分平均</small></h3><table><tbody>${q?.components?Object.entries(q.components).map(([k,v])=>`<tr><th>${({convectionW:'対流',radiationW:'放射',baseEvaporationW:'通常の有効蒸発',soakerEvaporationW:'牛体散水の蒸発',condensationW:'結露'} as Record<string,string>)[k]}</th><td>${num(v,2)} W</td></tr>`).join(''):'<tr><td>計算待ち</td></tr>'}</tbody></table>
 <h3>仮定を変えた参考範囲</h3><p>低値・基準・高値の3係数セット。実際の上下限や95%信頼区間ではありません。</p><table><thead><tr><th>セット</th><th>出口風速倍率</th><th>熱伝達倍率</th><th>ミスト効率</th><th>保持水kg</th></tr></thead><tbody>${p.model.profiles.map(v=>`<tr><td>${esc(v.name)}</td><td>${v.outletMultiplier}</td><td>${v.hcMultiplier}</td><td>${v.mistEfficiency}</td><td>${v.maxFilmKg}</td></tr>`).join('')}</tbody></table><h3>根拠・仮定の記録</h3>${p.provenance.map(v=>`<div class="source-card"><span class="tag">${esc(v.classification)}</span><p>${esc(v.note)}</p>${v.url?`<a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">参照元を開く ↗</a>`:''}`).join('')}<h3>モデル・保存版</h3><p><code>${esc(p.model.version)}</code> / schema ${p.schemaVersion}<br>熱v0.5、乳量表v0.6、受胎v0.7を統合。v0.9で日乳量仮説モデル <code>milk-heat-deficit-v0.1</code> を追加。モデルの対応範囲は拡張していません。</p>`);
}
export function renderHelp(){
 setHTML('help-body',`<h3>基本の操作</h3><table><tbody>
 <tr><th>設備を置く</th><td>下の「ファン」「ソーカー」「ミスト」を押し、牛舎の置きたい場所をクリックします。Escまたは「中止」でやめられます。</td></tr>
 <tr><th>設備を動かす</th><td>設備をクリックして選び、ドラッグで移動。右のパネルで高さ・向き・風速を変更します。</td></tr>
 <tr><th>視点</th><td>背景をドラッグで回転、ホイールで拡大。Shift＋ドラッグまたは右ドラッグで平行移動。「全体・上面・側面」で決まった視点に戻れます。</td></tr>
 <tr><th>地点を見る</th><td>色付きの面をクリックすると代表地点を選び、60分平均の結果を表示します。面の色はその地点の値で、面全体の計算ではありません。</td></tr>
 <tr><th>案を比べる</th><td>「結果・比較」で基準案と編集案を同じ気象条件で比較します。</td></tr></tbody></table>
 <h3>表示の読み方</h3><table><tbody>
 <tr><th>放熱不足</th><td>基準放熱量Qrefに対して不足した量の60分平均。0は不足なし。値が大きいほど暑い地点です。</td></tr>
 <tr><th>放熱改善</th><td>基準案との放熱差。0は「基準と同じ」で、悪化は負になります。</td></tr>
 <tr><th>水・電力</th><td>案全体の1日分。日乳量と同じ24時間運転マスクから積算します。</td></tr>
 <tr><th>風・散水</th><td>ファン風と水滴は作用の模式表現です。CFDではありません。</td></tr>
 <tr><th>乳量・受胎</th><td>日乳量は仮説モデル（demo_assumption）、受胎はTHI区分の参考シナリオです。実農場の予測値ではありません。</td></tr></tbody></table>
 <h3>AIエージェント (MCP) から使う</h3><table><tbody>
 <tr><th>リモートMCP</th><td>この計算モデルをMCP (Model Context Protocol) 経由で外部エージェントから呼べます。<br><code>https://puzxplbkg2qglia72tkhs2z7km0jrusa.lambda-url.us-east-1.on.aws/</code><br>ツール: get_default_project / evaluate / describe_model / get_doc。</td></tr>
 <tr><th>公開デモトークン</th><td><code>demo-581fKusGqNgk7YrycFNw6M_5</code>（誰でも使える公開用。悪用時はこのトークンのみ停止します）</td></tr>
 <tr><th>接続設定例</th><td><code>{"type":"http","url":"&lt;上のURL&gt;","headers":{"Authorization":"Bearer demo-581fKusGqNgk7YrycFNw6M_5"}}</code></td></tr>
 <tr><th>ローカルMCP</th><td>リポジトリで <code>npm run mcp</code> を実行すると、開いている画面をAIが直接操作するPoC版が使えます。</td></tr></tbody></table>
 <p class="micro"><button data-action="guide-restart" class="text-button">初回ガイドをもう一度見る</button> · <button data-action="evidence" class="text-button">モデルの根拠と仮定 →</button></p>`);
}

const PANEL_TITLES:Record<string,string>={device:'設備',probe:'地点の結果',devices:'設備・系統',roof:'屋根対策',weather:'気象条件'};
const SHEET_TABS=['compare','areas','timeline','reference'] as const;

/** Panel visibility, view-mode chrome, legend, dock enablement, ghost/hint/guide. */
export function renderChrome(p:Project,r:SimulationResult|null,w:Workspace){
 const s=activeScenario(p),disabled=s.readOnly;
 const panel=el('selection-panel');panel.dataset.panel=w.panel??'';panel.hidden=w.panel===null;
 el('panel-title').textContent=PANEL_TITLES[w.panel??'']??'';
 for(const k of ['device','probe','devices','roof','weather'] as const)el(`panel-${k}`).hidden=w.panel!==k;
 const sheet=el('sheet');sheet.hidden=w.sheet===null;sheet.dataset.tab=w.sheet??'';
 for(const t of SHEET_TABS){el(`sheet-${t}`).hidden=w.sheet!==t;document.querySelector(`[data-sheet=${t}]`)?.classList.toggle('active',w.sheet===t)}
 el('scene-selection').textContent=buildLayout(p.template).probes.find(q=>q.id===p.view.selectedProbeId)?.label??'';
 document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===p.view.mode&&!(p.view.mode==='3d'&&p.view.realistic)));
 document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(b=>b.classList.toggle('active',b.dataset.metric===p.view.metric));
 const realistic=p.view.mode==='3d'&&p.view.realistic===true;
 document.querySelector('[data-render=realistic]')?.classList.toggle('active',realistic);
 el('heatmap-switch').hidden=!realistic;el('realistic-note').hidden=!realistic;el('legend').hidden=realistic&&!p.view.heatmap&&!p.view.analysis;
 for(const key of ['roof','flow','particles','analysis','heatmap'] as const)el<HTMLInputElement>('show-'+key).checked=p.view[key]===true;
 const m=p.view.metric;setHTML('legend',`<span>${m==='delta'?'−900 W':m==='speed'?'0 m/s':m==='deficit'?'0 W':'25℃'}</span><i class="legend-gradient ${m}"></i><span>${m==='delta'?'+900 W':m==='speed'?'3 m/s':m==='deficit'?'1200 W以上':'40℃'}</span><span class="legend-note">斜線=無効・通路等は評価対象外</span>`);
 for(const [id]of [['place-fan'],['place-soaker'],['place-mist']] as const)el<HTMLButtonElement>(id).disabled=disabled;
 el<HTMLButtonElement>('roof-button').disabled=false;
 // Ghost placement hint: shows kind, candidate state, and a disabled-system note.
 const pl=w.placement,hint=el('placement-hint');hint.hidden=!pl;
 if(pl){
  const s2=activeScenario(p),sysOff=pl.kind!=='fan'&&!s2.waterSystems.find(x=>x.kind===pl.kind)!.enabled;
  const labels={fan:'ファン',soaker:'ソーカー',mist:'ミスト'} as const;
  el('placement-text').textContent=`${labels[pl.kind]}：置きたい場所をクリック（Escで中止）${pl.valid?` · ${pl.x?.toFixed(1)}m, ${pl.y?.toFixed(1)}m`:''}${pl.x!==null&&!pl.valid?' · ここには配置できません':''}${sysOff?' · 系統が停止中です':''}`;
  el<HTMLButtonElement>('confirm-placement').disabled=!pl.valid;
 }
 const g=el('guide-card');g.hidden=w.guide.done;
 if(!w.guide.done){
  const steps=[
   {t:'暑さの分布を見る',x:'床の色は放熱不足の60分平均です。面をクリックすると地点を選べます。'},
   {t:'ファンを選んで動かす',x:'下の「ファン」で追加、既存の設備はドラッグで移動します。'},
   {t:'基準案と比べる',x:'「結果・比較」で同じ気象条件の基準案との差を確認します。'},
  ][w.guide.step]!;
  el('guide-title').textContent=`${w.guide.step+1}/3 ${steps.t}`;el('guide-text').textContent=steps.x;
 }
}
