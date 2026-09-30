import {icon} from './dom.js';
export function layout(){return `
<header class="topbar">
 <div class="brand"><span class="brand-mark">${icon('barn',24)}</span><strong>Cooling Planner</strong><span class="version">v0.9</span></div>
 <div id="scenario-tabs" class="segments" role="tablist" aria-label="案の切り替え"></div>
 <button id="weather-chip" data-action="weather" type="button" title="共通の気象条件を開く"></button>
 <span id="status" role="status" data-state="calculating">計算準備中</span>
 <div class="header-actions">
  <button data-action="evidence" class="quiet">${icon('info',15)} 根拠</button>
  <button data-action="help" class="quiet" title="操作と結果の読み方・AIエージェント(MCP)接続情報">？ ヘルプ</button>
  <button data-action="settings" class="quiet">設定・保存</button>
  <button data-action="load" class="quiet">読込</button>
  <button data-action="save" class="primary">${icon('save',15)} 保存</button>
 </div>
</header>
<div id="error-banner" role="alert" hidden><span id="error-message"></span><button data-action="dismiss-error" aria-label="エラーを閉じる">×</button></div>
<div class="summary-bar" aria-label="選択地点と案の要約">
 <button class="sum-chip" data-action="panel-probe" id="sum-deficit" type="button"><small id="sum-deficit-label">放熱不足</small><b id="sum-deficit-value">—</b></button>
 <div class="sum-chip"><small>水 · 案全体 / 日</small><b id="sum-water">—</b></div>
 <div class="sum-chip"><small>電力 · 案全体 / 日</small><b id="sum-power">—</b></div>
 <span class="summary-note">要約は選択地点の60分平均と、案全体の日集計</span>
</div>
<main class="stage">
 <div id="scene"></div>
 <div class="scene-top-left"><span class="scene-label">モデル牛舎</span><strong id="scene-selection"></strong></div>
 <div class="metric-tabs" id="metric-tabs" role="group" aria-label="分布の指標"><button data-metric="deficit">放熱不足</button><button data-metric="delta">放熱改善</button><button data-metric="speed">風速</button><button data-metric="temperature">気温</button></div>
 <div class="rail-left" role="group" aria-label="表示の切り替え">
  <label class="rail-toggle" title="ファン風の模式表示"><input id="show-flow" type="checkbox" data-view="flow">${icon('fan',17)}<span>風</span></label>
  <label class="rail-toggle" title="散水の模式表示"><input id="show-particles" type="checkbox" data-view="particles">${icon('drop',17)}<span>散水</span></label>
  <label class="rail-toggle" title="片側の屋根を表示"><input id="show-roof" type="checkbox" data-view="roof">${icon('roof',17)}<span>屋根</span></label>
  <label class="rail-toggle" title="牛等を隠して面だけ見る"><input id="show-analysis" type="checkbox" data-view="analysis">${icon('grid',17)}<span>分析</span></label>
  <label class="rail-toggle" id="heatmap-switch" title="床へ計算結果を重ねる（リアル3Dのみ）" hidden><input id="show-heatmap" type="checkbox" data-view="heatmap">${icon('sun',17)}<span>分布</span></label>
 </div>
 <div class="view-controls"><div class="segments modes" role="group" aria-label="表示モード"><button data-mode="3d">標準3D</button><button data-render="realistic">リアル3D</button><button data-mode="2d">2D</button></div>
 <div class="camera-buttons" role="group" aria-label="カメラ視点"><button data-camera="overview" title="全体を見る">全体</button><button data-camera="top" title="上面から見る">上面</button><button data-camera="side" title="側面から見る">側面</button></div></div>
 <div id="legend"></div>
 <div id="scene-live" class="scene-live"></div>
 <div id="realistic-note" class="realistic-note" hidden>風・水滴は作用の模式表現 · 時刻で運転状態を切替</div>
 <div id="scene-busy" class="scene-busy" hidden>変更した条件で再計算中…</div>
 <div id="placement-ghost" hidden aria-hidden="true"><span id="placement-ghost-label"></span></div>
 <div id="placement-hint" hidden><span id="placement-text"></span><button data-action="confirm-placement" id="confirm-placement" class="primary" disabled>ここに置く</button><button data-action="cancel-placement">中止</button></div>
 <aside id="selection-panel" data-panel="" hidden>
  <div class="panel-head"><strong id="panel-title"></strong><button data-action="close-panel" aria-label="パネルを閉じる">×</button></div>
  <div id="panel-device" class="panel-page" hidden><h3>選択中の設備</h3><div id="device-properties"></div><p class="micro"><button data-action="devices" class="text-button">← 設備一覧に戻る</button></p></div>
  <div id="panel-devices" class="panel-page" hidden><h3>設備・系統</h3><div id="system-controls"></div><h3>設備を選ぶ</h3><div id="device-selector"></div><p class="micro">ドックのファン・ソーカー・ミストボタンで新しい設備を配置できます。</p><p class="micro"><button data-action="panel-roof" class="text-button">屋根対策を開く →</button></p></div>
  <div id="panel-probe" class="panel-page" hidden><div class="panel-subhead"><label class="sr-only" for="probe-select">比較する地点</label><select id="probe-select"></select></div><div id="results"></div></div>
  <div id="panel-roof" class="panel-page" hidden><h3>屋根対策 <small>牛舎全体に適用</small></h3><div id="roof-controls"></div></div>
  <div id="panel-weather" class="panel-page" hidden><h3>気象条件 <small>全案共通</small></h3><div id="environment-fields"></div><p class="micro">地点別は60分計算。日乳量は同じ気象を24時間反復した代表日です。背景風速・空気交換は「設定・保存」にあります。</p><p class="micro" id="dimensions-label"></p></div>
 </aside>
 <section id="sheet" data-tab="" hidden>
  <div class="sheet-tabs" role="tablist" aria-label="結果と比較">
   <button data-sheet="compare">案比較</button><button data-sheet="areas">エリア</button><button data-sheet="timeline">時間変化</button><button data-sheet="reference">参考影響</button>
   <span class="sheet-actions"><button data-action="export-results" class="quiet small">結果JSON</button><button data-action="close-sheet" aria-label="閉じる">×</button></span>
  </div>
  <div class="sheet-body">
   <div id="sheet-compare" class="sheet-page" hidden><div id="comparison"></div></div>
   <div id="sheet-areas" class="sheet-page" hidden><div id="area-summary"></div></div>
   <div id="sheet-timeline" class="sheet-page" hidden>
    <div class="timeline-heading"><strong>散水と放熱の変化 <small>選択地点・0〜60分</small></strong><div class="chart-tabs"><button data-chart="qW" class="active">放熱量</button><button data-chart="temperatureC">気温</button><button data-chart="filmKg">保持水</button></div></div>
    <div id="timeline-chart"></div>
    <div class="transport"><button data-action="play" id="play-button">${icon('play',15)} 再生</button><input id="time-slider" type="range" min="0" max="3600" step="1" value="0" aria-label="表示時刻"><output id="time-display">00:00</output><select id="play-speed" aria-label="再生倍率"><option value="60">60倍</option><option value="120" selected>120倍</option><option value="300">300倍</option></select></div>
    <p class="micro">カードと色は60分平均。再生は計算済みの時系列を表示します。乳量・受胎の時間予測ではありません。</p>
   </div>
   <div id="sheet-reference" class="sheet-page" hidden><div id="reference-pane"></div></div>
  </div>
 </section>
 <div id="guide-card" hidden><b id="guide-title"></b><p id="guide-text"></p><div class="guide-actions"><button data-action="guide-next" id="guide-next" class="primary small">次へ</button><button data-action="guide-skip" class="quiet small">スキップ</button></div></div>
</main>
<footer class="dock">
 <div class="dock-group" role="group" aria-label="設備を置く">
  <button data-action="place-fan" id="place-fan" title="牛の周囲の風を強める">${icon('fan',18)}<span>ファン</span></button>
  <button data-action="place-soaker" id="place-soaker" title="牛体を濡らし、蒸発による放熱を促す">${icon('drop',18)}<span>ソーカー</span></button>
  <button data-action="place-mist" id="place-mist" title="蒸発で空気を冷やす。湿度も変わる">${icon('mist',18)}<span>ミスト</span></button>
  <button data-action="panel-roof" id="roof-button" title="屋根から受ける熱の条件を変える">${icon('roof',18)}<span>屋根対策</span></button>
  <button data-action="devices" id="devices-button" title="設備の一覧と系統のON/OFF">${icon('grid',18)}<span>設備一覧</span></button>
 </div>
 <div id="baseline-notice" hidden><span>基準案は固定です</span><button data-action="try-editable" class="small primary">編集案 A で試す</button></div>
 <div class="dock-group"><button data-action="undo" id="undo-button" title="戻す">↶</button><button data-action="redo" id="redo-button" title="やり直す">↷</button></div>
 <span class="dock-spacer"></span>
 <button data-action="cycle" id="cycle-button" title="散水サイクル・0〜60分">${icon('play',14)} サイクルを見る</button>
 <button data-action="results" id="results-button" class="primary">結果・比較</button>
 <button data-action="help" id="help-button" aria-label="ヘルプ">？</button>
</footer>
<dialog id="evidence-dialog"><div class="dialog-head"><h2>モデルの根拠と仮定</h2><button data-close="evidence-dialog" aria-label="閉じる">×</button></div><div id="evidence-body"></div></dialog>
<dialog id="settings-dialog"><div class="dialog-head"><h2>共通設定・保存</h2><button data-close="settings-dialog" aria-label="閉じる">×</button></div><div id="settings-body"></div></dialog>
<dialog id="reference-dialog"><div class="dialog-head"><h2>乳量・受胎の参照条件</h2><button data-close="reference-dialog" aria-label="閉じる">×</button></div><div id="reference-body"></div></dialog>
<dialog id="help-dialog"><div class="dialog-head"><h2>操作と結果の読み方</h2><button data-close="help-dialog" aria-label="閉じる">×</button></div><div id="help-body"></div></dialog>
<input id="file-input" type="file" accept=".json,application/json" hidden><div id="toast" role="status" hidden></div>`}
