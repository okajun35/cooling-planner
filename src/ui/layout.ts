import {icon} from './dom.js';
export function layout(){return `
<header class="topbar">
 <div class="brand"><span class="brand-mark">${icon('barn',24)}</span><strong>Cooling Planner</strong><span class="version">v0.9</span></div>
 <div id="scenario-tabs" class="segments" role="tablist" aria-label="Switch scenario"></div>
 <button id="weather-chip" data-action="weather" type="button" title="Open shared weather conditions"></button>
 <span id="status" role="status" data-state="calculating">Preparing</span>
 <div class="header-actions">
  <button data-action="evidence" class="quiet">${icon('info',15)} Evidence</button>
  <button data-action="help" class="quiet" title="How to operate and read results · AI agent (MCP) connection info">? Help</button>
  <button data-action="settings" class="quiet">Settings &amp; save</button>
  <button data-action="load" class="quiet">Load</button>
  <button data-action="save" class="primary">${icon('save',15)} Save</button>
 </div>
</header>
<div id="error-banner" role="alert" hidden><span id="error-message"></span><button data-action="dismiss-error" aria-label="Dismiss error">×</button></div>
<div class="summary-bar" aria-label="Selected point and scenario summary">
 <button class="sum-chip" data-action="panel-probe" id="sum-deficit" type="button"><small id="sum-deficit-label">Cooling deficit</small><b id="sum-deficit-value">—</b></button>
 <div class="sum-chip"><small>Water · whole scenario / day</small><b id="sum-water">—</b></div>
 <div class="sum-chip"><small>Power · whole scenario / day</small><b id="sum-power">—</b></div>
 <span class="summary-note">Summary: 60-min mean at the selected point, plus whole-scenario daily totals</span>
</div>
<main class="stage">
 <div id="scene"></div>
 <div class="scene-top-left"><span class="scene-label">Model barn</span><strong id="scene-selection"></strong></div>
 <div class="metric-tabs" id="metric-tabs" role="group" aria-label="Distribution metric"><button data-metric="deficit">Deficit</button><button data-metric="delta">Improvement</button><button data-metric="speed">Wind speed</button><button data-metric="temperature">Air temp</button></div>
 <div class="rail-left" role="group" aria-label="Display toggles">
  <label class="rail-toggle" title="Schematic view of fan airflow"><input id="show-flow" type="checkbox" data-view="flow">${icon('fan',17)}<span>Wind</span></label>
  <label class="rail-toggle" title="Schematic view of spraying"><input id="show-particles" type="checkbox" data-view="particles">${icon('drop',17)}<span>Spray</span></label>
  <label class="rail-toggle" title="Show one side of the roof"><input id="show-roof" type="checkbox" data-view="roof">${icon('roof',17)}<span>Roof</span></label>
  <label class="rail-toggle" title="Hide cows etc. and show faces only"><input id="show-analysis" type="checkbox" data-view="analysis">${icon('grid',17)}<span>Analysis</span></label>
  <label class="rail-toggle" id="heatmap-switch" title="Overlay results on the floor (realistic 3D only)" hidden><input id="show-heatmap" type="checkbox" data-view="heatmap">${icon('sun',17)}<span>Map</span></label>
 </div>
 <div class="view-controls"><div class="segments modes" role="group" aria-label="View mode"><button data-mode="3d">Standard 3D</button><button data-render="realistic">Realistic 3D</button><button data-mode="2d">2D</button></div>
 <div class="camera-buttons" role="group" aria-label="Camera view"><button data-camera="overview" title="View all">All</button><button data-camera="top" title="View from top">Top</button><button data-camera="side" title="View from side">Side</button></div></div>
 <div id="legend"></div>
 <div id="scene-live" class="scene-live"></div>
 <div id="realistic-note" class="realistic-note" hidden>Wind and droplets are schematic representations of device action · operating state changes with time</div>
 <div id="scene-busy" class="scene-busy" hidden>Recalculating with updated conditions…</div>
 <div id="placement-ghost" hidden aria-hidden="true"><span id="placement-ghost-label"></span></div>
 <div id="placement-hint" hidden><span id="placement-text"></span><button data-action="confirm-placement" id="confirm-placement" class="primary" disabled>Place here</button><button data-action="cancel-placement">Cancel</button></div>
 <aside id="selection-panel" data-panel="" hidden>
  <div class="panel-head"><strong id="panel-title"></strong><button data-action="close-panel" aria-label="Close panel">×</button></div>
  <div id="panel-device" class="panel-page" hidden><h3>Selected device</h3><div id="device-properties"></div><p class="micro"><button data-action="devices" class="text-button">← Back to device list</button></p></div>
  <div id="panel-devices" class="panel-page" hidden><h3>Devices &amp; systems</h3><div id="system-controls"></div><h3>Select a device</h3><div id="device-selector"></div><p class="micro">Use the fan / soaker / mist buttons in the dock to place new devices.</p><p class="micro"><button data-action="panel-roof" class="text-button">Open roof measures →</button></p></div>
  <div id="panel-probe" class="panel-page" hidden><div class="panel-subhead"><label class="sr-only" for="probe-select">Point to compare</label><select id="probe-select"></select></div><div id="results"></div></div>
  <div id="panel-roof" class="panel-page" hidden><h3>Roof measures <small>applies to the whole barn</small></h3><div id="roof-controls"></div></div>
  <div id="panel-weather" class="panel-page" hidden><h3>Weather <small>shared by all scenarios</small></h3><div id="environment-fields"></div><p class="micro" id="weather-note"></p><p class="micro" id="dimensions-label"></p></div>
 </aside>
 <section id="sheet" data-tab="" hidden>
  <div class="sheet-tabs" role="tablist" aria-label="Results and comparison">
   <button data-sheet="compare">Compare</button><button data-sheet="areas">Areas</button><button data-sheet="timeline">Timeline</button><button data-sheet="reference">Reference impacts</button>
   <span class="sheet-actions"><button data-action="export-results" class="quiet small">Results JSON</button><button data-action="close-sheet" aria-label="Close">×</button></span>
  </div>
  <div class="sheet-body">
   <div id="sheet-compare" class="sheet-page" hidden><div id="comparison"></div></div>
   <div id="sheet-areas" class="sheet-page" hidden><div id="area-summary"></div></div>
   <div id="sheet-timeline" class="sheet-page" hidden>
    <div class="timeline-heading"><strong>Spraying and heat loss over time <small>selected point · 0–60 min</small></strong><div class="chart-tabs"><button data-chart="qW" class="active">Heat loss</button><button data-chart="temperatureC">Air temp</button><button data-chart="filmKg">Water film</button></div></div>
    <div id="timeline-chart"></div>
    <div class="transport"><button data-action="play" id="play-button">${icon('play',15)} Play</button><input id="time-slider" type="range" min="0" max="3600" step="1" value="0" aria-label="Displayed time"><output id="time-display">00:00</output><select id="play-speed" aria-label="Playback speed"><option value="60">60×</option><option value="120" selected>120×</option><option value="300">300×</option></select></div>
    <p class="micro">Cards and colors show 60-min means. Playback displays the precomputed time series. It is not a time forecast of milk yield or conception.</p>
   </div>
   <div id="sheet-reference" class="sheet-page" hidden><div id="reference-pane"></div></div>
  </div>
 </section>
 <div id="guide-card" hidden><b id="guide-title"></b><p id="guide-text"></p><div class="guide-actions"><button data-action="guide-next" id="guide-next" class="primary small">Next</button><button data-action="guide-skip" class="quiet small">Skip</button></div></div>
</main>
<footer class="dock">
 <div class="dock-group" role="group" aria-label="Place equipment">
  <button data-action="place-fan" id="place-fan" title="Strengthen airflow around the cows">${icon('fan',18)}<span>Fan</span></button>
  <button data-action="place-soaker" id="place-soaker" title="Wet the cow's body to promote evaporative heat loss">${icon('drop',18)}<span>Soaker</span></button>
  <button data-action="place-mist" id="place-mist" title="Cool the air by evaporation. Humidity also changes">${icon('mist',18)}<span>Mist</span></button>
  <button data-action="panel-roof" id="roof-button" title="Change conditions for heat coming from the roof">${icon('roof',18)}<span>Roof</span></button>
  <button data-action="devices" id="devices-button" title="Device list and system ON/OFF">${icon('grid',18)}<span>Devices</span></button>
 </div>
 <div id="baseline-notice" hidden><span>The baseline is fixed</span><button data-action="try-editable" class="small primary">Try in Draft A</button></div>
 <div class="dock-group"><button data-action="undo" id="undo-button" title="Undo">↶</button><button data-action="redo" id="redo-button" title="Redo">↷</button></div>
 <span class="dock-spacer"></span>
 <button data-action="cycle" id="cycle-button" title="Spray cycle · 0–60 min">${icon('play',14)} View cycle</button>
 <button data-action="results" id="results-button" class="primary">Results &amp; compare</button>
 <button data-action="help" id="help-button" aria-label="Help">？</button>
</footer>
<dialog id="evidence-dialog"><div class="dialog-head"><h2>Model evidence and assumptions</h2><button data-close="evidence-dialog" aria-label="Close">×</button></div><div id="evidence-body"></div></dialog>
<dialog id="settings-dialog"><div class="dialog-head"><h2>Shared settings &amp; save</h2><button data-close="settings-dialog" aria-label="Close">×</button></div><div id="settings-body"></div></dialog>
<dialog id="reference-dialog"><div class="dialog-head"><h2>Reference conditions: milk &amp; conception</h2><button data-close="reference-dialog" aria-label="Close">×</button></div><div id="reference-body"></div></dialog>
<dialog id="help-dialog"><div class="dialog-head"><h2>How to operate and read results</h2><button data-close="help-dialog" aria-label="Close">×</button></div><div id="help-body"></div></dialog>
<input id="file-input" type="file" accept=".json,application/json" hidden><div id="toast" role="status" hidden></div>`}
