import type {Project,SimulationResult,PointResult,ScenarioResult} from '../domain/project.js';
import {activeScenario,devices,isFan} from '../domain/project.js';
import {buildLayout} from '../template/layout.js';
import {thi} from '../model/physics.js';
import {MILK_ROWS,milkReference,fertilityReference,FERTILITY_OR} from '../model/references.js';
import {esc,num,signed,icon,field,toggle,setHTML,el} from './dom.js';
import {deficitUnreached} from '../model/areaStats.js';
import type {Workspace} from './workspaceState.js';
import {comparisonContent,areaContent,heatExplanation} from './comparison.js';

export function selectedResults(p:Project,r:SimulationResult|null){
 const scenario=r?.scenarios.find(s=>s.id===p.activeScenarioId),base=r?.scenarios.find(s=>s.id===p.baselineScenarioId);
 return {scenario,base,point:scenario?.points.find(q=>q.probeId===p.view.selectedProbeId),baseline:base?.points.find(q=>q.probeId===p.view.selectedProbeId)};
}

/** Header: scenario tabs + shared-weather chip + fixed-baseline notice. */
export function renderHeader(p:Project){
 const s=activeScenario(p),e=p.environment;
 setHTML('scenario-tabs',p.scenarios.map(sc=>`<button data-scenario="${sc.id}" class="${s.id===sc.id?'active':''}">${esc(sc.name)}${sc.readOnly?' <span class="lock">Fixed</span>':''}</button>`).join(''));
 setHTML('weather-chip',`${icon('sun',15)}<b>${num(e.temperatureC,0)}℃</b> / ${num(e.relativeHumidityPct,0)}%<small>THI ${num(thi(e.temperatureC,e.relativeHumidityPct))} · shared by all scenarios</small>`);
 el('baseline-notice').hidden=!s.readOnly;
}

/** Top summary strip: selected-point deficit (60min) + scenario daily water/power. */
export function renderSummary(p:Project,r:SimulationResult|null){
 const {scenario:s,point:q}=selectedResults(p,r);
 const probe=buildLayout(p.template).probes.find(x=>x.id===p.view.selectedProbeId);
 el('sum-deficit-label').textContent=`${probe?.label??'—'} · cooling deficit (60-min mean)`;
 const dv=el('sum-deficit-value');
 if(!r)dv.textContent='Calculating…';
 else if(!q||q.status!=='valid'||q.meanDeficitW===null)dv.textContent='N/A';
 else dv.innerHTML=`${num(q.meanDeficitW,0)}<small> W</small>`;
 const dm=s?.dailyMilk,w=el('sum-water'),k=el('sum-power');
 if(!r||r.dailyMilkStatus==='pending'){w.textContent='Calculating…';k.textContent='Calculating…'}
 else if(dm?.status==='available'&&dm.resources){w.innerHTML=`${num(dm.resources.waterLPerDay,0)}<small> L/day</small>`;k.innerHTML=`${num(dm.resources.totalKwhPerDay,1)}<small> kWh/day</small>`}
 else{w.textContent='N/A';k.textContent='N/A'}
}

/** Weather panel: primary env fields (shared across scenarios). */
export function renderWeatherPanel(p:Project){
 setHTML('environment-fields',`${field('env-temperature','Outdoor temp',p.environment.temperatureC,'℃','data-env="temperatureC"',20,40,.5)}${field('env-humidity','Relative humidity',p.environment.relativeHumidityPct,'%','data-env="relativeHumidityPct"',10,100,1)}${field('env-solar','Solar on roof',p.environment.solarRoofWm2,'W/m²','data-env="solarRoofWm2"',0,1200,50)}<div class="thi-badge"><small>Outdoor THI</small><strong>${num(thi(p.environment.temperatureC,p.environment.relativeHumidityPct))}</strong></div>`);
 el('dimensions-label').textContent=`Freestall / 50 stalls · ${p.template.lengthM} × ${p.template.widthM} m · 70 evaluation points`;
 el('weather-note').textContent=p.dailyWeather.mode==='hourly'
  ?'Per-point results are a 60-min calculation (fixed weather). Daily milk and daily resources integrate hourly weather (0–23 h) on a representative day — edit under "Settings & save". Pressure, background wind and ventilation are shared across all hours.'
  :'Per-point results are a 60-min calculation. Daily milk assumes a representative day repeating the same weather for 24 h. Background wind speed and air exchange are under "Settings & save".';
}

