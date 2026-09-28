import type {Project,SimulationResult,PointResult,ScenarioResult} from '../domain/project.js';
import {activeScenario,devices,isFan} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {thi} from '../model/physics.js';
import {MILK_ROWS,milkReference,fertilityReference,FERTILITY_OR} from '../model/references.js';
import {esc,num,signed,icon,field,toggle,setHTML,el} from './dom.js';

export function selectedResults(p:Project,r:SimulationResult|null){
 const scenario=r?.scenarios.find(s=>s.id===p.activeScenarioId),base=r?.scenarios.find(s=>s.id===p.baselineScenarioId);
 return {scenario,base,point:scenario?.points.find(q=>q.probeId===p.view.selectedProbeId),baseline:base?.points.find(q=>q.probeId===p.view.selectedProbeId)};
}
export function renderControls(p:Project){
 const s=activeScenario(p),disabled=s.readOnly,soak=s.waterSystems.find(w=>w.kind==='soaker')!,mist=s.waterSystems.find(w=>w.kind==='mist')!;
 setHTML('environment-fields',`${field('env-temperature','外気温',p.environment.temperatureC,'℃','data-env="temperatureC"',20,40,.5)}${field('env-humidity','相対湿度',p.environment.relativeHumidityPct,'%','data-env="relativeHumidityPct"',10,100,1)}${field('env-solar','屋根面日射',p.environment.solarRoofWm2,'W/m²','data-env="solarRoofWm2"',0,1200,50)}<div class="thi-badge"><small>外気THI</small><strong>${num(thi(p.environment.temperatureC,p.environment.relativeHumidityPct))}</strong></div>`);
 el('dimensions-label').textContent=`${p.template.lengthM} × ${p.template.widthM} m · 70評価点`;
 setHTML('scenario-tabs',p.scenarios.map(sc=>`<button data-scenario="${sc.id}" class="${s.id===sc.id?'active':''}">${esc(sc.name)}${sc.readOnly?' <span class="lock">固定</span>':''}</button>`).join(''));
 setHTML('equipment-controls',`<div class="equipment-section"><div class="section-label">屋根への対策 <span>全体に適用</span></div>
 ${toggle('roof-coating','遮熱塗装',`現在の日射反射率 ${num(s.roof.reflectance*100,0)}%`,s.roof.reflectance>.5,'data-roof-toggle="coating"','sun',disabled)}
 ${toggle('roof-insulation',`断熱材 ${num(s.roof.insulationM>0?s.roof.insulationM*1000:20,0)}mm`,'熱抵抗を追加する',s.roof.insulationM>0,'data-roof-toggle="insulation"','layers',disabled)}
 ${toggle('roof-spray','屋根散水',`${num(s.roof.onSec/60,1)}分ON / ${num(s.roof.offSec/60,1)}分OFF`,s.roof.sprayEnabled,'data-roof-toggle="sprayEnabled"','roof',disabled)}
 <details id="roof-details"><summary>屋根の詳細設定</summary><div class="field-grid">${field('roof-reflectance','日射反射率',s.roof.reflectance,'','data-roof="reflectance"',0,1,.05,disabled)}${field('roof-insulation-m','断熱材厚さ',s.roof.insulationM,'m','data-roof="insulationM"',0,.1,.01,disabled)}${field('roof-flow','散水量',s.roof.flowLpmM2,'L/分/m²','data-roof="flowLpmM2"',0,1,.01,disabled)}${field('roof-start','運転開始',s.roof.dailyStartHour,'時','data-roof="dailyStartHour"',0,23.75,.25,disabled)}${field('roof-hours','運転時間',s.roof.hoursPerDay,'h/日','data-roof="hoursPerDay"',0,24,1,disabled)}${field('roof-on','ON',s.roof.onSec/60,'分','data-roof="onSec" data-factor="60"',0,1440,1,disabled)}${field('roof-off','OFF',s.roof.offSec/60,'分','data-roof="offSec" data-factor="60"',0,1440,1,disabled)}</div><p class="micro">日運転は「運転開始＋運転時間」で繰り返します。上の60分結果は機器ONからの経過です。</p></details></div>
 <div class="equipment-section"><div class="section-label">牛・空気への対策 <span>位置を編集</span></div>
 ${toggle('fans-enabled','循環ファン',`${s.fans.filter(f=>f.enabled).length} / ${s.fans.length} 台が有効`,s.fans.some(f=>f.enabled),'data-all-fans','fan',disabled)}
 ${toggle('soaker-enabled','ソーカー',`${soak.nozzles.filter(n=>n.enabled).length}個 · 牛体を濡らす`,soak.enabled,`data-system-enabled="${soak.id}"`,'drop',disabled)}
 ${toggle('mist-enabled','ミスト',`${mist.nozzles.filter(n=>n.enabled).length}個 · 空気を冷やす`,mist.enabled,`data-system-enabled="${mist.id}"`,'mist',disabled)}
 <div class="equipment-add"><button data-action="add-fan" ${disabled?'disabled':''}>＋ ファン</button><button data-action="add-soaker" ${disabled?'disabled':''}>＋ ソーカー</button><button data-action="add-mist" ${disabled?'disabled':''}>＋ ミスト</button></div><p class="micro">追加した設備は選択状態になります。3Dでドラッグ、または座標を入力。</p></div>`);
 setHTML('device-selector',`<label class="sr-only" for="device-select">編集する設備</label><select id="device-select"><option value="">設備を選択してください</option>${devices(s).map(d=>`<option value="${esc(d.id)}" ${p.view.selectedDeviceId===d.id?'selected':''}>${esc(d.label)}</option>`).join('')}</select>`);
 const d=devices(s).find(d=>d.id===p.view.selectedDeviceId);
 if(!d){setHTML('device-properties',`<div class="empty-inspector">${icon('fan',30)}<p>牛舎のファンをクリック。<br>位置・向き・高さを変えて試します。</p><button data-action="select-first-fan" class="quiet">最初のファンを選択 →</button></div>`)}
 else {
  const fan=isFan(d),sys=s.waterSystems.find(w=>w.nozzles.some(n=>n.id===d.id));
  setHTML('device-properties',`<div class="selected-device"><strong>${esc(d.label)}</strong><label><input type="checkbox" id="device-enabled" data-device-enabled ${d.enabled?'checked':''} ${disabled?'disabled':''}> 有効</label></div><div class="field-grid">
  ${field('device-x','長手 X',d.x,'m','data-device="x"',0,p.template.lengthM,.1,disabled)}${field('device-y','幅 Y',d.y,'m','data-device="y"',0,p.template.widthM,.1,disabled)}
  ${field('device-height','高さ',d.heightM,'m','data-device="heightM"',fan?d.diameterM/2:1.8,4,.1,disabled)}${field('device-yaw','向き',d.yawDeg,'°','data-device="yawDeg"',0,360,5,disabled)}${field('device-pitch','下向き角',d.pitchDownDeg,'°','data-device="pitchDownDeg"',fan?0:30,90,5,disabled)}
  ${fan?field('device-outlet','出口風速',d.outletSpeedMps,'m/s','data-device="outletSpeedMps"',0,30,.5,disabled):field('device-flow','ノズル流量',d.flowLpm,'L/分','data-device="flowLpm"',0,20,.1,disabled)}
  ${fan?field('device-hours','運転時間',d.hoursPerDay,'h/日','data-device="hoursPerDay"',0,24,1,disabled):field('device-angle','噴霧半角',d.halfAngleDeg,'°','data-device="halfAngleDeg"',1,85,5,disabled)}
  ${fan?field('device-start','日運転の開始',d.dailyStartHour,'時','data-device="dailyStartHour"',0,23.75,.25,disabled):''}
  </div>${sys?`<div class="section-label">系統全体の周期</div><div class="field-grid">${field('system-start','運転開始',sys.dailyStartHour,'時',`data-system="dailyStartHour" data-system-id="${sys.id}"`,0,23.75,.25,disabled)}${field('system-hours','運転時間',sys.hoursPerDay,'h/日',`data-system="hoursPerDay" data-system-id="${sys.id}"`,0,24,1,disabled)}${field('system-on','ON',sys.onSec/60,'分',`data-system="onSec" data-system-id="${sys.id}" data-factor="60"`,0,1440,1,disabled)}${field('system-off','OFF',sys.offSec/60,'分',`data-system="offSec" data-system-id="${sys.id}" data-factor="60"`,0,1440,1,disabled)}</div>`:''}<div class="device-actions"><button data-action="rotate" ${disabled?'disabled':''}>90° 回転</button><button data-action="duplicate" ${disabled?'disabled':''}>複製</button><button data-action="remove" class="danger" ${disabled?'disabled':''}>削除</button></div>`);
 }
 el<HTMLSelectElement>('probe-select').innerHTML=buildLayout(p.template).probes.map(q=>`<option value="${q.id}" ${q.id===p.view.selectedProbeId?'selected':''}>${esc(q.label)} · 高さ ${q.heightM}m</option>`).join('');
 el('scene-selection').textContent=buildLayout(p.template).probes.find(q=>q.id===p.view.selectedProbeId)?.label??'';
 el('edit-hint').textContent=disabled?'基準案は固定です。編集案 A / B に切り替えてください。':'選択 → 移動・高さ・向き → 比較';
 el<HTMLButtonElement>('reset-active').disabled=disabled;el<HTMLButtonElement>('copy-scenario').disabled=disabled;
 document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===p.view.mode));
 document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(b=>b.classList.toggle('active',b.dataset.metric===p.view.metric));
 for(const key of ['roof','flow','particles'] as const)el<HTMLInputElement>('show-'+(key==='particles'?'particles':key)).checked=p.view[key];
 const m=p.view.metric;setHTML('legend',`<span>${m==='delta'?'−900 W':m==='speed'?'0 m/s':'25℃'}</span><i class="legend-gradient ${m}"></i><span>${m==='delta'?'+900 W':m==='speed'?'3 m/s':'40℃'}</span>`);
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
export function renderResults(p:Project,r:SimulationResult|null){
 const {point:q,baseline:b,scenario:s,base}=selectedResults(p,r),fert=q?.fertility,delta=q?.deltaQrefW??null;
 const fdelta=fert?.probability!=null&&b?.fertility.probability!=null?(fert.probability-b.fertility.probability)*100:null;
 const res=s?.dailyMilk?.resources??null;
 setHTML('results',`<div class="hero-result"><span>${icon('cow',18)} 牛の放熱改善 <small>参考</small></span><div class="hero-value">${signed(delta,0)}<small>W</small></div><p>基準案と同じ代表牛の表面を比較</p><div class="range">仮定を変えた範囲 ${q?.parameterEnvelopeW?`${signed(q.parameterEnvelopeW[0],0)} 〜 ${signed(q.parameterEnvelopeW[1],0)} W`:'—'}</div></div>
 ${kpi('牛位置の気温',q?.meanAirTemperatureC,'℃',b?.meanAirTemperatureC,'temp',`局所湿度 ${num(q?.meanRelativeHumidityPct)}%`)}
 ${kpi('屋根裏の温度',s?.roof.meanUnderC,'℃',base?.roof.meanUnderC,'roof',`平均放射温度 ${num(q?.meanRadiantC)}℃`)}
 ${kpi('送風体感温度',q?.meanFeelsLikeC,'℃',b?.meanFeelsLikeC,'fan',`全酪連掲載式 · 風速 ${num(q?.meanSpeedMps,2)}m/s`)}
 ${milkCard(p,r,s)}
 <div class="reference-card"><div class="reference-heading">${icon('heart',17)}<h3>受胎率シナリオ</h3></div><div class="fertility-value">${num(fert?.probability==null?null:fert.probability*100)}<small>%</small><span class="tag">${p.references.fertility.mode==='manual'?'独立した代表環境':'地点の温湿度を適用'}</span></div><p>${p.references.fertility.mode==='manual'?`代表 ${p.references.fertility.temperatureC}℃ / ${p.references.fertility.relativeHumidityPct}%RH`: `基準案との差 ${signed(fdelta,2)}ポイント · ${fdelta===0?'同じ参照区分':'温湿度区分の比較'}`}<br>授精前21日〜後30日の代表条件を仮定。基準受胎率 ${num(p.references.fertility.p0*100,0)}%。日乳量とは別の時間モデルです。</p><button data-action="references" class="text-button">期間の仮定・入力を確認 →</button></div>
 <div class="resource-cards"><div>${icon('drop',18)}<span>水 <small>案全体 / 日</small></span><strong>${res===null?'未計算':num(res.waterLPerDay,0)}${res===null?'':'<small>L</small>'}</strong></div><div>${icon('bolt',18)}<span>電力 <small>案全体 / 日</small></span><strong>${res===null?'未計算':num(res.totalKwhPerDay,1)}${res===null?'':'<small>kWh</small>'}</strong></div></div>
 <p class="micro">上の気温・放熱カードは「機器ONから60分」の地点別平均。水・電力と乳量は評価日24時間の運転マスクから積算します。</p>
 <div class="result-note">放熱Wの乳量への変換は仮説モデル milk-heat-deficit-v0.1 のみ。牛の深部体温や実農場の効果を保証する値ではありません。</div>
 ${s?.warnings.length?`<details id="warning-detail"><summary>計算の注意 ${s.warnings.length}件</summary>${s.warnings.map(w=>`<p class="micro">${esc(w)}</p>`).join('')}</details>`:''}`);
 renderComparison(p,r);
}
export function renderComparison(p:Project,r:SimulationResult|null){
 const qid=p.view.selectedProbeId;
 setHTML('comparison',`<div class="comparison-grid">${p.scenarios.map(sc=>{const s=r?.scenarios.find(v=>v.id===sc.id),q=s?.points.find(v=>v.probeId===qid),dres=s?.dailyMilk?.resources??null,cost=dres&&p.prices.electricityYenKwh!==null&&p.prices.waterYenM3!==null?dres.totalKwhPerDay*p.prices.electricityYenKwh+dres.waterLPerDay/1000*p.prices.waterYenM3:null,dm=s?.dailyMilk;
 const milkLine=dm?.status==='available'?`日乳量 <b>${num(dm.yieldKgPerCowDay)}</b> kg（${dm.deltaKgPerCowDay===null?'—':signed(dm.deltaKgPerCowDay)}）`:dm?`日乳量 <b>計算不可</b>`:'日乳量 <b>計算中…</b>';
 return `<button data-scenario="${sc.id}" class="comparison-card ${sc.id===p.activeScenarioId?'active':''}"><h3>${esc(sc.name)}</h3><div><strong>${signed(q?.deltaQrefW,0)}</strong><small>W 放熱改善</small></div><p>局所気温 <b>${num(q?.meanAirTemperatureC)}℃</b><br>${milkLine}<br>日運転費 <b>${num(cost,0)}円</b></p><span class="micro">${sc.roof.reflectance>.5?'遮熱あり':'遮熱なし'} / ${sc.roof.insulationM>0?'断熱あり':'断熱なし'}</span></button>`}).join('')}</div><p class="micro">運転費は入力単価による試算。初期設備費・投資回収は計算しません。日乳量は仮説モデルの牛群平均です。</p>`);
}
export function renderSettings(p:Project){setHTML('settings-body',`<h3>モデル牛舎</h3><p>寸法は全案共通。設備の相対位置と牛床を一緒に更新します。</p><div class="field-grid">${field('barn-length','長さ',p.template.lengthM,'m','data-template="lengthM"',32,48,.1)}${field('barn-width','幅',p.template.widthM,'m','data-template="widthM"',23.5,30,.1)}${field('background-wind','背景風速',p.environment.backgroundSpeedMps,'m/s','data-env="backgroundSpeedMps"',0,10,.01)}${field('ventilation','空気交換',p.environment.ventilationM3sPerM2,'m³/s/m²','data-env="ventilationM3sPerM2"',.0001,1,.001)}</div><p class="micro">循環ファンを増やしても換気量は増えません。50床・軒4m・棟8.7mは固定。</p><h3>日運転費の試算単価</h3><div class="field-grid">${field('price-electricity','電力',p.prices.electricityYenKwh,'円/kWh','data-price="electricityYenKwh"',0,1e6,1)}${field('price-water','水',p.prices.waterYenM3,'円/m³','data-price="waterYenM3"',0,1e6,1)}</div><p class="micro">実際の料金ではない仮単価です。空欄なら費用のみ非表示。</p><h3>保存と復元</h3><p>新しい保存形式はschemaVersion 9です。旧版（v8・v4など）は読み込みません。読み込み失敗時には現在の案を保持します。</p><button data-action="restore-local">この端末の前回保存を復元</button><p class="micro">端末内に保存。サーバーには送信しません。ブラウザ設定によって端末内保存が使えない場合も、JSON保存は利用できます。</p>`)}
export function renderReference(p:Project){
 const f=p.references.fertility,calc=fertilityReference({...f,mode:'manual',exposureAssumed:true},null,null);
 setHTML('reference-body',`<h3>乳量：掲載表をそのまま参照</h3><p>この表の表示は、現在の牛舎計算とは別です。実際の局所条件が一致する場合だけ結果カードへ反映します。</p>${field('baseline-milk','適温時の基準乳量',p.references.baselineMilkKgPerDay,'kg/頭/日','data-milk-baseline',0,100,.5)}<div class="table-scroll"><table><thead><tr><th>気温</th><th>風速</th><th>乳量比</th><th>参考kg/頭/日</th></tr></thead><tbody>${MILK_ROWS.map(row=>`<tr><td>${row.temperatureC}℃</td><td>${row.speedMps} m/s</td><td>${row.ratioPct}%</td><td>${num(milkReference(row.temperatureC,65,row.speedMps,p.references.baselineMilkKgPerDay).kgPerDay,2)}</td></tr>`).join('')}</tbody></table></div><p class="micro">全酪連COWBELL No.178 p.8、日本飼養標準2017・柴田ら1984の抜粋。相対湿度60〜70%。時間変動、補間、外挿、最近傍への丸めなし。</p>
 <hr><h3>受胎：52日間の代表環境</h3><p>人工授精1回あたりの参考成功確率です。今この瞬間の受精確率ではありません。</p><div class="assumption-box"><label><input id="fertility-linked" type="checkbox" data-fertility-linked ${f.mode==='simulation'?'checked':''}> 選択地点の60分平均温湿度を、授精21日前〜30日後の代表環境として採用する</label><p class="micro">この操作は期間全体の環境を測定・予報したことにはなりません。全5期間が同じ条件とする追加仮定です。</p></div>
 <div class="field-grid">${field('fertility-baseline','仮の基準受胎率',f.p0*100,'%','data-fertility="p0" data-factor="0.01"',.1,99.9,1)}${field('fertility-t','手動の代表気温',f.temperatureC,'℃','data-fertility="temperatureC"',-20,50,.5,f.mode==='simulation')}${field('fertility-rh','手動の代表湿度',f.relativeHumidityPct,'%','data-fertility="relativeHumidityPct"',0,100,1,f.mode==='simulation')}</div><p>手動条件の参考値：<strong>${num((calc.probability??0)*100)}%</strong> / THI ${num(calc.thi,2)}</p><p class="micro">Baccouri et al. (2025) Table 2の5期間ORを使用。基準40%は仮定。屋外観測所THIを牛位置へ適用することも追加仮定です。同じTHI区分なら値は変わりません。放射・送風・牛体散水の直接効果は上乗せしません。</p>`);
}
export function renderEvidence(p:Project,r:SimulationResult|null){
 const {point:q}=selectedResults(p,r);
 setHTML('evidence-body',`<div class="assumption-box"><strong>このアプリが計算すること</strong><p>設備配置 → 屋根・局所環境 → 代表牛の放熱を比較します。乳量と受胎は、それぞれ根拠がある条件だけを使う別の参照モデルです。</p></div><h3>出力を混ぜない</h3><table><tbody><tr><th>送風体感温度</th><td>T − 6√v。放射・水を℃へ上乗せしません。</td></tr><tr><th>放熱改善</th><td>対流＋放射＋蒸発−結露の、基準案からの差。体表35℃を固定した比較です。</td></tr><tr><th>乳量</th><td>表の6条件のみ。対象外はnull。補間しません。</td></tr><tr><th>受胎</th><td>5期間のTHI区分OR × 仮の基準オッズ。60分結果の52日代表化は明示的な仮定です。</td></tr></tbody></table>
 <h3>現在の放熱内訳 <small>60分平均</small></h3><table><tbody>${q?.components?Object.entries(q.components).map(([k,v])=>`<tr><th>${({convectionW:'対流',radiationW:'放射',baseEvaporationW:'通常の有効蒸発',soakerEvaporationW:'牛体散水の蒸発',condensationW:'結露'} as Record<string,string>)[k]}</th><td>${num(v,2)} W</td></tr>`).join(''):'<tr><td>計算待ち</td></tr>'}</tbody></table>
 <h3>仮定を変えた参考範囲</h3><p>低値・基準・高値の3係数セット。実際の上下限や95%信頼区間ではありません。</p><table><thead><tr><th>セット</th><th>出口風速倍率</th><th>熱伝達倍率</th><th>ミスト効率</th><th>保持水kg</th></tr></thead><tbody>${p.model.profiles.map(v=>`<tr><td>${esc(v.name)}</td><td>${v.outletMultiplier}</td><td>${v.hcMultiplier}</td><td>${v.mistEfficiency}</td><td>${v.maxFilmKg}</td></tr>`).join('')}</tbody></table><h3>根拠・仮定の記録</h3>${p.provenance.map(v=>`<div class="source-card"><span class="tag">${esc(v.classification)}</span><p>${esc(v.note)}</p>${v.url?`<a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">参照元を開く ↗</a>`:''}</div>`).join('')}<h3>モデル・保存版</h3><p><code>${esc(p.model.version)}</code> / schema ${p.schemaVersion}<br>熱v0.5、乳量表v0.6、受胎v0.7を統合。v0.9で日乳量仮説モデル <code>milk-heat-deficit-v0.1</code> を追加。モデルの対応範囲は拡張していません。</p>`);
}