/** Roof panel: whole-barn measures (existing toggles/details). */
export function renderRoofPanel(p:Project){
 const s=activeScenario(p),disabled=s.readOnly;
 setHTML('roof-controls',`
 ${toggle('roof-coating','Heat-reflective coating',`current solar reflectance ${num(s.roof.reflectance*100,0)}%`,s.roof.reflectance>.5,'data-roof-toggle="coating"','sun',disabled)}
 ${toggle('roof-insulation',`Insulation ${num(s.roof.insulationM>0?s.roof.insulationM*1000:20,0)}mm`,'adds thermal resistance',s.roof.insulationM>0,'data-roof-toggle="insulation"','layers',disabled)}
 ${toggle('roof-spray','Roof sprinkling',`${num(s.roof.onSec/60,1)} min ON / ${num(s.roof.offSec/60,1)} min OFF`,s.roof.sprayEnabled,'data-roof-toggle="sprayEnabled"','roof',disabled)}
 <details id="roof-details"><summary>Detailed roof settings</summary><div class="field-grid">${field('roof-reflectance','Solar reflectance',s.roof.reflectance,'','data-roof="reflectance"',0,1,.05,disabled)}${field('roof-insulation-m','Insulation thickness',s.roof.insulationM,'m','data-roof="insulationM"',0,.1,.01,disabled)}${field('roof-flow','Spray rate',s.roof.flowLpmM2,'L/min/m²','data-roof="flowLpmM2"',0,1,.01,disabled)}${field('roof-start','Start time',s.roof.dailyStartHour,'h','data-roof="dailyStartHour"',0,23.75,.25,disabled)}${field('roof-hours','Hours per day',s.roof.hoursPerDay,'h/day','data-roof="hoursPerDay"',0,24,1,disabled)}${field('roof-on','ON',s.roof.onSec/60,'min','data-roof="onSec" data-factor="60"',0,1440,1,disabled)}${field('roof-off','OFF',s.roof.offSec/60,'min','data-roof="offSec" data-factor="60"',0,1440,1,disabled)}</div><p class="micro">Daily operation repeats as "start time + hours per day". The 60-min results above show elapsed time since the device turns ON.</p></details>
 ${disabled?'<p class="micro warn">The baseline is fixed. Use "Try in Draft A" below to switch to an editable scenario.</p>':''}`);
}

/** Devices panel: per-system ON/OFF and the device picker. */
export function renderDevicesPanel(p:Project){
 const s=activeScenario(p),disabled=s.readOnly,soak=s.waterSystems.find(w=>w.kind==='soaker')!,mist=s.waterSystems.find(w=>w.kind==='mist')!;
 setHTML('system-controls',`
 ${toggle('fans-enabled','Circulation fans',`${s.fans.filter(f=>f.enabled).length} / ${s.fans.length} enabled`,s.fans.some(f=>f.enabled),'data-all-fans','fan',disabled)}
 ${toggle('soaker-enabled','Soakers',`${soak.nozzles.filter(n=>n.enabled).length} nozzles · wet the cow's body`,soak.enabled,`data-system-enabled="${soak.id}"`,'drop',disabled)}
 ${toggle('mist-enabled','Mist',`${mist.nozzles.filter(n=>n.enabled).length} nozzles · cool the air`,mist.enabled,`data-system-enabled="${mist.id}"`,'mist',disabled)}`);
 setHTML('device-selector',`<label class="sr-only" for="device-select">Device to edit</label><select id="device-select"><option value="">Select a device</option>${devices(s).map(d=>`<option value="${esc(d.id)}" ${p.view.selectedDeviceId===d.id?'selected':''}>${esc(d.label)}</option>`).join('')}</select>`);
}

/** Device editor: shown when a device is selected. */
export function renderDevicePanel(p:Project){
 const s=activeScenario(p),disabled=s.readOnly;
 const d=devices(s).find(d=>d.id===p.view.selectedDeviceId);
 if(!d){setHTML('device-properties',`<div class="empty-inspector">${icon('fan',30)}<p>Click a device in the barn.<br>Change its position, direction and height to experiment.</p><button data-action="select-first-fan" class="quiet">Select the first fan →</button></div>`);return}
 const fan=isFan(d),sys=s.waterSystems.find(w=>w.nozzles.some(n=>n.id===d.id));
 setHTML('device-properties',`<div class="selected-device"><strong>${esc(d.label)}</strong><label><input type="checkbox" id="device-enabled" data-device-enabled ${d.enabled?'checked':''} ${disabled?'disabled':''}> Enabled</label></div><div class="field-grid">
 ${field('device-x','Length X',d.x,'m','data-device="x"',0,p.template.lengthM,.1,disabled)}${field('device-y','Width Y',d.y,'m','data-device="y"',0,p.template.widthM,.1,disabled)}
 ${field('device-height','Height',d.heightM,'m','data-device="heightM"',fan?d.diameterM/2:1.8,4,.1,disabled)}${field('device-yaw','Direction',d.yawDeg,'°','data-device="yawDeg"',0,360,5,disabled)}${field('device-pitch','Downward angle',d.pitchDownDeg,'°','data-device="pitchDownDeg"',fan?0:30,90,5,disabled)}
 ${fan?field('device-outlet','Outlet speed',d.outletSpeedMps,'m/s','data-device="outletSpeedMps"',0,30,.5,disabled):field('device-flow','Nozzle flow',d.flowLpm,'L/min','data-device="flowLpm"',0,20,.1,disabled)}
 ${fan?field('device-hours','Hours per day',d.hoursPerDay,'h/day','data-device="hoursPerDay"',0,24,1,disabled):field('device-angle','Spray half-angle',d.halfAngleDeg,'°','data-device="halfAngleDeg"',1,85,5,disabled)}
 ${fan?field('device-start','Daily start',d.dailyStartHour,'h','data-device="dailyStartHour"',0,23.75,.25,disabled):''}
 </div>${sys?`<div class="section-label">Cycle for the whole system</div><div class="field-grid">${field('system-start','Start time',sys.dailyStartHour,'h',`data-system="dailyStartHour" data-system-id="${sys.id}"`,0,23.75,.25,disabled)}${field('system-hours','Hours per day',sys.hoursPerDay,'h/day',`data-system="hoursPerDay" data-system-id="${sys.id}"`,0,24,1,disabled)}${field('system-on','ON',sys.onSec/60,'min',`data-system="onSec" data-system-id="${sys.id}" data-factor="60"`,0,1440,1,disabled)}${field('system-off','OFF',sys.offSec/60,'min',`data-system="offSec" data-system-id="${sys.id}" data-factor="60"`,0,1440,1,disabled)}</div>`:''}<div class="device-actions"><button data-action="rotate" ${disabled?'disabled':''}>Rotate 90°</button><button data-action="duplicate" ${disabled?'disabled':''}>Duplicate</button><button data-action="remove" class="danger" ${disabled?'disabled':''}>Remove</button></div>${disabled?'<p class="micro warn">The baseline is read-only.</p>':''}`);
}

function kpi(label:string,value:number|null|undefined,unit:string,before:number|null|undefined,ic:string,description:string){
 const diff=value!=null&&before!=null?value-before:null;
 return `<div class="kpi"><div class="kpi-icon">${icon(ic,19)}</div><div><h3>${label}</h3><div class="kpi-value">${num(value)}<small>${unit}</small></div><p>Baseline ${num(before)} ${unit} <b class="${diff!==null&&diff<0?'good':''}">${diff===null?'':`→ ${signed(diff)} ${unit}`}</b></p><small class="micro">${description}</small></div></div>`;
}
function milkCard(p:Project,r:SimulationResult|null,s:ScenarioResult|null|undefined){
 const ms=p.milkSimulation,dm=s?.dailyMilk??null,dt=s?.dailyThermal??null,hourly=p.dailyWeather.mode==='hourly';
 const head=`<div class="reference-heading">${icon('cow',17)}<h3>Reference impact on milk yield</h3><span class="tag">hypothesis model</span></div>`;
 if(!r)return `<div class="reference-card">${head}<strong class="out-of-scope">—</strong><p>Waiting for calculation</p></div>`;
 if(r.dailyMilkStatus==='pending')return `<div class="reference-card">${head}<strong class="out-of-scope">Calculating milk…</strong><p>Separately from the 60-min results, a 48-hour herd-average representative day is being calculated.</p></div>`;
 if(!dm||dm.status!=='available'){
  const reasons=dm?.reasons?.length?dm.reasons:['Daily milk cannot be calculated for this scenario'];
  return `<div class="reference-card">${head}<strong class="out-of-scope">Not calculable</strong><p>${reasons.map(esc).join('<br>')}</p><p class="micro">It is not replaced with 0 kg. Environment, heat loss and resource values remain available.</p></div>`;
 }
 const delta=dm.deltaKgPerCowDay;
 return `<div class="reference-card milk-card">${head}
 <strong class="reference-value">${num(dm.yieldKgPerCowDay)} kg/cow/day</strong>
 <p>Difference from baseline <b class="${delta!==null&&delta<0?'':'good'}">${delta===null?'—':`${signed(delta)} kg/cow/day`}</b>${delta===null?' (baseline not calculable)':''}</p>
 ${dm.lossCapped?`<p class="micro"><b>Loss cap reached</b>: the reduction is limited to ${num(dm.potentialMilkKgPerCowDay*dm.maxLossFraction)} kg at most.</p>`:''}
 <p class="micro">Herd average, assuming the same representative day repeats (${hourly?'a virtual day cycling the 0–23 h hourly weather':'a virtual day repeating the current weather and solar for 24 h'}). Not a forecast.</p>
 <details id="milk-details"><summary>See assumptions and calculation</summary>
 <div class="field-grid">${field('milk-y0','Baseline daily milk Y0',ms.potentialMilkKgPerCowDay,'kg/cow/day','data-milk="potentialMilkKgPerCowDay"',.1,100,.5)}${field('milk-beta','Response coefficient beta',ms.responseKgPerCowDayPerW,'kg/cow/day/W','data-milk="responseKgPerCowDayPerW"',0,1,.001)}</div>
 <p class="micro"><button data-action="reset-milk" class="text-button">Reset milk assumptions to defaults</button></p>
 <table class="micro-table"><tbody>
 <tr><th>Daily load D</th><td>${num(dm.dailyDeficitWPerCow,1)} W/cow (time- and zone-weighted)</td></tr>
 ${dt?`<tr><th>Daily point-mean deficit</th><td>${num(dt.all?.meanDeficitW,1)} W / max ${num(dt.all?.maxDeficitW,1)} W (${dt.weatherMode==='hourly'?'hourly':'fixed'} weather)</td></tr>`:''}
 <tr><th>Lagged E</th><td>${num(dm.laggedDeficitWPerCow,1)} W/cow (D=E in same-day-repeat mode)</td></tr>
 <tr><th>Formula</th><td>Y = Y0 − min(Y0×${dm.maxLossFraction}, beta×E), Qref=${num(dm.referenceCoolingWPerCow,0)} W</td></tr>
 <tr><th>Occupancy</th><td>${dm.zoneCounts.stall} stall, ${dm.zoneCounts.feeding} feeding and ${dm.zoneCounts.waiting} other points, weighted as 14/6/4 h. "Other" is proxied by the robot-queue points.</td></tr>
 <tr><th>Operation</th><td>24 h warmup + 24 h evaluation at 1 s steps; daily windows start at each device's start time (default 08:00). Residual water carries over across days.</td></tr>
 </tbody></table>
 <table class="micro-table"><thead><tr><th>beta</th><th>Y</th><th>vs baseline</th></tr></thead><tbody>${dm.sensitivities.map(sx=>`<tr><td>${sx.beta}</td><td>${num(sx.yieldKgPerCowDay)} kg${sx.lossCapped?' <small>(capped)</small>':''}</td><td>${sx.deltaKgPerCowDay===null?'—':signed(sx.deltaKgPerCowDay)}</td></tr>`).join('')}</tbody></table>
 <p class="micro">Assumption class: demo_assumption. Coefficients are not literature regressions, and accuracy on real farms is unverified. The published 6-condition milk table remains under the reference tab.</p>
 </details>
 <button data-action="references" class="text-button">View the published table (reference) →</button></div>`;
}

/** Probe panel: selected evaluation point — name, 60-min means, baseline deltas, detail entry. */
export function renderProbePanel(p:Project,r:SimulationResult|null){
 const {point:q,baseline:b,scenario:s}=selectedResults(p,r),delta=q?.deltaQrefW??null;
 const probe=buildLayout(p.template).probes.find(x=>x.id===p.view.selectedProbeId);
 const fractions=(v:number|null|undefined)=>v==null?'—':`${num(v*100,0)}%`;
 el<HTMLSelectElement>('probe-select').innerHTML=buildLayout(p.template).probes.map(q=>`<option value="${q.id}" ${q.id===p.view.selectedProbeId?'selected':''}>${esc(q.label)} · height ${q.heightM}m</option>`).join('');
 setHTML('results',`<div class="hero-result"><span>${icon('cow',18)} Cow heat-loss improvement <small>reference</small></span><div class="hero-value">${signed(delta,0)}<small>W</small></div><p>Compares the same representative cow surface against the baseline</p><div class="range">Range under varied assumptions ${q?.parameterEnvelopeW?`${signed(q.parameterEnvelopeW[0],0)} – ${signed(q.parameterEnvelopeW[1],0)} W`:'—'}</div></div>
 ${kpi('Cooling deficit',q?.meanDeficitW,'W',b?.meanDeficitW,'temp',`Mean of per-second integration against Qref ${num(p.milkSimulation.referenceCoolingWPerCow,0)} W. 0 means no deficit`)}
 ${kpi('Air temp at cow',q?.meanAirTemperatureC,'℃',b?.meanAirTemperatureC,'temp',`local humidity ${num(q?.meanRelativeHumidityPct)}%`)}
 ${kpi('Roof cavity temp',s?.roof.meanUnderC,'℃',s?selectedResults(p,r).base?.roof.meanUnderC:null,'roof',`mean radiant temp ${num(q?.meanRadiantC)}℃`)}
 ${kpi('Fan-aided feels-like',q?.meanFeelsLikeC,'℃',b?.meanFeelsLikeC,'fan',`JDLA published formula · wind ${num(q?.meanSpeedMps,2)}m/s`)}
 ${heatExplanation(q,b)}
 <details id="probe-detail" class="probe-detail"><summary>Wetting, heat-loss breakdown and device action</summary><table class="micro-table"><tbody>
 <tr><th>Evaluation height</th><td>${num(probe?.heightM,2)} m (${esc(probe?.label??'')})</td></tr>
 <tr><th>Wetting</th><td>captured ${num(q?.film?.capturedKg,3)} kg · condensed ${num(q?.film?.condensedKg,3)} kg · evaporated ${num(q?.film?.evaporatedKg,3)} kg · runoff ${num(q?.film?.runoffKg,3)} kg (60-min cumulative)</td></tr>
 <tr><th>Water film</th><td>mean ${num(q?.meanFilmKg,3)} kg · final ${num(q?.film?.finalKg,3)} kg · max residual ${num(q?.film?.maxResidualKg,4)} kg</td></tr>
 <tr><th>Heat-loss breakdown</th><td>convection ${num(q?.components?.convectionW)} + radiation ${num(q?.components?.radiationW)} + base evaporation ${num(q?.components?.baseEvaporationW)} + soaker evaporation ${num(q?.components?.soakerEvaporationW)} + condensation ${num(q?.components?.condensationW)} W (signed 60-min means)</td></tr>
 <tr><th>Device action</th><td>fan effect ${fractions(q?.fanActionFraction)} · soaker arrival ${fractions(q?.soakerArrivalFraction)} · mist evaporation ${fractions(q?.mistEvaporationActionFraction)} (supply ${fractions(q?.mistSupplyFraction)}) — fraction of the 60 min</td></tr>
 ${q?.status==='invalid'?`<tr><th>Invalid reason</th><td>${q.warnings.map(esc).join('<br>')}</td></tr>`:''}
 </tbody></table>
 ${q&&deficitUnreached(q)?'<p class="micro warn">Cooling deficit remains and no local device action is present (try changing face position or direction). "Action" is a delivery diagnostic, separate from effect.</p>':''}
 <p class="micro">Wetting breakdown is cumulative kg over 60 min; mean water film is kg. A heat-loss improvement of 0 does not mean "no deficit".</p></details>
 <p class="micro"><button data-action="results" class="text-button">Open comparison &amp; reference impacts →</button></p>
 ${s?.warnings.length?`<details id="warning-detail"><summary>${s.warnings.length} calculation note(s)</summary>${s.warnings.map(w=>`<p class="micro">${esc(w)}</p>`).join('')}</details>`:''}`);
}

/** Reference-impact tab: daily milk hypothesis, fertility scenario, daily resources. */
export function renderReferencePane(p:Project,r:SimulationResult|null){
 const {point:q,baseline:b,scenario:s}=selectedResults(p,r),fert=q?.fertility;
 const fdelta=fert?.probability!=null&&b?.fertility.probability!=null?(fert.probability-b.fertility.probability)*100:null;
 const res=s?.dailyMilk?.resources??null;
 const cost=res&&p.prices.electricityYenKwh!==null&&p.prices.waterYenM3!==null?res.totalKwhPerDay*p.prices.electricityYenKwh+res.waterLPerDay/1000*p.prices.waterYenM3:null;
 setHTML('reference-pane',`
 ${milkCard(p,r,s)}
 <div class="reference-card"><div class="reference-heading">${icon('heart',17)}<h3>Conception-rate scenario</h3></div><div class="fertility-value">${num(fert?.probability==null?null:fert.probability*100)}<small>%</small><span class="tag">${p.references.fertility.mode==='manual'?'independent representative environment':'point weather applied'}</span></div><p>${p.references.fertility.mode==='manual'?`reference ${p.references.fertility.temperatureC}℃ / ${p.references.fertility.relativeHumidityPct}%RH`: `difference from baseline ${signed(fdelta,2)} pts · ${fdelta===0?'same reference band':'comparison of weather bands'}`}<br>Assumes representative conditions from 21 days before to 30 days after insemination. Baseline conception ${num(p.references.fertility.p0*100,0)}%. A different time model from daily milk.</p><button data-action="references" class="text-button">Review period assumptions &amp; inputs →</button></div>
 <div class="resource-cards"><div>${icon('drop',18)}<span>Water <small>whole scenario / day</small></span><strong>${res===null?'Not calculated':num(res.waterLPerDay,0)}${res===null?'':'<small>L</small>'}</strong></div><div>${icon('bolt',18)}<span>Energy use <small>whole scenario / day</small></span><strong>${res===null?'Not calculated':num(res.totalKwhPerDay,1)}${res===null?'':'<small>kWh</small>'}</strong></div></div>
 <p class="micro">Daily running cost: ${cost==null?'not evaluated (check calculation and unit prices)':num(cost,0)+' yen/day'}. A rough estimate from the entered unit prices; excludes installation cost and payback.</p>
 <p class="micro">The temperature and heat-loss cards above are per-point 60-min means after the device turns ON. Water, energy use and milk integrate the 24-hour operation mask of the evaluation day.</p>
 <div class="result-note">Conversion of heat loss (W) into milk yield uses only the hypothesis model milk-heat-deficit-v0.1. It is not a guaranteed value for cow core temperature or real-farm outcomes.</div>`);
}

export function renderComparison(p:Project,r:SimulationResult|null){
 setHTML('comparison',comparisonContent(p,r));
 el<HTMLButtonElement>('reset-active').disabled=activeScenario(p).readOnly;el<HTMLButtonElement>('copy-scenario').disabled=activeScenario(p).readOnly;
}
export function renderAreas(p:Project,r:SimulationResult|null){setHTML('area-summary',areaContent(p,r))}
export function renderSettings(p:Project){
 const hourly=p.dailyWeather.mode==='hourly';
 const weatherTable=hourly?`<div class="table-scroll weather-table"><table><thead><tr><th>Hour</th><th>Temp ℃</th><th>RH %</th><th>Solar on roof W/m²</th></tr></thead><tbody>${p.dailyWeather.hours.map(h=>`<tr><th>${h.hour}</th><td><input type="number" data-weather-hour="${h.hour}" data-weather-field="temperatureC" value="${h.temperatureC}" min="20" max="40" step="0.5"></td><td><input type="number" data-weather-hour="${h.hour}" data-weather-field="relativeHumidityPct" value="${h.relativeHumidityPct}" min="0" max="100" step="1"></td><td><input type="number" data-weather-hour="${h.hour}" data-weather-field="solarRoofWm2" value="${h.solarRoofWm2}" min="0" max="1200" step="50"></td></tr>`).join('')}</tbody></table></div><button data-action="weather-fill-env" class="text-button">Copy current outdoor conditions to all hours</button>`:'';
 setHTML('settings-body',`<h3>Model barn</h3><p>Dimensions are shared by all scenarios. Relative device positions and stalls are updated together.</p><div class="field-grid">${field('barn-length','Length',p.template.lengthM,'m','data-template="lengthM"',32,48,.1)}${field('barn-width','Width',p.template.widthM,'m','data-template="widthM"',23.5,30,.1)}${field('background-wind','Background wind',p.environment.backgroundSpeedMps,'m/s','data-env="backgroundSpeedMps"',0,10,.01)}${field('ventilation','Air exchange',p.environment.ventilationM3sPerM2,'m³/s/m²','data-env="ventilationM3sPerM2"',.0001,1,.001)}</div><p class="micro">Adding circulation fans does not increase ventilation. 50 stalls, eaves 4 m and ridge 8.7 m are fixed.</p>
 <h3>Representative-day weather (daily simulation only)</h3><label class="weather-mode"><input type="checkbox" data-weather-mode ${hourly?'checked':''}> Use hourly weather for 0–23 h</label><p class="micro">When ON, daily milk and daily resources integrate hourly temperature, humidity and roof solar. This is a repeating representative day, not a forecast. The 60-min results above always use fixed weather. Pressure, background wind and ventilation are shared across all hours.</p>${weatherTable}
 <h3>Unit prices for daily running-cost estimate</h3><div class="field-grid">${field('price-electricity','Electricity',p.prices.electricityYenKwh,'yen/kWh','data-price="electricityYenKwh"',0,1e6,1)}${field('price-water','Water',p.prices.waterYenM3,'yen/m³','data-price="waterYenM3"',0,1e6,1)}</div><p class="micro">Hypothetical unit prices, not actual rates. Leave blank to hide cost only.</p><h3>Save &amp; restore</h3><button data-action="paste-project">Import MCP scenario JSON</button><p class="micro">Paste a full MCP evaluate response or a project JSON. A saved JSON file can also be restored via "Load" above.</p><p>The current save format is schemaVersion 10 (v9 saves and MCP output are converted automatically). Older formats (v8, v4, etc.) are not loaded. If loading fails, the current scenario is kept.</p><button data-action="restore-local">Restore last save on this device</button><p class="micro">Stored on this device only — nothing is sent to a server. Even if browser settings block local storage, JSON save still works.</p>`)}
export function renderReference(p:Project){
 const f=p.references.fertility,calc=fertilityReference({...f,mode:'manual',exposureAssumed:true},null,null);
 setHTML('reference-body',`<h3>Milk: reference the published table as-is</h3><p>This table is separate from the current barn calculation. It is reflected in the result card only when actual local conditions match.</p>${field('baseline-milk','Baseline milk at mild temperature',p.references.baselineMilkKgPerDay,'kg/cow/day','data-milk-baseline',0,100,.5)}<div class="table-scroll"><table><thead><tr><th>Temp</th><th>Wind speed</th><th>Milk ratio</th><th>Reference kg/cow/day</th></tr></thead><tbody>${MILK_ROWS.map(row=>`<tr><td>${row.temperatureC}℃</td><td>${row.speedMps} m/s</td><td>${row.ratioPct}%</td><td>${num(milkReference(row.temperatureC,65,row.speedMps,p.references.baselineMilkKgPerDay).kgPerDay,2)}</td></tr>`).join('')}</tbody></table></div><p class="micro">Excerpt from JDLA COWBELL No.178 p.8, Japanese Feeding Standard 2017 and Shibata et al. 1984. Relative humidity 60–70%. No time variation, interpolation, extrapolation or nearest-neighbour rounding.</p>
 <hr><h3>Conception: 52-day representative environment</h3><p>A reference success probability per artificial insemination — not the probability at this instant.</p><div class="assumption-box"><label><input id="fertility-linked" type="checkbox" data-fertility-linked ${f.mode==='simulation'?'checked':''}> Adopt the selected point's 60-min mean temperature/humidity as the representative environment from 21 days before to 30 days after insemination</label><p class="micro">This does not measure or forecast the environment over the period; it is an added assumption that all 5 periods share the same conditions.</p></div>
 <div class="field-grid">${field('fertility-baseline','Hypothetical baseline conception',f.p0*100,'%','data-fertility="p0" data-factor="0.01"',.1,99.9,1)}${field('fertility-t','Manual reference temp',f.temperatureC,'℃','data-fertility="temperatureC"',-20,50,.5,f.mode==='simulation')}${field('fertility-rh','Manual reference RH',f.relativeHumidityPct,'%','data-fertility="relativeHumidityPct"',0,100,1,f.mode==='simulation')}</div><p>Reference value under manual conditions: <strong>${num((calc.probability??0)*100)}%</strong> / THI ${num(calc.thi,2)}</p><p class="micro">Uses the 5-period OR from Baccouri et al. (2025) Table 2. Baseline 40% is an assumption. Applying station THI to the cow position is also an added assumption. Values do not change within the same THI band. Direct effects of radiation, fans and cow sprinkling are not added.</p>`);
}
export function renderEvidence(p:Project,r:SimulationResult|null){
 const {point:q}=selectedResults(p,r);
 setHTML('evidence-body',`<div class="assumption-box"><strong>What this app computes</strong><p>It compares device placement → roof &amp; local environment → net heat loss of a representative cow. Milk and conception are separate reference models that use only justified conditions.</p></div><h3>Outputs are not mixed</h3><table><tbody><tr><th>Fan-aided feels-like</th><td>T − 6√v. Radiation and water are not added in ℃.</td></tr><tr><th>Heat-loss improvement</th><td>Difference from baseline of convection + radiation + evaporation − condensation. Compared at a fixed 35℃ skin temperature.</td></tr><tr><th>Milk</th><td>Daily milk is the herd average of the hypothesis model milk-heat-deficit-v0.1. The published table covers 6 conditions only, returns null otherwise, and is never interpolated.</td></tr><tr><th>Conception</th><td>5-period THI-band OR × a hypothetical baseline odds. Treating the 60-min result as a 52-day representative is an explicit assumption.</td></tr></tbody></table>
 <h3>Current heat-loss breakdown <small>60-min mean</small></h3><table><tbody>${q?.components?Object.entries(q.components).map(([k,v])=>`<tr><th>${({convectionW:'Convection',radiationW:'Radiation',baseEvaporationW:'Base effective evaporation',soakerEvaporationW:'Soaker evaporation',condensationW:'Condensation'} as Record<string,string>)[k]}</th><td>${num(v,2)} W</td></tr>`).join(''):'<tr><td>Waiting for calculation</td></tr>'}</tbody></table>
 <h3>Reference range under varied assumptions</h3><p>Three coefficient sets: low, reference and high. Not actual bounds or a 95% confidence interval.</p><table><thead><tr><th>Set</th><th>Outlet-speed multiplier</th><th>Heat-transfer multiplier</th><th>Mist efficiency</th><th>Max film kg</th></tr></thead><tbody>${p.model.profiles.map(v=>`<tr><td>${esc(v.name)}</td><td>${v.outletMultiplier}</td><td>${v.hcMultiplier}</td><td>${v.mistEfficiency}</td><td>${v.maxFilmKg}</td></tr>`).join('')}</tbody></table><h3>Record of evidence &amp; assumptions</h3>${p.provenance.map(v=>`<div class="source-card"><span class="tag">${esc(v.classification)}</span><p>${esc(v.note)}</p>${v.url?`<a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`:''}</div>`).join('')}<h3>Model &amp; save version</h3><p><code>${esc(p.model.version)}</code> / schema ${p.schemaVersion}<br>Integrates heat v0.5, milk table v0.6 and conception v0.7. v0.9 added the daily-milk hypothesis model <code>milk-heat-deficit-v0.1</code>. The model's scope has not been extended.</p>`);
}
export function renderHelp(){
 setHTML('help-body',`<h3>Basic operations</h3><table><tbody>
 <tr><th>Place equipment</th><td>Press "Fan", "Soaker" or "Mist" in the dock, then click where you want it in the barn. Esc or "Cancel" exits.</td></tr>
 <tr><th>Move equipment</th><td>Click a device to select it, then drag to move. Change height, direction and speed in the right panel.</td></tr>
 <tr><th>Viewpoint</th><td>Drag the background to rotate, wheel to zoom. Shift+drag or right-drag pans. "All / Top / Side" return to preset views.</td></tr>
 <tr><th>Inspect a point</th><td>Click a colored face to select its representative point and see the 60-min mean results. The face color is that point's value — not an area-wide calculation.</td></tr>
 <tr><th>Compare scenarios</th><td>"Results &amp; compare" compares baseline and editable scenarios under the same weather.</td></tr></tbody></table>
 <h3>How to read the display</h3><table><tbody>
 <tr><th>Cooling deficit</th><td>60-min mean of the shortfall against reference heat loss Qref. 0 means no deficit; larger values are hotter points.</td></tr>
 <tr><th>Heat-loss improvement</th><td>Heat-loss difference from baseline. 0 means "same as baseline"; negative is worse.</td></tr>
 <tr><th>Water &amp; energy use</th><td>Daily totals for the whole scenario, integrated from the same 24-hour operation mask as daily milk.</td></tr>
 <tr><th>Wind &amp; spray</th><td>Fan airflow and droplets are schematic representations of device action. This is not CFD.</td></tr>
 <tr><th>Milk &amp; conception</th><td>Daily milk is a hypothesis model (demo_assumption); conception is a reference scenario by THI band. Neither predicts a real farm.</td></tr></tbody></table>
 <h3>Using it from an AI agent (MCP)</h3><table><tbody>
 <tr><th>Remote MCP</th><td>This model can be called by external agents via MCP (Model Context Protocol).<br><code>https://puzxplbkg2qglia72tkhs2z7km0jrusa.lambda-url.us-east-1.on.aws/</code><br>Tools: get_default_project / evaluate / compare_candidates / describe_model / get_doc.<br>compare_candidates: constrained comparison of 1–3 candidate operation sets — daily results, constraint verdicts and ranking.</td></tr>
 <tr><th>Public demo token</th><td><code>demo-581fKusGqNgk7YrycFNw6M_5</code> (public, free to use. Disabled individually if abused)</td></tr>
 <tr><th>Connection example</th><td><code>{"type":"http","url":"&lt;URL above&gt;","headers":{"Authorization":"Bearer demo-581fKusGqNgk7YrycFNw6M_5"}}</code></td></tr>
 <tr><th>Local MCP</th><td>Running <code>npm run mcp</code> in the repository enables the PoC where an AI directly operates the open page.</td></tr></tbody></table>
 <p class="micro"><button data-action="guide-restart" class="text-button">Watch the first-run guide again</button> · <button data-action="evidence" class="text-button">Model evidence and assumptions →</button></p>`);
}

const PANEL_TITLES:Record<string,string>={device:'Device',probe:'Point results',devices:'Devices & systems',roof:'Roof measures',weather:'Weather'};
const SHEET_TABS=['compare','areas','timeline','reference'] as const;

/** Panel visibility, view-mode chrome, legend, dock enablement, ghost/hint/guide. */
export function renderChrome(p:Project,r:SimulationResult|null,w:Workspace){
 const s=activeScenario(p),disabled=s.readOnly;
 const panel=el('selection-panel');panel.dataset.panel=w.panel??'';panel.hidden=w.panel===null||!w.guide.done;
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
 const m=p.view.metric;setHTML('legend',`<span>${m==='delta'?'−900 W':m==='speed'?'0 m/s':m==='deficit'?'0 W':'25℃'}</span><i class="legend-gradient ${m}"></i><span>${m==='delta'?'+900 W':m==='speed'?'3 m/s':m==='deficit'?'1200 W+':'40℃'}</span><span class="legend-note">hatching = invalid · aisles etc. are not evaluated</span>`);
 for(const [id]of [['place-fan'],['place-soaker'],['place-mist']] as const)el<HTMLButtonElement>(id).disabled=disabled;
 el<HTMLButtonElement>('roof-button').disabled=false;
 // Ghost placement hint: shows kind, candidate state, and a disabled-system note.
 const pl=w.placement,hint=el('placement-hint');hint.hidden=!pl;
 if(pl){
  const s2=activeScenario(p),sysOff=pl.kind!=='fan'&&!s2.waterSystems.find(x=>x.kind===pl.kind)!.enabled;
  const labels={fan:'Fan',soaker:'Soaker',mist:'Mist'} as const;
  el('placement-text').textContent=`${labels[pl.kind]}: click where to place it (Esc to cancel)${pl.valid?` · ${pl.x?.toFixed(1)}m, ${pl.y?.toFixed(1)}m`:''}${pl.x!==null&&!pl.valid?' · cannot place here':''}${sysOff?' · system is off':''}`;
  el<HTMLButtonElement>('confirm-placement').disabled=!pl.valid;
 }
 const g=el('guide-card');g.hidden=w.guide.done;
 if(!w.guide.done){
  const steps=[
   {t:'Ask an LLM (MCP)',x:'This simulator can be computed and compared by AI agents via MCP. See "? Help" at top right for how to connect.'},
   {t:'See the heat distribution',x:'Floor colors show the 60-min mean cooling deficit. Click a face to select its point.'},
   {t:'Pick a fan and move it',x:'Add one with "Fan" below; drag existing devices to move them.'},
   {t:'Compare with the baseline',x:'"Results & compare" shows the difference from the baseline under the same weather.'},
  ][w.guide.step]!;
  el('guide-title').textContent=`${w.guide.step+1}/4 ${steps.t}`;el('guide-text').textContent=steps.x;
 }
}
