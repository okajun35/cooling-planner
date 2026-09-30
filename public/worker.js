(()=>{'use strict';const modules={"worker/simulation.worker.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const simulation_js_1 = require("../model/simulation.js");
const dailySimulation_js_1 = require("../model/dailySimulation.js");
const validation_js_1 = require("../domain/validation.js");
const scope = globalThis;
scope.onmessage = (e) => {
    const { jobId, inputHash: expected, project } = e.data;
    try {
        (0, validation_js_1.validateProject)(project);
        if ((0, simulation_js_1.inputHash)(project) !== expected)
            throw Error('入力ハッシュ不一致');
        // Stage 1: existing 60-minute result. Stage 2: representative-day milk aggregation.
        scope.postMessage({ jobId, inputHash: expected, kind: 'thermal-result', result: (0, simulation_js_1.simulate)(project) });
        try {
            const daily = (0, dailySimulation_js_1.simulateDaily)(project);
            scope.postMessage({ jobId, inputHash: expected, kind: 'daily-result', daily: daily.daily, thermal: daily.thermal, dailyMilkStatus: daily.status === 'error' ? 'error' : 'complete' });
        }
        catch {
            scope.postMessage({ jobId, inputHash: expected, kind: 'daily-result', daily: {}, thermal: {}, dailyMilkStatus: 'error' });
        }
    }
    catch (err) {
        scope.postMessage({ jobId, inputHash: expected, kind: 'error', error: err instanceof Error ? err.message : String(err) });
    }
};

},
"model/simulation.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scenarioInput = void 0;
exports.resources = resources;
exports.trialResources = trialResources;
exports.stableStringify = stableStringify;
exports.inputHash = inputHash;
exports.mistDistribution = mistDistribution;
exports.simulate = simulate;
const layout_js_1 = require("../template/layout.js");
const geometry_js_1 = require("./geometry.js");
const physics_js_1 = require("./physics.js");
const roof_js_1 = require("./roof.js");
const references_js_1 = require("./references.js");
function resources(s, p) {
    const fanKwhPerDay = s.fans.reduce((sum, f) => sum + (f.enabled ? f.powerKw * f.hoursPerDay : 0), 0);
    const systems = s.waterSystems.map(w => {
        const flow = w.nozzles.reduce((sum, n) => sum + (n.enabled ? n.flowLpm : 0), 0), onTotalSec = w.enabled && flow > 0 ? (0, physics_js_1.onTotalSeconds)(w.hoursPerDay, w.onSec, w.offSec) : 0;
        return { kind: w.kind, waterL: flow * onTotalSec / 60, pumpKwh: w.pumpPowerKw * onTotalSec / 3600, onTotalSec };
    });
    if (p) {
        const r = s.roof, onTotalSec = r.sprayEnabled && r.flowLpmM2 > 0 ? (0, physics_js_1.onTotalSeconds)(r.hoursPerDay, r.onSec, r.offSec) : 0;
        systems.push({ kind: 'roof', waterL: (0, roof_js_1.roofArea)(p) * r.flowLpmM2 * onTotalSec / 60, pumpKwh: r.pumpPowerKw * onTotalSec / 3600, onTotalSec });
    }
    const waterLPerDay = systems.reduce((a, w) => a + w.waterL, 0), pumpKwhPerDay = systems.reduce((a, w) => a + w.pumpKwh, 0);
    return { fanKwhPerDay, pumpKwhPerDay, waterLPerDay, totalKwhPerDay: fanKwhPerDay + pumpKwhPerDay, systems };
}
function trialResources(s, p) {
    const clone = structuredClone(s);
    clone.fans.forEach(f => f.hoursPerDay = Math.min(1, f.hoursPerDay));
    clone.waterSystems.forEach(w => w.hoursPerDay = Math.min(1, w.hoursPerDay));
    clone.roof.hoursPerDay = Math.min(1, clone.roof.hoursPerDay);
    const r = resources(clone, p);
    return { trialWaterL: r.waterLPerDay, trialKwh: r.totalKwhPerDay };
}
function stableStringify(v) {
    if (v === null || typeof v !== 'object')
        return JSON.stringify(v);
    if (Array.isArray(v))
        return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
const deviceInput = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !['label', 'anchor'].includes(k)));
const scenarioInput = (s) => ({ roof: s.roof, fans: s.fans.map(deviceInput), waterSystems: s.waterSystems.map(w => ({ ...w, nozzles: w.nozzles.map(deviceInput) })) });
exports.scenarioInput = scenarioInput;
function inputHash(p) {
    const input = stableStringify({ schema: p.schemaVersion, template: p.template, environment: p.environment, dailyWeather: p.dailyWeather, model: p.model, references: p.references, milkSimulation: p.milkSimulation, baselineScenarioId: p.baselineScenarioId, scenarios: p.scenarios.map(s => ({ id: s.id, ...(0, exports.scenarioInput)(s) })) });
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < input.length; i++) {
        h ^= BigInt(input.charCodeAt(i));
        h = BigInt.asUintN(64, h * 0x100000001b3n);
    }
    return h.toString(16).padStart(16, '0');
}
function mistDistribution(p, s, layout, rays) {
    const water = new Map(), mist = s.waterSystems.find(w => w.kind === 'mist');
    if (mist.enabled)
        for (const n of mist.nozzles) {
            if (!n.enabled || n.flowLpm <= 0)
                continue;
            const origin = (0, geometry_js_1.world)(n);
            for (const ray of (0, geometry_js_1.sprayDirections)(n, rays)) {
                const pt = (0, geometry_js_1.rayAtHeight)(origin, ray, 1.5);
                if (!pt || pt[0] < 0 || pt[2] < 0 || pt[0] >= p.template.lengthM || pt[2] >= p.template.widthM || (0, geometry_js_1.blocked)(origin, pt, layout.solids))
                    continue;
                const id = `cell-${Math.floor(pt[0] / 2)}-${Math.floor(pt[2] / 2)}`;
                water.set(id, (water.get(id) ?? 0) + n.flowLpm / 60 / rays);
            }
        }
    return water;
}
/** Geometry and film physics are v0.4 reuse; this orchestrator connects v0.5/6/7. */
function runScenario(p, s, layout, profile, dt, rays, hash, roof, collectQSeries = false) {
    const e = p.environment, m = p.model, soaker = s.waterSystems.find(w => w.kind === 'soaker'), mist = s.waterSystems.find(w => w.kind === 'mist');
    const invalidDevices = [...s.fans.filter(f => f.enabled && f.hoursPerDay > 0), ...s.waterSystems.filter(w => w.enabled && w.hoursPerDay > 0 && w.onSec > 0).flatMap(w => w.nozzles.filter(n => n.enabled && n.flowLpm > 0))].filter(d => layout.solids.some(box => (0, geometry_js_1.insideBox)((0, geometry_js_1.world)(d), box)));
    const warnings = [];
    if (soaker.enabled)
        warnings.push('牛体散水の水蒸気は、牛舎全体の湿度へ戻さない仮定です。');
    if (invalidDevices.length)
        warnings.push('稼働設備が管理室内にあります。移動するまで地点の計算は無効です。');
    if (soaker.enabled && soaker.nozzles.some(n => n.enabled && n.y < 4))
        warnings.push('飼料帯への散水配置があります。');
    const mistWater = mistDistribution(p, s, layout, rays), pv = e.relativeHumidityPct / 100 * (0, physics_js_1.saturationPressure)(e.temperatureC);
    const n = roof.states.length;
    // Share air states across points in the same cell. Exact numeric keys; no model rounding.
    const airCache = new Map();
    const points = layout.probes.map((q) => {
        const cellId = `cell-${Math.min(Math.floor(q.x / 2), Math.ceil(p.template.lengthM / 2) - 1)}-${Math.min(Math.floor(q.y / 2), Math.ceil(p.template.widthM / 2) - 1)}`;
        const blank = { probeId: q.id, inputHash: hash, modelVersion: m.version, meanSpeedMps: null, meanAirTemperatureC: null, meanRelativeHumidityPct: null, meanQrefW: null, deltaQrefW: null, components: null, parameterEnvelopeW: null, profileDeltas: {}, status: 'invalid', warnings: [], cellId, captureFraction: 0, film: null, meanRadiantC: null, meanFeelsLikeC: null, milk: { status: 'out_of_scope', ratioPct: null, kgPerDay: null, reasons: ['地点の計算が無効です'] }, fertility: (0, references_js_1.fertilityReference)(p.references.fertility, null, null), series: [], meanDeficitW: null, meanFilmKg: null, fanActionFraction: null, soakerArrivalFraction: null, mistEvaporationActionFraction: null, mistSupplyFraction: null };
        if (invalidDevices.length) {
            blank.warnings.push('管理室内の設備を移動してください');
            return blank;
        }
        let capturedFlow = 0, maxFraction = 0;
        if (soaker.enabled)
            for (const nozzle of soaker.nozzles) {
                if (!nozzle.enabled || nozzle.flowLpm <= 0)
                    continue;
                const f = (0, geometry_js_1.captureFraction)(nozzle, q, m, layout.solids, rays);
                capturedFlow += nozzle.flowLpm / 60 * f;
                maxFraction = Math.max(maxFraction, f);
            }
        const cell = layout.cells.find(c => c.id === cellId);
        const windCache = new Map(), termsCache = new Map();
        const comp = { convectionW: 0, radiationW: 0, baseEvaporationW: 0, soakerEvaporationW: 0, condensationW: 0 };
        const filmLedger = { capturedKg: 0, condensedKg: 0, evaporatedKg: 0, runoffKg: 0, finalKg: 0, maxResidualKg: 0 };
        let mass = 0, speedSum = 0, tempSum = 0, rhSum = 0, feelSum = 0;
        const qref = p.milkSimulation.referenceCoolingWPerCow;
        // Area visualization v0.1: per-second aggregates. These are integrated in the same
        // loop as the physics — never reconstructed from the stored 60-second series.
        let deficitWs = 0, filmMassWs = 0, fanActionS = 0, soakerArrivalS = 0, mistSupplyS = 0, mistEvapS = 0;
        const qSeries = collectQSeries ? new Float64Array(n) : undefined;
        let firstT = 0, firstRH = 0, firstSpeed = 0, staticInputs = true;
        const series = [];
        for (let i = 0; i < n; i++) {
            const t = i * dt, st = roof.states[i], soakerOn = soaker.enabled && (0, physics_js_1.isOn)(t, soaker.onSec, soaker.offSec, soaker.hoursPerDay), mistOn = mist.enabled && (0, physics_js_1.isOn)(t, mist.onSec, mist.offSec, mist.hoursPerDay);
            const windKey = s.fans.map(f => +(f.enabled && t < f.hoursPerDay * 3600)).join('');
            let wind = windCache.get(windKey);
            if (!wind) {
                wind = (0, geometry_js_1.windAt)(s.fans, (0, geometry_js_1.world)(q), e, m, profile, layout.solids, t);
                windCache.set(windKey, wind);
            }
            if (wind.interference && !blank.warnings.length)
                blank.warnings.push('対向噴流の干渉は未解析です');
            const flow = mistOn ? (mistWater.get(cellId) ?? 0) : 0, airKey = `${cellId}:${st.airC}:${flow}`;
            let air = airCache.get(airKey);
            if (!air) {
                const rh = 100 * pv / (0, physics_js_1.saturationPressure)(st.airC);
                air = (0, physics_js_1.mistAir)(st.airC, rh, e.pressurePa, cell.areaM2 * e.ventilationM3sPerM2, flow, profile.mistEfficiency);
                airCache.set(airKey, air);
            }
            const ta = air.temperatureC, rh = air.rhPct, speed = wind.speed;
            const termsKey = `${ta}:${rh}:${speed}:${st.radiantC}`;
            let terms = termsCache.get(termsKey);
            if (!terms) {
                terms = (0, physics_js_1.heatTerms)(ta, rh, speed, st.radiantC, m, profile);
                termsCache.set(termsKey, terms);
            }
            const film = (0, physics_js_1.filmStep)(mass, soakerOn ? capturedFlow : 0, terms, m, profile, dt);
            mass = film.mass;
            filmLedger.capturedKg += film.capturedKg;
            filmLedger.condensedKg += film.condensedKg;
            filmLedger.evaporatedKg += film.evaporatedKg;
            filmLedger.runoffKg += film.runoffKg;
            filmLedger.maxResidualKg = Math.max(filmLedger.maxResidualKg, Math.abs(film.residualKg));
            comp.convectionW += terms.components.convectionW * dt;
            comp.radiationW += terms.components.radiationW * dt;
            comp.baseEvaporationW += terms.components.baseEvaporationW * dt;
            comp.condensationW += terms.components.condensationW * dt;
            comp.soakerEvaporationW += film.evaporatedKg * m.latentHeatJkg;
            speedSum += speed * dt;
            tempSum += ta * dt;
            rhSum += rh * dt;
            feelSum += (ta - 6 * Math.sqrt(speed)) * dt;
            const qW = terms.components.convectionW + terms.components.radiationW + terms.components.baseEvaporationW + terms.components.condensationW + film.heatW;
            // AV05/§4: clamp per second BEFORE any spatial or time averaging.
            deficitWs += Math.max(0, qref - qW) * dt;
            filmMassWs += mass * dt;
            if (wind.speed - e.backgroundSpeedMps > 1e-6)
                fanActionS += dt;
            if (soakerOn && capturedFlow > 1e-12)
                soakerArrivalS += dt;
            if (flow > 0)
                mistSupplyS += dt;
            if (air.evaporatedKgs > 1e-12)
                mistEvapS += dt;
            if (qSeries)
                qSeries[i] = qW;
            if (i === 0) {
                firstT = ta;
                firstRH = rh;
                firstSpeed = speed;
            }
            else if (Math.abs(ta - firstT) > 1e-9 || Math.abs(rh - firstRH) > 1e-9 || Math.abs(speed - firstSpeed) > 1e-9)
                staticInputs = false;
            if (profile.id === 'reference' && (i === 0 || (i + 1) * dt % 60 === 0))
                series.push({ timeSec: (i + 1) * dt, temperatureC: ta, relativeHumidityPct: rh, speedMps: speed, filmKg: mass, qW, deltaW: null, soakerOn, mistOn });
        }
        for (const key of Object.keys(comp))
            comp[key] /= 3600;
        filmLedger.finalKg = mass;
        return { ...blank, status: 'valid', meanSpeedMps: speedSum / 3600, meanAirTemperatureC: tempSum / 3600, meanRelativeHumidityPct: rhSum / 3600, meanQrefW: Object.values(comp).reduce((a, b) => a + b, 0), meanRadiantC: roof.result.meanRadiantC, meanFeelsLikeC: feelSum / 3600, components: comp, film: filmLedger, captureFraction: maxFraction, series, milk: (0, references_js_1.milkReference)(firstT, firstRH, firstSpeed, p.references.baselineMilkKgPerDay, staticInputs), fertility: (0, references_js_1.fertilityReference)(p.references.fertility, tempSum / 3600, rhSum / 3600), meanDeficitW: deficitWs / (n * dt), meanFilmKg: filmMassWs / (n * dt), fanActionFraction: fanActionS / (n * dt), soakerArrivalFraction: soakerArrivalS / (n * dt), mistEvaporationActionFraction: mistEvapS / (n * dt), mistSupplyFraction: mistSupplyS / (n * dt), qSeries };
    });
    return { id: s.id, points, resources: resources(s, p), warnings, roof: roof.result, ...trialResources(s, p), dailyMilk: null, dailyThermal: null };
}
function simulate(p, opts = {}) {
    const dt = opts.dt ?? 1, rays = opts.rays ?? 256;
    if (dt !== 1 && dt !== .5)
        throw Error('時間刻みは1秒または0.5秒です');
    if (![256, 1024].includes(rays))
        throw Error('積分レイ数は256または1024です');
    const hash = inputHash(p), layout = (0, layout_js_1.buildLayout)(p.template), profiles = opts.envelope === false ? p.model.profiles.filter(x => x.id === 'reference') : [...p.model.profiles].sort((a, b) => a.id === 'reference' ? -1 : b.id === 'reference' ? 1 : 0);
    const roofCache = new Map(), cache = new Map(), all = new Map();
    for (const profile of profiles) {
        const results = p.scenarios.map(s => {
            const key = profile.id + stableStringify((0, exports.scenarioInput)(s));
            let result = cache.get(key);
            if (!result) {
                const rk = stableStringify(s.roof);
                let roof = roofCache.get(rk);
                if (!roof) {
                    roof = (0, roof_js_1.roofTimeline)(p, s, dt);
                    roofCache.set(rk, roof);
                }
                result = runScenario(p, s, layout, profile, dt, rays, hash, roof, opts.collectQSeries === true);
                cache.set(key, result);
            }
            return { ...result, id: s.id, points: result.points.map(q => ({ ...q, profileDeltas: {}, series: q.series.map(st => ({ ...st })) })) };
        });
        const base = results.find(s => s.id === p.baselineScenarioId);
        for (const s of results)
            for (let i = 0; i < s.points.length; i++) {
                const q = s.points[i], b = base.points[i];
                q.deltaQrefW = q.meanQrefW !== null && b.meanQrefW !== null ? q.meanQrefW - b.meanQrefW : null;
                q.series.forEach((st, j) => st.deltaW = b.series[j] ? st.qW - b.series[j].qW : null);
            }
        all.set(profile.id, results);
    }
    const reference = all.get('reference');
    for (const s of reference)
        for (let i = 0; i < s.points.length; i++) {
            const q = s.points[i], deltas = {};
            for (const profile of profiles) {
                const d = all.get(profile.id).find(x => x.id === s.id).points[i].deltaQrefW;
                if (d !== null)
                    deltas[profile.id] = d;
            }
            q.profileDeltas = deltas;
            const vals = Object.values(deltas);
            if (vals.length === 3)
                q.parameterEnvelopeW = [Math.min(...vals), Math.max(...vals)];
            if (q.parameterEnvelopeW && q.parameterEnvelopeW[0] < 0 && q.parameterEnvelopeW[1] > 0)
                q.warnings.push('仮定を変えると増減が逆転');
        }
    return { inputHash: hash, modelVersion: p.model.version, scenarios: reference, profiles: profiles.map(x => x.id), timeStepSec: dt, rayCount: rays, durationSec: 3600, dailyMilkStatus: 'pending' };
}

},
"template/layout.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLayout = buildLayout;
exports.anchorPose = anchorPose;
exports.positionFromAnchor = positionFromAnchor;
function buildLayout(t) {
    const L = t.lengthM, W = t.widthM, a = (W - 18.5) / 2;
    const zones = [
        { id: 'feed', name: '飼料・給餌車両', x: 0, y: 0, widthM: L, depthM: 4, kind: 'feed' },
        { id: 'feeding', name: '採食帯', x: 2.5, y: 4, widthM: L - 11, depthM: 4, kind: 'feeding' },
    ];
    const rows = [['A', 8, 13], ['B', 10.5 + a, 12], ['C', 13 + a, 13], ['D', 15.5 + 2 * a, 12]];
    const stalls = [], probes = [];
    for (const [row, y, n] of rows) {
        zones.push({ id: `stall-${row}`, name: `牛床 ${row}`, x: 2.5, y, widthM: L - 11, depthM: 2.5, kind: 'stall' });
        const left = Math.ceil(n / 2), start = 2.5 + ((L - 11) - (n * 1.2 + 2.5)) / 2;
        for (let i = 0; i < n; i++) {
            const x = start + i * 1.2 + (i >= left ? 2.5 : 0), id = `stall-${row}-${String(i + 1).padStart(2, '0')}`;
            stalls.push({ id, x, y, widthM: 1.2, depthM: 2.5, row });
            probes.push({ id, label: `牛床 ${row}${i + 1}`, x: x + .6, y: y + 1.25, heightM: .5, zoneId: `stall-${row}`, patchYawDeg: 90, kind: 'stall' });
        }
    }
    zones.push({ id: 'aisle-1', name: '牛通路 1', x: 0, y: 10.5, widthM: L - 6, depthM: a, kind: 'aisle' }, { id: 'aisle-2', name: '牛通路 2', x: 0, y: 15.5 + a, widthM: L - 6, depthM: a, kind: 'aisle' }, { id: 'robot', name: '搾乳ロボット', x: L - 6, y: 8, widthM: 3, depthM: 3, kind: 'robot' }, { id: 'utility', name: '機器・管理室', x: L - 3, y: 8, widthM: 3, depthM: 3, kind: 'utility', solid: true }, { id: 'waiting', name: 'ロボット前', x: L - 6, y: 11, widthM: 6, depthM: W - 15, kind: 'waiting' }, { id: 'isolation-1', name: '隔離', x: L - 6, y: W - 4, widthM: 3, depthM: 4, kind: 'isolation' }, { id: 'isolation-2', name: '管理', x: L - 3, y: W - 4, widthM: 3, depthM: 4, kind: 'isolation' });
    for (let i = 0; i < 12; i++)
        probes.push({ id: `feed-${String(i + 1).padStart(2, '0')}`, label: `採食 ${i + 1}`, x: 2.5 + (i + .5) * (L - 11) / 12, y: 5.75, heightM: 1.3, zoneId: 'feeding', patchYawDeg: 90, kind: 'feeding' });
    for (let j = 0; j < 4; j++)
        for (let i = 0; i < 2; i++)
            probes.push({ id: `wait-${j * 2 + i + 1}`, label: `ロボット前 ${j * 2 + i + 1}`, x: L - 6 + (i + .5) * 3, y: 11 + (j + .5) * (W - 15) / 4, heightM: 1.3, zoneId: 'waiting', patchYawDeg: 90, kind: 'waiting' });
    const cells = [];
    for (let iy = 0; iy < Math.ceil(W / 2); iy++)
        for (let ix = 0; ix < Math.ceil(L / 2); ix++) {
            const x = ix * 2, y = iy * 2, w = Math.min(2, L - x), d = Math.min(2, W - y);
            cells.push({ id: `cell-${ix}-${iy}`, ix, iy, x, y, widthM: w, depthM: d, areaM2: w * d });
        }
    return { zones, stalls, probes, cells, solids: zones.filter(z => z.solid).map(z => ({ min: [z.x, 0, z.y], max: [z.x + z.widthM, 4, z.y + z.depthM] })) };
}
function anchorPose(p, t, layout = buildLayout(t)) {
    const zone = layout.zones.find(z => p.x >= z.x && p.x <= z.x + z.widthM && p.y >= z.y && p.y <= z.y + z.depthM);
    return zone ? { zoneId: zone.id, u: (p.x - zone.x) / zone.widthM, v: (p.y - zone.y) / zone.depthM } : { zoneId: 'barn', u: p.x / t.lengthM, v: p.y / t.widthM };
}
function positionFromAnchor(p, t, layout) {
    const z = layout.zones.find(z => z.id === p.anchor.zoneId);
    return z ? { x: z.x + p.anchor.u * z.widthM, y: z.y + p.anchor.v * z.depthM } : { x: p.anchor.u * t.lengthM, y: p.anchor.v * t.widthM };
}

},
"model/geometry.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blocked = exports.insideBox = exports.world = exports.normalize = exports.length = exports.cross = exports.subtract = exports.dot = void 0;
exports.direction = direction;
exports.segmentHitsBox = segmentHitsBox;
exports.fanContribution = fanContribution;
exports.windAt = windAt;
exports.sprayDirections = sprayDirections;
exports.rayAtHeight = rayAtHeight;
exports.captureFraction = captureFraction;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
exports.dot = dot;
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
exports.subtract = subtract;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
exports.cross = cross;
const length = (v) => Math.hypot(...v);
exports.length = length;
const normalize = (v) => { const n = (0, exports.length)(v); return n ? v.map(x => x / n) : [0, 0, 0]; };
exports.normalize = normalize;
const world = (p) => [p.x, p.heightM, p.y];
exports.world = world;
/** Adapted from the uploaded v0.3 domain/geometry.ts; yaw/pitch convention retained. */
function direction(yaw, pitch) { const a = yaw * Math.PI / 180, p = pitch * Math.PI / 180; return [Math.cos(p) * Math.cos(a), -Math.sin(p), Math.cos(p) * Math.sin(a)]; }
const insideBox = (p, b) => p.every((x, i) => x >= b.min[i] && x <= b.max[i]);
exports.insideBox = insideBox;
function segmentHitsBox(a, b, box) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 3; i++) {
        const d = b[i] - a[i];
        if (Math.abs(d) < 1e-12) {
            if (a[i] < box.min[i] || a[i] > box.max[i])
                return false;
            continue;
        }
        const t1 = (box.min[i] - a[i]) / d, t2 = (box.max[i] - a[i]) / d;
        lo = Math.max(lo, Math.min(t1, t2));
        hi = Math.min(hi, Math.max(t1, t2));
        if (lo > hi)
            return false;
    }
    return hi >= 0 && lo <= 1;
}
const blocked = (a, b, solids) => solids.some(box => segmentHitsBox(a, b, box));
exports.blocked = blocked;
function fanContribution(f, p, m, profile, solids = []) {
    if (!f.enabled)
        return 0;
    const delta = (0, exports.subtract)(p, (0, exports.world)(f)), d = direction(f.yawDeg, f.pitchDownDeg), s = (0, exports.dot)(delta, d);
    if (s < 0 || (0, exports.blocked)((0, exports.world)(f), p, solids))
        return 0;
    const r2 = Math.max(0, (0, exports.dot)(delta, delta) - s * s), b = f.diameterM / 2 + m.kSpread * s;
    return f.outletSpeedMps * profile.outletMultiplier / (1 + s / (m.kDecay * f.diameterM)) * Math.exp(-.5 * r2 / (b * b));
}
function windAt(fans, p, e, m, profile, solids = [], seconds = 0) {
    const contributions = fans.map(f => ({ f, u: seconds < f.hoursPerDay * 3600 ? fanContribution(f, p, m, profile, solids) : 0 })).sort((a, b) => b.u - a.u);
    const u = contributions[0]?.u ?? 0, other = contributions[1];
    const interference = !!other && other.u > 0 && u > 0 && other.u / u > .7 && (0, exports.dot)(direction(contributions[0].f.yawDeg, contributions[0].f.pitchDownDeg), direction(other.f.yawDeg, other.f.pitchDownDeg)) < -.7;
    return { speed: Math.sqrt(e.backgroundSpeedMps ** 2 + u ** 2), interference, dominant: contributions[0]?.f.id };
}
const rayCache = new Map();
/** Deterministic equal-area disk samples. Ray count is unrelated to rendering quality. */
function sprayDirections(n, count = 256) {
    const key = `${n.yawDeg}:${n.pitchDownDeg}:${n.halfAngleDeg}:${count}`;
    const old = rayCache.get(key);
    if (old)
        return old;
    if (count < 1 || !Number.isInteger(count))
        throw Error('積分レイ数が不正です');
    const axis = direction(n.yawDeg, n.pitchDownDeg), u = (0, exports.normalize)((0, exports.cross)(axis, Math.abs(axis[1]) > .9 ? [1, 0, 0] : [0, 1, 0])), v = (0, exports.cross)(axis, u), scale = Math.tan(n.halfAngleDeg * Math.PI / 180);
    const rays = Array.from({ length: count }, (_, i) => { const r = Math.sqrt((i + .5) / count) * scale, angle = i * Math.PI * (3 - Math.sqrt(5)), c = Math.cos(angle) * r, s = Math.sin(angle) * r; return (0, exports.normalize)([axis[0] + c * u[0] + s * v[0], axis[1] + c * u[1] + s * v[1], axis[2] + c * u[2] + s * v[2]]); });
    if (rayCache.size > 256)
        rayCache.clear();
    rayCache.set(key, rays);
    return rays;
}
function rayAtHeight(origin, d, h) {
    if (d[1] >= -1e-12)
        return null;
    const t = (h - origin[1]) / d[1];
    return t < 0 ? null : [origin[0] + d[0] * t, h, origin[2] + d[2] * t];
}
function captureFraction(n, p, m, solids, count = 256) {
    if (!n.enabled)
        return 0;
    const o = (0, exports.world)(n), a = p.patchYawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    let hits = 0;
    for (const ray of sprayDirections(n, count)) {
        const q = rayAtHeight(o, ray, p.heightM);
        if (!q || (0, exports.blocked)(o, q, solids))
            continue;
        const dx = q[0] - p.x, dy = q[2] - p.y, l = dx * c + dy * s, w = -dx * s + dy * c;
        if (Math.abs(l) <= m.patchLengthM / 2 && Math.abs(w) <= m.patchWidthM / 2)
            hits++;
    }
    return hits / count;
}

},
"model/physics.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.relativeHumidity = exports.specificVolume = exports.enthalpy = exports.humidityRatio = exports.isOn = void 0;
exports.thi = thi;
exports.onTotalSeconds = onTotalSeconds;
exports.saturationPressure = saturationPressure;
exports.mistAir = mistAir;
exports.convectiveHeat = convectiveHeat;
exports.heatTerms = heatTerms;
exports.filmStep = filmStep;
function thi(t, rh) { return .8 * t + (rh / 100) * (t - 14.4) + 46.4; }
function onTotalSeconds(hours, on, off) {
    if (![hours, on, off].every(Number.isFinite) || hours < 0 || on < 0 || off < 0 || on + off <= 0)
        throw Error('ON/OFF周期が不正です（両方0は不可）');
    const h = hours * 3600, p = on + off;
    return Math.floor(h / p) * on + Math.min(h % p, on);
}
const isOn = (seconds, on, off, hours) => seconds < hours * 3600 && on > 0 && on + off > 0 && (seconds % (on + off)) < on;
exports.isOn = isOn;
/** ASHRAE SI eq. 5/6, as documented by PsychroLib. Temperatures -100..200 C. */
function saturationPressure(t) {
    if (!Number.isFinite(t) || t < -100 || t > 200)
        throw Error('飽和蒸気圧の温度範囲外');
    const T = t + 273.15;
    const ln = t <= .01 ? -5674.5359 / T + 6.3925247 - .009677843 * T + .00000062215701 * T * T + 2.0747825e-9 * T ** 3 - 9.484024e-13 * T ** 4 + 4.1635019 * Math.log(T) : -5800.2206 / T + 1.3914993 - .048640239 * T + .000041764768 * T * T - .000000014452093 * T ** 3 + 6.5459673 * Math.log(T);
    return Math.exp(ln);
}
const humidityRatio = (t, rh, pressure) => { const pv = rh / 100 * saturationPressure(t); return .621945 * pv / (pressure - pv); };
exports.humidityRatio = humidityRatio;
const enthalpy = (t, w) => 1000 * (1.006 * t + w * (2501 + 1.86 * t));
exports.enthalpy = enthalpy;
const specificVolume = (t, w, p) => 287.042 * (t + 273.15) * (1 + 1.607858 * w) / p;
exports.specificVolume = specificVolume;
const relativeHumidity = (t, w, p) => 100 * (p * w / (.621945 + w)) / saturationPressure(t);
exports.relativeHumidity = relativeHumidity;
function mistAir(t, rh, pressure, volume, waterKgs, eta) {
    const wi = (0, exports.humidityRatio)(t, rh, pressure), h = (0, exports.enthalpy)(t, wi), md = volume / (0, exports.specificVolume)(t, wi, pressure);
    if (md <= 0)
        throw Error('空気交換量が0以下です');
    if (waterKgs <= 0 || eta <= 0 || rh >= 100 - 1e-10)
        return { temperatureC: t, rhPct: rh, enthalpyJkg: h, evaporatedKgs: 0, unevaporatedKgs: waterKgs };
    let lo = -80, hi = t;
    for (let i = 0; i < 65; i++) {
        const x = (lo + hi) / 2;
        if ((0, exports.enthalpy)(x, (0, exports.humidityRatio)(x, 100, pressure)) > h)
            hi = x;
        else
            lo = x;
    }
    const ws = (0, exports.humidityRatio)((lo + hi) / 2, 100, pressure), dw = Math.min(eta * waterKgs / md, Math.max(0, ws - wi)), wo = wi + dw;
    const temperatureC = (h / 1000 - 2501 * wo) / (1.006 + 1.86 * wo), outRH = (0, exports.relativeHumidity)(temperatureC, wo, pressure);
    if (outRH > 100 + 1e-6 || outRH < 0)
        throw Error('ミスト計算が飽和制約を超えました');
    return { temperatureC, rhPct: Math.min(100, outRH), enthalpyJkg: (0, exports.enthalpy)(temperatureC, wo), evaporatedKgs: md * dw, unevaporatedKgs: waterKgs - md * dw };
}
function convectiveHeat(area, ts, ta, speed, mult = 1) { return area * (3.5 + 4 * Math.sqrt(speed)) * mult * (ts - ta); }
function heatTerms(ta, rh, speed, radiantC, m, p) {
    const hc = (m.hcIntercept + m.hcSlope * Math.sqrt(speed)) * p.hcMultiplier, km = hc / (m.airDensityKgM3 * m.airCpJkgK);
    const drho = (saturationPressure(m.surfaceTemperatureC) - rh / 100 * saturationPressure(ta)) / (m.vaporGasConstant * ((m.surfaceTemperatureC + ta) / 2 + 273.15));
    const condensationKgs = km * m.areaM2 * Math.max(-drho, 0), base = km * m.areaM2 * m.baseWetFraction * Math.max(drho, 0);
    const components = { convectionW: m.areaM2 * hc * (m.surfaceTemperatureC - ta), radiationW: m.emissivity * 5.670374419e-8 * m.areaM2 * ((m.surfaceTemperatureC + 273.15) ** 4 - (radiantC + 273.15) ** 4), baseEvaporationW: m.latentHeatJkg * base, soakerEvaporationW: 0, condensationW: -m.latentHeatJkg * condensationKgs };
    return { components, km, drho, condensationKgs };
}
function filmStep(mass, capturedKgs, terms, m, p, dt) {
    const condensed = terms.condensationKgs * m.wetAreaM2 / m.areaM2, received = mass + (capturedKgs + condensed) * dt, runoff = Math.max(received - p.maxFilmKg, 0), pre = Math.min(received, p.maxFilmKg);
    const potential = terms.km * m.wetAreaM2 * (1 - m.baseWetFraction) * (pre / p.maxFilmKg) * Math.max(terms.drho, 0), evaporated = Math.min(potential * dt, pre), next = pre - evaporated;
    const residual = next - mass - (capturedKgs * dt + condensed * dt - evaporated - runoff);
    if (next < -1e-12 || next > p.maxFilmKg + 1e-12 || Math.abs(residual) > 1e-8)
        throw Error('体表水の収支が不整合です');
    return { mass: Math.max(0, next), capturedKg: capturedKgs * dt, condensedKg: condensed * dt, evaporatedKg: evaporated, runoffKg: runoff, residualKg: residual, heatW: evaporated / dt * m.latentHeatJkg };
}

},
"model/roof.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roofArea = void 0;
exports.solveRoof = solveRoof;
exports.roofTimeline = roofTimeline;
const physics_js_1 = require("./physics.js");
const roofArea = (p) => 2 * p.template.lengthM * Math.hypot(p.template.widthM / 2, p.template.ridgeHeightM - p.template.eaveHeightM);
exports.roofArea = roofArea;
/** Direct port of v0.5 roof_state. All numbers in SI; solve zero-storage roof/air balance. */
function solveRoof(p, s, waterKgM2, dt, env) {
    const e = env ?? p.environment, m = p.model, k = m.roof, r = k.bareResistance + s.roof.insulationM / k.conductivity;
    const ca = m.airDensityKgM3 * m.airCpJkgK * e.ventilationM3sPerM2 * p.template.lengthM * p.template.widthM, ah = (0, exports.roofArea)(p) * k.hInConv;
    const beta = ah / (ca + ah), b = k.backgroundSensibleW / (ca + ah), c = k.hInConv * (1 - beta) + k.hInRad;
    const pv = e.relativeHumidityPct / 100 * (0, physics_js_1.saturationPressure)(e.temperatureC), km = k.hOutConv / (m.airDensityKgM3 * m.airCpJkgK), wet = waterKgM2 / k.waterCapacityKgM2;
    function at(outerC) {
        const underC = e.temperatureC + (outerC - e.temperatureC + r * k.hInConv * b) / (1 + r * c), airC = e.temperatureC + b + beta * (underC - e.temperatureC);
        const drho = ((0, physics_js_1.saturationPressure)(outerC) - pv) / (m.vaporGasConstant * ((outerC + e.temperatureC) / 2 + 273.15));
        const evaporatedKgsM2 = Math.min(km * wet * Math.max(drho, 0), waterKgM2 / dt);
        const residualWm2 = (1 - s.roof.reflectance) * e.solarRoofWm2 - (k.hOutConv + k.hOutRad) * (outerC - e.temperatureC) - (outerC - underC) / r - m.latentHeatJkg * evaporatedKgsM2;
        const radiantC = (k.viewFactor * (underC + 273.15) ** 4 + (1 - k.viewFactor) * (e.temperatureC + 273.15) ** 4) ** .25 - 273.15;
        return { outerC, underC, airC, evaporatedKgsM2, residualWm2, radiantC };
    }
    let lo = 0, hi = 130, flo = at(lo).residualWm2, fhi = at(hi).residualWm2;
    if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0)
        throw Error('屋根の熱収支を解けません。入力範囲を確認してください');
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2, st = at(mid);
        if (Math.abs(st.residualWm2) < 1e-9 || hi - lo < 1e-9)
            return st;
        if (flo * st.residualWm2 <= 0)
            hi = mid;
        else {
            lo = mid;
            flo = st.residualWm2;
        }
    }
    return at((lo + hi) / 2);
}
function roofTimeline(p, s, dt = 1) {
    const cap = p.model.roof.waterCapacityKgM2, area = (0, exports.roofArea)(p), n = Math.round(3600 / dt), dry = solveRoof(p, s, 0, dt), states = [], series = [];
    let mass = 0, supplied = 0, evaporated = 0, runoff = 0, maxResidual = 0, outer = 0, under = 0, air = 0, radiant = 0;
    for (let i = 0; i < n; i++) {
        const t = i * dt, flow = s.roof.sprayEnabled && (0, physics_js_1.isOn)(t, s.roof.onSec, s.roof.offSec, s.roof.hoursPerDay) ? s.roof.flowLpmM2 / 60 : 0;
        const received = mass + flow * dt, spill = Math.max(0, received - cap), available = Math.min(cap, received), st = available > 0 ? solveRoof(p, s, available, dt) : dry;
        mass = Math.max(0, available - st.evaporatedKgsM2 * dt);
        supplied += flow * dt;
        evaporated += st.evaporatedKgsM2 * dt;
        runoff += spill;
        maxResidual = Math.max(maxResidual, Math.abs(st.residualWm2));
        outer += st.outerC * dt;
        under += st.underC * dt;
        air += st.airC * dt;
        radiant += st.radiantC * dt;
        states.push(st);
        if (i === 0 || (i + 1) * dt % 60 === 0)
            series.push({ timeSec: (i + 1) * dt, outerC: st.outerC, underC: st.underC, airC: st.airC, radiantC: st.radiantC, waterKgM2: mass, evaporatedKgsM2: st.evaporatedKgsM2 });
    }
    return { states, result: { meanOuterC: outer / 3600, meanUnderC: under / 3600, meanAirC: air / 3600, meanRadiantC: radiant / 3600, areaM2: area, suppliedL: supplied * area, evaporatedKg: evaporated * area, runoffL: runoff * area, finalWaterKg: mass * area, waterResidualKg: (supplied - evaporated - runoff - mass) * area, energyResidualMaxWm2: maxResidual, series } };
}

},
"model/references.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fertilityTHI = exports.FERTILITY_CATEGORIES = exports.FERTILITY_OR = exports.MILK_ROWS = void 0;
exports.milkReference = milkReference;
exports.categoryOfTHI = categoryOfTHI;
exports.fertilityByPeriods = fertilityByPeriods;
exports.fertilityReference = fertilityReference;
/** Literal COWBELL No.178 table: NEVER interpolate, round or extrapolate. */
exports.MILK_ROWS = [
    { temperatureC: 27, speedMps: .18, ratioPct: 85 }, { temperatureC: 27, speedMps: 2.24, ratioPct: 95 },
    { temperatureC: 27, speedMps: 4.02, ratioPct: 95 }, { temperatureC: 35, speedMps: .18, ratioPct: 63 },
    { temperatureC: 35, speedMps: 2.24, ratioPct: 79 }, { temperatureC: 35, speedMps: 4.02, ratioPct: 79 },
];
function milkReference(t, rh, v, baseline, staticInputs = true) {
    if (![t, rh, v].every(Number.isFinite) || rh < 0 || rh > 100 || v < 0 || baseline !== null && (!Number.isFinite(baseline) || baseline < 0))
        return { status: 'invalid_input', ratioPct: null, kgPerDay: null, reasons: ['入力を確認してください'] };
    const reasons = [];
    if (!staticInputs)
        reasons.push('時間変動する条件は対象外');
    if (![27, 35].some(x => Math.abs(x - t) <= 1e-9))
        reasons.push('気温は27℃・35℃のみ');
    if (![.18, 2.24, 4.02].some(x => Math.abs(x - v) <= 1e-9))
        reasons.push('風速は0.18・2.24・4.02m/sのみ');
    if (rh < 60 || rh > 70)
        reasons.push('湿度は60〜70%のみ');
    const row = exports.MILK_ROWS.find(x => Math.abs(x.temperatureC - t) <= 1e-9 && Math.abs(x.speedMps - v) <= 1e-9);
    if (reasons.length || !row)
        return { status: 'out_of_scope', ratioPct: null, kgPerDay: null, reasons };
    return { status: 'available', ratioPct: row.ratioPct, kgPerDay: baseline === null ? null : baseline * row.ratioPct / 100, reasons: [] };
}
/** Baccouri et al. 2025, Table 2. Preserve all reported coefficients, not just significant ones. */
exports.FERTILITY_OR = [
    [1, .823, .697, .773], [1, .973, .913, 1.005], [1, .926, .887, .693],
    [1, .941, .935, .922], [1, 1.058, .941, .854],
];
exports.FERTILITY_CATEGORIES = ['基準区分', '軽度区分', '中等度区分', '高暑熱区分'];
const fertilityTHI = (t, rh) => (1.8 * t + 32) - (.55 - .55 * rh / 100) * (1.8 * t - 26);
exports.fertilityTHI = fertilityTHI;
function categoryOfTHI(thi) { return thi < 60 ? 0 : thi < 68 ? 1 : thi < 72 ? 2 : 3; }
function fertilityByPeriods(ths, p0) {
    if (ths.length !== 5 || !ths.every(Number.isFinite) || !Number.isFinite(p0) || p0 <= 0 || p0 >= 1)
        throw Error('受胎シナリオの入力が不正です');
    const oddsRatio = ths.reduce((r, thi, i) => r * exports.FERTILITY_OR[i][categoryOfTHI(thi)], 1);
    return { oddsRatio, probability: p0 * oddsRatio / (1 - p0 + p0 * oddsRatio) };
}
function fertilityReference(settings, localT, localRH) {
    const blank = { probability: null, oddsRatio: null, thi: null, category: null, source: settings.mode, exposureAssumed: settings.exposureAssumed };
    if (!settings.exposureAssumed)
        return { ...blank, status: 'out_of_scope', reasons: ['授精前後52日間の代表条件の仮定が未採用です'] };
    const t = settings.mode === 'manual' ? settings.temperatureC : localT, rh = settings.mode === 'manual' ? settings.relativeHumidityPct : localRH;
    if (t === null || rh === null)
        return { ...blank, status: 'out_of_scope', reasons: ['地点の計算が無効です'] };
    if (![t, rh, settings.p0].every(Number.isFinite) || rh < 0 || rh > 100 || settings.p0 <= 0 || settings.p0 >= 1)
        return { ...blank, status: 'invalid_input', reasons: ['受胎シナリオの入力が不正です'] };
    const thi = (0, exports.fertilityTHI)(t, rh), cat = categoryOfTHI(thi), calculation = fertilityByPeriods([thi, thi, thi, thi, thi], settings.p0);
    return { ...blank, ...calculation, thi, category: exports.FERTILITY_CATEGORIES[cat], status: 'available_reference', reasons: [] };
}

},
"model/dailySimulation.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyResources = dailyResources;
exports.simulateDaily = simulateDaily;
exports.mergeDaily = mergeDaily;
const layout_js_1 = require("../template/layout.js");
const faces_js_1 = require("../template/faces.js");
const geometry_js_1 = require("./geometry.js");
const physics_js_1 = require("./physics.js");
const roof_js_1 = require("./roof.js");
const simulation_js_1 = require("./simulation.js");
const dailySchedule_js_1 = require("./dailySchedule.js");
const dailyWeather_js_1 = require("./dailyWeather.js");
const milk_js_1 = require("./milk.js");
const blankDaily = (ms, status, reasons) => ({
    status, reasons, modelId: ms.modelId, mode: ms.mode, weatherMode: ms.weatherMode, operationPolicy: ms.operationPolicy,
    warmupDurationSec: ms.warmupDurationSec, evaluationDurationSec: ms.evaluationDurationSec, timeStepSec: ms.timeStepSec,
    potentialMilkKgPerCowDay: ms.potentialMilkKgPerCowDay, referenceCoolingWPerCow: ms.referenceCoolingWPerCow,
    responseKgPerCowDayPerW: ms.responseKgPerCowDayPerW, maxLossFraction: ms.maxLossFraction,
    lagWeights: [...ms.lagWeights], occupancyFractions: { ...ms.occupancyFractions }, zoneCounts: { stall: 0, feeding: 0, waiting: 0 },
    dailyDeficitWPerCow: null, laggedDeficitWPerCow: null, lossKgPerCowDay: null, yieldKgPerCowDay: null, deltaKgPerCowDay: null,
    lossCapped: false, sensitivities: ms.responseSensitivityKgPerCowDayPerW.map(beta => ({ beta, yieldKgPerCowDay: null, deltaKgPerCowDay: null, lossCapped: false })),
    resources: null, waterCheck: null
});
/** Daily resources integrated from the same operation masks the thermal loop uses. */
function dailyResources(p, s) {
    const evalStart = dailySchedule_js_1.DAY_SEC;
    const systems = s.waterSystems.map(w => {
        const flow = w.nozzles.reduce((a, n) => a + (n.enabled ? n.flowLpm : 0), 0);
        let waterL = 0, pumpKwh = 0, onTotalSec = 0;
        for (let t = evalStart; t < evalStart + dailySchedule_js_1.DAY_SEC; t++)
            if ((0, dailySchedule_js_1.waterOn)(t, w) && flow > 0) {
                waterL += flow / 60;
                pumpKwh += w.pumpPowerKw / 3600;
                onTotalSec++;
            }
        return { kind: w.kind, waterL, pumpKwh, onTotalSec };
    });
    const r = s.roof;
    let roofWaterL = 0, roofPumpKwh = 0, roofOnSec = 0;
    for (let t = evalStart; t < evalStart + dailySchedule_js_1.DAY_SEC; t++)
        if ((0, dailySchedule_js_1.roofSprayOn)(t, r) && r.flowLpmM2 > 0) {
            roofWaterL += (0, roof_js_1.roofArea)(p) * r.flowLpmM2 / 60;
            roofPumpKwh += r.pumpPowerKw / 3600;
            roofOnSec++;
        }
    systems.push({ kind: 'roof', waterL: roofWaterL, pumpKwh: roofPumpKwh, onTotalSec: roofOnSec });
    let fanKwhPerDay = 0;
    for (let t = evalStart; t < evalStart + dailySchedule_js_1.DAY_SEC; t++)
        for (const f of s.fans)
            if ((0, dailySchedule_js_1.fanOn)(t, f))
                fanKwhPerDay += f.powerKw / 3600;
    const waterLPerDay = systems.reduce((a, w) => a + w.waterL, 0), pumpKwhPerDay = systems.reduce((a, w) => a + w.pumpKwh, 0);
    return { waterLPerDay, fanKwhPerDay, pumpKwhPerDay, totalKwhPerDay: fanKwhPerDay + pumpKwhPerDay, systems };
}
/**
 * Representative-day thermal state evolution for the milk hypothesis model.
 * t in [0, warmup+eval): constant environment repeated; state (roof water, film mass,
 * cycle phase) carries across the day boundary. Only the reference profile is used.
 * Seconds where masks and roof state cannot change are processed as one stretch.
 */
function dailyAreaStats(points, area) {
    const members = area.probeIds.map(id => points.find(q => q.probeId === id)).filter((q) => !!q);
    const allValid = members.length === area.probeIds.length && members.length > 0;
    return { id: area.id, label: area.label, probeCount: area.probeIds.length, validCount: members.length,
        meanDeficitW: allValid ? members.reduce((a, q) => a + q.meanDeficitW, 0) / members.length : null,
        maxDeficitW: members.length ? Math.max(...members.map(q => q.meanDeficitW)) : null,
        topDeficit: [...members].sort((a, b) => b.meanDeficitW - a.meanDeficitW || a.probeId.localeCompare(b.probeId)).filter(q => q.meanDeficitW > 1e-6).slice(0, 3).map(q => ({ probeId: q.probeId, value: q.meanDeficitW })) };
}
function blankThermal(p, ms, status, reasons, resources) {
    return { status, reasons, evaluationDurationSec: ms.evaluationDurationSec, weatherMode: p.dailyWeather.mode, modelVersion: p.model.version, points: [], areas: [], all: null, resources };
}
function runDaily(p, s, layout, profile, rays, zw, ms, opts) {
    const e = p.environment, m = p.model, soaker = s.waterSystems.find(w => w.kind === 'soaker'), mist = s.waterSystems.find(w => w.kind === 'mist');
    const invalidDevices = [...s.fans.filter(f => f.enabled && f.hoursPerDay > 0), ...s.waterSystems.filter(w => w.enabled && w.hoursPerDay > 0 && w.onSec > 0).flatMap(w => w.nozzles.filter(n => n.enabled && n.flowLpm > 0))].filter(d => layout.solids.some(box => (0, geometry_js_1.insideBox)((0, geometry_js_1.world)(d), box)));
    const reasons = [];
    if (invalidDevices.length)
        reasons.push('稼働設備が管理室内にあります。移動するまで日乳量は計算できません。');
    const weights = 'error' in zw ? null : zw.weights;
    if ('error' in zw)
        reasons.push(zw.error);
    const resources = dailyResources(p, s);
    const counts = 'error' in zw ? { stall: 0, feeding: 0, waiting: 0 } : zw.counts;
    if (reasons.length)
        return { ...blankDaily(ms, 'invalid_input', reasons), resources, zoneCounts: counts, thermal: blankThermal(p, ms, 'invalid_input', reasons, resources) };
    const warmup = opts.warmupSec ?? ms.warmupDurationSec, evalLen = opts.evalSec ?? ms.evaluationDurationSec, total = warmup + evalLen;
    const mistWater = (0, simulation_js_1.mistDistribution)(p, s, layout, rays);
    const cap = m.roof.waterCapacityKgM2, area = (0, roof_js_1.roofArea)(p);
    // Hourly weather refreshes env/pv/dryRoof at each clock-hour boundary.
    const hourly = p.dailyWeather.mode === 'hourly';
    let wIdx = -2, env = e, pv = e.relativeHumidityPct / 100 * (0, physics_js_1.saturationPressure)(e.temperatureC), dryRoof = (0, roof_js_1.solveRoof)(p, s, 0, 1);
    // Static per-probe capture rate (kg/s while the soaker system is ON).
    const probes = layout.probes.map(q => {
        let capturedKgs = 0;
        for (const n of soaker.nozzles)
            if (n.enabled && n.flowLpm > 0)
                capturedKgs += n.flowLpm / 60 * (0, geometry_js_1.captureFraction)(n, q, m, layout.solids, rays);
        const cellId = `cell-${Math.min(Math.floor(q.x / 2), Math.ceil(p.template.lengthM / 2) - 1)}-${Math.min(Math.floor(q.y / 2), Math.ceil(p.template.widthM / 2) - 1)}`;
        const cell = layout.cells.find(c => c.id === cellId);
        return { probe: q, weight: weights.get(q.id), cellId, cellAreaM2: cell.areaM2, capturedKgs, mass: 0, memoSeq: -1, baseQ: 0, condensing: false, lastTerms: null, lastWind: null, lastAir: null, windMemo: new Map(), evalFilmStartKg: 0, capturedKg: 0, condensedKg: 0, evaporatedKg: 0, runoffKg: 0, sumQWs: 0, qSeries: opts.collectQSeries ? new Float64Array(evalLen) : null, defWs: 0, spdWs: 0, tmpWs: 0, rhWs: 0, convWs: 0, radWs: 0, evapWs: 0, condWs: 0, soakEvapWs: 0, fanS: 0, soakS: 0, mistSupS: 0, mistEvapS: 0 };
    });
    let roofMass = 0, prevAvail = -1, roofState = dryRoof, prevRoofState = null;
    if (opts.initialState) {
        roofMass = opts.initialState.roofMassKgM2;
        opts.initialState.filmKg.forEach((m, i) => {
            if (probes[i])
                probes[i].mass = m;
        });
    }
    // The evaluation day starts at t=warmup; when warmup is skipped its start state is the injected one.
    let roofEvalStartKg = warmup === 0 ? roofMass * area : 0, roofSuppliedKg = 0, roofEvaporatedKg = 0, roofRunoffKg = 0;
    if (warmup === 0)
        for (const pr of probes)
            pr.evalFilmStartKg = pr.mass;
    let warmupState = warmup === 0 ? { roofMassKgM2: roofMass, filmKg: probes.map(pr => pr.mass) } : undefined;
    let deficitSum = 0, seq = 0, prevMaskKey = '';
    let t = 0;
    while (t < total) {
        const evalMode = t >= warmup;
        // Hourly weather boundary: refresh environment, vapor pressure and the dry-roof
        // solve; cached roof/heat-term results from the previous hour are invalid.
        const wi = (0, dailyWeather_js_1.weatherIndexAt)(p, t);
        if (wi !== wIdx) {
            wIdx = wi;
            env = (0, dailyWeather_js_1.envAt)(p, t);
            pv = env.relativeHumidityPct / 100 * (0, physics_js_1.saturationPressure)(env.temperatureC);
            dryRoof = (0, roof_js_1.solveRoof)(p, s, 0, 1, env);
            prevAvail = -1;
        }
        // Masks at t
        const fanMask = s.fans.map(f => (0, dailySchedule_js_1.fanOn)(t, f)), fanKey = fanMask.map(b => b ? 1 : 0).join('');
        const soakerOn = (0, dailySchedule_js_1.waterOn)(t, soaker), mistOn = (0, dailySchedule_js_1.waterOn)(t, mist), roofFlow = (0, dailySchedule_js_1.roofSprayOn)(t, s.roof) && s.roof.flowLpmM2 > 0 ? s.roof.flowLpmM2 / 60 : 0;
        const maskKey = fanKey + '|' + (soakerOn ? 1 : 0) + (mistOn ? 1 : 0) + '|' + wi;
        // Roof water and state for this second
        let spill = 0;
        if (roofMass > 0 || roofFlow > 0) {
            const received = roofMass + roofFlow;
            spill = Math.max(0, received - cap);
            const avail = Math.min(cap, received);
            roofState = avail === prevAvail ? roofState : (0, roof_js_1.solveRoof)(p, s, avail, 1, env);
            prevAvail = avail;
            roofMass = Math.max(0, avail - roofState.evaporatedKgsM2);
            if (evalMode) {
                roofSuppliedKg += roofFlow * area;
                roofEvaporatedKg += roofState.evaporatedKgsM2 * area;
                roofRunoffKg += spill * area;
            }
        }
        else {
            roofState = dryRoof;
            prevAvail = 0;
        }
        // Stretch length: masks constant until the next toggle; roof evolves only while wet/supplied.
        let dur = total - t;
        for (const f of s.fans)
            if (f.enabled && f.hoursPerDay > 0)
                dur = Math.min(dur, (0, dailySchedule_js_1.secondsToNextToggle)(t, { ...f, onSec: 0, offSec: 0 }, false));
        for (const w of s.waterSystems)
            if (w.enabled && w.hoursPerDay > 0)
                dur = Math.min(dur, (0, dailySchedule_js_1.secondsToNextToggle)(t, w, true));
        if (s.roof.sprayEnabled && s.roof.hoursPerDay > 0)
            dur = Math.min(dur, (0, dailySchedule_js_1.secondsToNextToggle)(t, { ...s.roof, enabled: s.roof.sprayEnabled }, true));
        if (hourly)
            dur = Math.min(dur, (0, dailyWeather_js_1.secondsToWeatherBoundary)(t));
        if (roofMass > 0 || roofFlow > 0)
            dur = 1;
        if (t < warmup && t + dur > warmup)
            dur = warmup - t;
        if (maskKey !== prevMaskKey || roofState !== prevRoofState) {
            seq++;
            prevMaskKey = maskKey;
            prevRoofState = roofState;
        }
        const st = roofState;
        const maskedFans = s.fans.map((f, i) => ({ ...f, enabled: fanMask[i] }));
        // Air per cell only when mist supplies water this stretch; otherwise air follows the roof state.
        const mistAirMemo = new Map();
        const airAt = (cellId) => {
            const flow = mistOn ? (mistWater.get(cellId) ?? 0) : 0;
            const rh = 100 * pv / (0, physics_js_1.saturationPressure)(st.airC);
            if (flow <= 0)
                return { temperatureC: st.airC, rhPct: rh, evaporatedKgs: 0 };
            let a = mistAirMemo.get(cellId);
            if (!a) {
                const cell = layout.cells.find(c => c.id === cellId);
                const res = (0, physics_js_1.mistAir)(st.airC, rh, env.pressurePa, cell.areaM2 * env.ventilationM3sPerM2, flow, profile.mistEfficiency);
                a = { temperatureC: res.temperatureC, rhPct: res.rhPct, evaporatedKgs: res.evaporatedKgs };
                mistAirMemo.set(cellId, a);
            }
            return a;
        };
        const evalOverlap = Math.max(0, Math.min(t + dur, total) - Math.max(t, warmup));
        for (const pr of probes) {
            const captured = soakerOn ? pr.capturedKgs : 0;
            if (pr.memoSeq !== seq) {
                let wind = pr.windMemo.get(fanKey);
                if (!wind) {
                    wind = (0, geometry_js_1.windAt)(maskedFans, (0, geometry_js_1.world)(pr.probe), env, m, profile, layout.solids, 0);
                    pr.windMemo.set(fanKey, wind);
                }
                const air = airAt(pr.cellId);
                const terms = (0, physics_js_1.heatTerms)(air.temperatureC, air.rhPct, wind.speed, st.radiantC, m, profile);
                pr.memoSeq = seq;
                pr.baseQ = terms.components.convectionW + terms.components.radiationW + terms.components.baseEvaporationW + terms.components.condensationW;
                pr.condensing = terms.condensationKgs > 0;
                pr.lastTerms = terms;
                pr.lastWind = wind;
                pr.lastAir = air;
            }
            const wind = pr.lastWind, air = pr.lastAir, terms = pr.lastTerms;
            if (evalOverlap > 0) {
                // Evaluation-day means for the daily-thermal contract (same definitions as
                // the 60-minute aggregates; integrated once per constant stretch).
                pr.spdWs += wind.speed * evalOverlap;
                pr.tmpWs += air.temperatureC * evalOverlap;
                pr.rhWs += air.rhPct * evalOverlap;
                pr.convWs += terms.components.convectionW * evalOverlap;
                pr.radWs += terms.components.radiationW * evalOverlap;
                pr.evapWs += terms.components.baseEvaporationW * evalOverlap;
                pr.condWs += terms.components.condensationW * evalOverlap;
                if (wind.speed - env.backgroundSpeedMps > 1e-6)
                    pr.fanS += evalOverlap;
                if (captured > 1e-12)
                    pr.soakS += evalOverlap;
                if (mistOn && (mistWater.get(pr.cellId) ?? 0) > 0)
                    pr.mistSupS += evalOverlap;
                if (air.evaporatedKgs > 1e-12)
                    pr.mistEvapS += evalOverlap;
            }
            if (evalMode && evalOverlap > 0 && pr.mass === 0 && captured === 0 && !pr.condensing) {
                deficitSum += pr.weight * (0, milk_js_1.deficitW)(pr.baseQ, ms.referenceCoolingWPerCow) * evalOverlap;
                pr.defWs += (0, milk_js_1.deficitW)(pr.baseQ, ms.referenceCoolingWPerCow) * evalOverlap;
                pr.sumQWs += pr.baseQ * evalOverlap;
                if (pr.qSeries)
                    pr.qSeries.fill(pr.baseQ, Math.max(t, warmup) - warmup, Math.min(t + dur, total) - warmup);
            }
            if (pr.mass > 0 || captured > 0 || pr.condensing) {
                // film evolves each second within this constant stretch
                const from = Math.max(t, warmup), to = t + dur;
                for (let tt = t; tt < to; tt++) {
                    const f = (0, physics_js_1.filmStep)(pr.mass, captured, pr.lastTerms, m, profile, 1);
                    pr.mass = f.mass;
                    if (tt >= from) {
                        pr.capturedKg += f.capturedKg;
                        pr.condensedKg += f.condensedKg;
                        pr.evaporatedKg += f.evaporatedKg;
                        pr.runoffKg += f.runoffKg;
                        const dW = (0, milk_js_1.deficitW)(pr.baseQ + f.heatW, ms.referenceCoolingWPerCow);
                        deficitSum += pr.weight * dW;
                        pr.defWs += dW;
                        pr.soakEvapWs += f.evaporatedKg * m.latentHeatJkg;
                        pr.sumQWs += (pr.baseQ + f.heatW);
                        if (pr.qSeries)
                            pr.qSeries[tt - warmup] = pr.baseQ + f.heatW;
                    }
                }
            }
        }
        if (t < warmup && t + dur >= warmup) {
            roofEvalStartKg = roofMass * area;
            for (const pr of probes)
                pr.evalFilmStartKg = pr.mass;
            warmupState = { roofMassKgM2: roofMass, filmKg: probes.map(pr => pr.mass) };
        }
        t += dur;
    }
    // Water balance check over the evaluation day: start + inflow - evaporated - runoff - end.
    const roofResidualKg = roofEvalStartKg + roofSuppliedKg - roofEvaporatedKg - roofRunoffKg - roofMass * area;
    const filmResidualKg = probes.reduce((a, pr) => a + pr.evalFilmStartKg + pr.capturedKg + pr.condensedKg - pr.evaporatedKg - pr.runoffKg - pr.mass, 0);
    const filmStartKg = probes.reduce((a, pr) => a + pr.evalFilmStartKg, 0);
    const dailyDeficitWPerCow = deficitSum / evalLen;
    const thermalPoints = probes.map(pr => ({ probeId: pr.probe.id,
        meanDeficitW: pr.defWs / evalLen, meanQrefW: pr.sumQWs / evalLen,
        meanSpeedMps: pr.spdWs / evalLen, meanAirTemperatureC: pr.tmpWs / evalLen, meanRelativeHumidityPct: pr.rhWs / evalLen,
        components: { convectionW: pr.convWs / evalLen, radiationW: pr.radWs / evalLen, baseEvaporationW: pr.evapWs / evalLen, soakerEvaporationW: pr.soakEvapWs / evalLen, condensationW: pr.condWs / evalLen },
        fanActionFraction: pr.fanS / evalLen, soakerArrivalFraction: pr.soakS / evalLen, mistEvaporationActionFraction: pr.mistEvapS / evalLen, mistSupplyFraction: pr.mistSupS / evalLen }));
    const thermal = { status: 'complete', reasons: [], evaluationDurationSec: evalLen, weatherMode: p.dailyWeather.mode, modelVersion: m.version, points: thermalPoints,
        areas: (0, faces_js_1.buildAreas)(layout).map(a => dailyAreaStats(thermalPoints, a)),
        all: dailyAreaStats(thermalPoints, { id: 'all', label: '全地点', probeIds: layout.probes.map(q => q.id) }), resources };
    const calc = (0, milk_js_1.dailyFromDeficit)(dailyDeficitWPerCow, ms);
    const out = {
        ...blankDaily(ms, 'available', []), zoneCounts: counts, resources,
        dailyDeficitWPerCow, laggedDeficitWPerCow: calc.laggedDeficitWPerCow,
        lossKgPerCowDay: calc.lossKgPerCowDay, yieldKgPerCowDay: calc.yieldKgPerCowDay, lossCapped: calc.lossCapped,
        sensitivities: (0, milk_js_1.sensitivityYields)(dailyDeficitWPerCow, ms).map(r => ({ beta: r.beta, yieldKgPerCowDay: r.yieldKgPerCowDay, deltaKgPerCowDay: null, lossCapped: r.lossCapped })),
        waterCheck: { roofStartKg: roofEvalStartKg, filmStartKg, roofResidualKg, filmResidualKg }
    };
    const result = { ...out, thermal };
    if (opts.collectQ)
        result.probeQ = new Map(probes.map(pr => [pr.probe.id, pr.sumQWs / evalLen]));
    if (opts.collectQSeries)
        result.probeQSeries = new Map(probes.map(pr => [pr.probe.id, pr.qSeries]));
    if (opts.returnState)
        result.stateAtWarmupEnd = warmupState;
    return result;
}
function simulateDaily(p, opts = {}) {
    const ms = p.milkSimulation, layout = (0, layout_js_1.buildLayout)(p.template), profile = p.model.profiles.find(x => x.id === 'reference');
    const settingReasons = (0, milk_js_1.validateMilkSettings)(ms);
    const zw = settingReasons.length ? { error: settingReasons[0] } : (0, milk_js_1.occupancyWeights)(layout.probes, ms.occupancyFractions);
    const daily = {}, thermal = {}, probeQ = {}, probeQSeries = {}, states = {};
    const cache = new Map();
    let status = 'complete', error;
    for (const s of p.scenarios) {
        // Weather is project-level, so it must be part of the scenario cache key.
        const key = (0, simulation_js_1.stableStringify)({ w: p.dailyWeather, ...(0, simulation_js_1.scenarioInput)(s) }), cached = cache.get(key);
        if (cached) {
            daily[s.id] = structuredClone(cached.result);
            if (cached.thermal)
                thermal[s.id] = cached.thermal;
            if (cached.probeQ)
                probeQ[s.id] = cached.probeQ;
            if (cached.probeQSeries)
                probeQSeries[s.id] = cached.probeQSeries;
            if (cached.state)
                states[s.id] = cached.state;
            continue;
        }
        try {
            const r = settingReasons.length ? { ...blankDaily(ms, 'invalid_input', settingReasons), resources: dailyResources(p, s), thermal: blankThermal(p, ms, 'invalid_input', settingReasons, dailyResources(p, s)) } : runDaily(p, s, layout, profile, opts.rays ?? 256, zw, ms, opts);
            const { probeQ: pq, probeQSeries: pqs, stateAtWarmupEnd: st, thermal: th, ...clean } = r;
            daily[s.id] = clean;
            if (th)
                thermal[s.id] = th;
            cache.set(key, { result: clean, thermal: th, probeQ: pq, probeQSeries: pqs, state: st });
            if (pq)
                probeQ[s.id] = pq;
            if (pqs)
                probeQSeries[s.id] = pqs;
            if (st)
                states[s.id] = st;
        }
        catch (err) {
            status = 'error';
            error = err instanceof Error ? err.message : String(err);
            daily[s.id] = { ...blankDaily(ms, 'calculation_error', ['日乳量の計算に失敗しました']), resources: dailyResources(p, s) };
            thermal[s.id] = blankThermal(p, ms, 'calculation_error', ['日熱集計に失敗しました'], dailyResources(p, s));
        }
    }
    const base = daily[p.baselineScenarioId];
    for (const s of p.scenarios) {
        const r = daily[s.id];
        if (r.status === 'available' && base?.status === 'available')
            r.deltaKgPerCowDay = (0, milk_js_1.deltaYield)({ yieldKgPerCowDay: r.yieldKgPerCowDay }, { yieldKgPerCowDay: base.yieldKgPerCowDay });
        for (const sen of r.sensitivities) {
            const bb = base?.sensitivities.find(x => x.beta === sen.beta);
            sen.deltaKgPerCowDay = sen.yieldKgPerCowDay != null && bb?.yieldKgPerCowDay != null ? sen.yieldKgPerCowDay - bb.yieldKgPerCowDay : null;
        }
    }
    return { status, error, daily, thermal, probeQ, probeQSeries, states };
}
/** Merge a daily-stage reply into the matching 60-minute result. Only called when
 * the gate already accepted the message (same jobId+inputHash). */
function mergeDaily(result, daily, thermal, status) {
    for (const s of result.scenarios) {
        s.dailyMilk = daily[s.id] ?? null;
        s.dailyThermal = thermal[s.id] ?? null;
    }
    result.dailyMilkStatus = status;
}

},
"template/faces.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.areaOfProbe = exports.FACE_SURFACE_Y = void 0;
exports.buildFaces = buildFaces;
exports.buildAreas = buildAreas;
/** Rendered elevation of each face in 3D. Stall faces sit just above the .15 m stall
 * base block; feeding/waiting faces just above the floor. Clicks must intersect the
 * face at this height — projecting onto y=0 selects a neighbouring face in oblique views. */
exports.FACE_SURFACE_Y = { stall: .158, other: .052 };
function buildFaces(l) {
    const faces = [];
    for (const st of l.stalls) {
        const q = l.probes.find(q => q.id === st.id);
        faces.push({ id: `face-${st.id}`, probeId: st.id, label: q?.label ?? st.id, kind: 'stall', x: st.x, y: st.y, widthM: st.widthM, depthM: st.depthM, surfaceY: exports.FACE_SURFACE_Y.stall });
    }
    const feedZone = l.zones.find(z => z.kind === 'feeding'), feed = l.probes.filter(q => q.kind === 'feeding');
    for (let i = 0; i < feed.length; i++)
        faces.push({ id: `face-${feed[i].id}`, probeId: feed[i].id, label: feed[i].label, kind: 'feeding', x: feedZone.x + i * feedZone.widthM / feed.length, y: feedZone.y, widthM: feedZone.widthM / feed.length, depthM: feedZone.depthM, surfaceY: exports.FACE_SURFACE_Y.other });
    const waitZone = l.zones.find(z => z.kind === 'waiting'), wait = l.probes.filter(q => q.kind === 'waiting');
    for (let k = 0; k < wait.length; k++)
        faces.push({ id: `face-${wait[k].id}`, probeId: wait[k].id, label: wait[k].label, kind: 'waiting', x: waitZone.x + (k % 2) * waitZone.widthM / 2, y: waitZone.y + Math.floor(k / 2) * waitZone.depthM / 4, widthM: waitZone.widthM / 2, depthM: waitZone.depthM / 4, surfaceY: exports.FACE_SURFACE_Y.other });
    return faces;
}
/** Display areas: stall rows A-D, feeding, waiting, plus the all-stall subtotal. */
function buildAreas(l) {
    const out = [];
    for (const row of ['A', 'B', 'C', 'D'])
        out.push({ id: `stall-${row}`, label: `牛床 ${row}`, probeIds: l.probes.filter(q => q.zoneId === `stall-${row}`).map(q => q.id) });
    out.push({ id: 'feeding', label: '採食帯', probeIds: l.probes.filter(q => q.kind === 'feeding').map(q => q.id) });
    out.push({ id: 'waiting', label: '待機場所', probeIds: l.probes.filter(q => q.kind === 'waiting').map(q => q.id) });
    out.push({ id: 'stalls', label: '牛床全体（小計）', subtotal: true, probeIds: l.probes.filter(q => q.kind === 'stall').map(q => q.id) });
    return out;
}
/** Which display area a probe belongs to (used for area-row highlighting). */
const areaOfProbe = (l, probeId) => buildAreas(l).find(a => a.probeIds.includes(probeId)) ?? null;
exports.areaOfProbe = areaOfProbe;

},
"model/dailySchedule.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validDailyStartHour = exports.roofSprayOn = exports.fanOn = exports.windowOn = exports.dailyElapsed = exports.positiveModulo = exports.DAY_SEC = void 0;
exports.waterOn = waterOn;
exports.secondsToNextToggle = secondsToNextToggle;
exports.DAY_SEC = 86400;
const positiveModulo = (a, b) => ((a % b) + b) % b;
exports.positiveModulo = positiveModulo;
/** Operation window policy `daily-window-reset-v1`: each day the window starts at dailyStartHour
 * (local representative-day clock, no calendar/DST), and a water system's on/off cycle restarts
 * in the ON phase at that time. Operation crossing midnight keeps going — nothing resets at 0:00. */
const dailyElapsed = (t, dailyStartHour) => (0, exports.positiveModulo)(t - dailyStartHour * 3600, exports.DAY_SEC);
exports.dailyElapsed = dailyElapsed;
const windowOn = (t, dailyStartHour, hoursPerDay, enabled) => enabled && hoursPerDay > 0 && (0, exports.dailyElapsed)(t, dailyStartHour) < hoursPerDay * 3600;
exports.windowOn = windowOn;
function waterOn(t, w) {
    return (0, exports.windowOn)(t, w.dailyStartHour, w.hoursPerDay, w.enabled) && w.onSec > 0 && (0, exports.dailyElapsed)(t, w.dailyStartHour) % (w.onSec + w.offSec) < w.onSec;
}
const fanOn = (t, f) => (0, exports.windowOn)(t, f.dailyStartHour, f.hoursPerDay, f.enabled);
exports.fanOn = fanOn;
const roofSprayOn = (t, r) => waterOn(t, { ...r, enabled: r.sprayEnabled });
exports.roofSprayOn = roofSprayOn;
/** Valid start-of-day input: [0,24) in 0.25 h steps. */
const validDailyStartHour = (h) => typeof h === 'number' && Number.isFinite(h) && h >= 0 && h < 24 && Math.abs(h * 4 - Math.round(h * 4)) < 1e-9;
exports.validDailyStartHour = validDailyStartHour;
/** Seconds until the next change of a windowed on/off mask. Window edges are the
 * daily start (elapsed 0) and the window end (elapsed = hoursPerDay*3600); water adds
 * cycle edges within the window. Used to skip stretches where inputs cannot change. */
function secondsToNextToggle(t, w, cyclic) {
    const elapsed = (0, exports.dailyElapsed)(t, w.dailyStartHour);
    const windowLen = w.hoursPerDay * 3600;
    let next;
    if (elapsed < windowLen)
        next = t + (windowLen - elapsed); // inside the window -> window end
    else
        next = t + (exports.DAY_SEC - elapsed); // outside -> next daily start
    if (cyclic && w.onSec > 0 && elapsed < windowLen) {
        const period = w.onSec + w.offSec, phase = elapsed % period;
        next = Math.min(next, t + (phase < w.onSec ? w.onSec : period) - phase);
    }
    return next - t;
}

},
"model/dailyWeather.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.secondsToWeatherBoundary = exports.WEATHER_STEP_SEC = void 0;
exports.weatherIndexAt = weatherIndexAt;
exports.envAt = envAt;
exports.dailyWeatherReasons = dailyWeatherReasons;
exports.weatherModeOf = weatherModeOf;
const dailySchedule_js_1 = require("./dailySchedule.js");
exports.WEATHER_STEP_SEC = 3600;
/** Weather changes once per clock hour when mode==='hourly'; -1 under constant. */
function weatherIndexAt(p, t) {
    if (p.dailyWeather.mode !== 'hourly')
        return -1;
    return Math.floor((t % dailySchedule_js_1.DAY_SEC) / exports.WEATHER_STEP_SEC);
}
/** Environment for the representative-day second `t`. Shared fields (pressure,
 * background wind, ventilation) come from `environment` for every hour. */
function envAt(p, t) {
    const dw = p.dailyWeather;
    if (dw.mode !== 'hourly')
        return p.environment;
    const row = dw.hours.find(r => r.hour === weatherIndexAt(p, t));
    return { ...p.environment, temperatureC: row.temperatureC, relativeHumidityPct: row.relativeHumidityPct, solarRoofWm2: row.solarRoofWm2 };
}
/** Seconds until the next hourly boundary; only meaningful when hourly mode is on. */
const secondsToWeatherBoundary = (t) => exports.WEATHER_STEP_SEC - (t % exports.WEATHER_STEP_SEC);
exports.secondsToWeatherBoundary = secondsToWeatherBoundary;
/** Validation reasons for a candidate dailyWeather object. Empty = usable. */
function dailyWeatherReasons(dw) {
    const r = [];
    if (dw === null || typeof dw !== 'object' || Array.isArray(dw))
        return ['日気象はオブジェクトが必要です'];
    const w = dw;
    if (w.mode !== 'constant' && w.mode !== 'hourly')
        r.push('日気象のモードはconstantまたはhourlyです');
    if (w.hours !== undefined && !Array.isArray(w.hours))
        r.push('日気象のhoursは配列が必要です');
    const rows = (w.hours ?? []);
    const seen = new Set();
    let prev = -1;
    for (const row of rows) {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) {
            r.push('日気象の行はオブジェクトが必要です');
            continue;
        }
        const h = row.hour;
        if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23 || seen.has(h) || h <= prev) {
            r.push('日気象のhourは0〜23の一意・昇順が必要です');
            continue;
        }
        seen.add(h);
        prev = h;
        const f = (k, lo, hi, label) => {
            const v = row[k];
            if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi)
                r.push(`日気象${h}時の${label}は${lo}〜${hi}の有限数が必要です`);
        };
        f('temperatureC', 20, 40, '気温');
        f('relativeHumidityPct', 0, 100, '湿度');
        f('solarRoofWm2', 0, 1200, '屋根面日射');
    }
    if (w.mode === 'hourly' && (seen.size !== 24 || !seen.has(0) || !seen.has(23)))
        r.push('hourlyモードは0〜23時の24行が必要です');
    return r;
}
/** Keep the legacy milk weatherMode consistent with the single weather source. */
function weatherModeOf(dw) {
    return dw.mode === 'hourly' ? 'hourly-representative-day' : 'constant-environment';
}

},
"model/milk.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deltaYield = exports.laggedDeficit = exports.deficitW = exports.DEFAULT_MILK_SIMULATION = exports.MILK_MODEL_ID = void 0;
exports.occupancyWeights = occupancyWeights;
exports.milkFromDeficit = milkFromDeficit;
exports.dailyFromDeficit = dailyFromDeficit;
exports.sensitivityYields = sensitivityYields;
exports.validateMilkSettings = validateMilkSettings;
exports.MILK_MODEL_ID = 'milk-heat-deficit-v0.1';
/** Spec v0.1 demo assumptions. These are hypothesis placeholders, not fitted values. */
exports.DEFAULT_MILK_SIMULATION = {
    modelId: exports.MILK_MODEL_ID,
    mode: 'repeated-day',
    weatherMode: 'constant-environment',
    operationPolicy: 'daily-window-reset-v1',
    potentialMilkKgPerCowDay: 40,
    referenceCoolingWPerCow: 630,
    responseKgPerCowDayPerW: 0.010,
    maxLossFraction: 0.25,
    lagWeights: [0.2, 0.5, 0.3],
    occupancyFractions: { stall: 14 / 24, feeding: 6 / 24, waiting: 4 / 24 },
    responseSensitivityKgPerCowDayPerW: [0.005, 0.010, 0.015],
    warmupDurationSec: 86400, evaluationDurationSec: 86400, timeStepSec: 1,
    assumptionClass: 'demo_assumption'
};
/** Per-point heat deficit against the fixed reference cooling rate. Q>Qref counts as 0, never negative. */
const deficitW = (qW, referenceCoolingWPerCow) => Math.max(0, referenceCoolingWPerCow - qW);
exports.deficitW = deficitW;
const MILK_ZONES = ['stall', 'feeding', 'waiting'];
/**
 * Herd occupancy distribution over evaluation points. Each zone's fraction is split
 * evenly across its probes; a missing zone or unknown kind is an error — never renormalise.
 */
function occupancyWeights(probes, fractions) {
    if (!MILK_ZONES.every(k => Number.isFinite(fractions[k]) && fractions[k] >= 0))
        return { error: '区域の滞在割合が不正です' };
    const sum = MILK_ZONES.reduce((a, k) => a + fractions[k], 0);
    if (Math.abs(sum - 1) > 1e-9)
        return { error: '区域の滞在割合の合計が1ではありません' };
    const counts = { stall: 0, feeding: 0, waiting: 0 };
    for (const q of probes) {
        if (!MILK_ZONES.includes(q.kind))
            return { error: `評価地点 ${q.id} の区域対応がありません` };
        counts[q.kind]++;
    }
    for (const k of MILK_ZONES)
        if (counts[k] === 0 && fractions[k] > 0)
            return { error: '滞在割合に対応する評価地点がありません' };
    const weights = new Map();
    for (const q of probes)
        weights.set(q.id, fractions[q.kind] / counts[q.kind]);
    return { weights, counts };
}
/** Lagged deficit: E = w0*D[d] + w1*D[d-1] + w2*D[d-2]. Weights are ordered today-first. */
const laggedDeficit = (d0, d1, d2, w) => w[0] * d0 + w[1] * d1 + w[2] * d2;
exports.laggedDeficit = laggedDeficit;
/** Loss and yield from a lagged deficit. L = min(Y0*rmax, beta*E); Y = Y0 - L. */
function milkFromDeficit(laggedDeficitWPerCow, s) {
    const cap = s.potentialMilkKgPerCowDay * s.maxLossFraction, raw = s.responseKgPerCowDayPerW * laggedDeficitWPerCow;
    const lossKgPerCowDay = Math.min(cap, Math.max(0, raw));
    return { lossKgPerCowDay, yieldKgPerCowDay: s.potentialMilkKgPerCowDay - lossKgPerCowDay, lossCapped: raw >= cap };
}
/** Repeated-day mode: the evaluation-day deficit stands in for the past two days, so E = D. */
function dailyFromDeficit(dailyDeficitWPerCow, s) {
    const lagged = (0, exports.laggedDeficit)(dailyDeficitWPerCow, dailyDeficitWPerCow, dailyDeficitWPerCow, s.lagWeights);
    return { dailyDeficitWPerCow, laggedDeficitWPerCow: lagged, ...milkFromDeficit(lagged, s) };
}
/** Sensitivity over the fixed three beta assumptions; all scenarios share the same set. */
function sensitivityYields(dailyDeficitWPerCow, s) {
    return s.responseSensitivityKgPerCowDayPerW.map(beta => ({ beta, ...milkFromDeficit((0, exports.laggedDeficit)(dailyDeficitWPerCow, dailyDeficitWPerCow, dailyDeficitWPerCow, s.lagWeights), { ...s, responseKgPerCowDayPerW: beta }) }));
}
const deltaYield = (a, b) => a && b ? a.yieldKgPerCowDay - b.yieldKgPerCowDay : null;
exports.deltaYield = deltaYield;
/** Settings validation for the v0.1 contract. Returns reasons; empty means usable. Never repairs values. */
function validateMilkSettings(m) {
    const r = [];
    if (m.modelId !== exports.MILK_MODEL_ID)
        r.push('乳量モデルIDが未対応です');
    if (m.mode !== 'repeated-day')
        r.push('時間モードは代表日の繰り返しのみです');
    if (m.weatherMode !== 'constant-environment' && m.weatherMode !== 'hourly-representative-day')
        r.push('気象モードが未対応です');
    if (m.operationPolicy !== 'daily-window-reset-v1')
        r.push('運転ポリシーが未対応です');
    if (m.assumptionClass !== 'demo_assumption')
        r.push('仮定の分類が不正です');
    if (!Number.isFinite(m.potentialMilkKgPerCowDay) || m.potentialMilkKgPerCowDay <= 0)
        r.push('基準日乳量は正の有限値が必要です');
    if (!Number.isFinite(m.referenceCoolingWPerCow) || m.referenceCoolingWPerCow < 0)
        r.push('基準放熱量は非負の有限値が必要です');
    if (!Number.isFinite(m.responseKgPerCowDayPerW) || m.responseKgPerCowDayPerW < 0)
        r.push('換算係数は非負の有限値が必要です');
    if (!Number.isFinite(m.maxLossFraction) || m.maxLossFraction < 0 || m.maxLossFraction > 1)
        r.push('低下上限率は0〜1が必要です');
    const w = m.lagWeights;
    if (!Array.isArray(w) || w.length !== 3 || !w.every(x => Number.isFinite(x) && x >= 0))
        r.push('遅れの重みは非負の3要素が必要です');
    else if (Math.abs(w[0] + w[1] + w[2] - 1) > 1e-9)
        r.push('遅れの重みの合計が1ではありません');
    const o = m.occupancyFractions;
    if (!o || typeof o !== 'object' || !MILK_ZONES.every(k => Number.isFinite(o[k]) && o[k] >= 0))
        r.push('区域の滞在割合は非負の3区域が必要です');
    else if (Math.abs(o.stall + o.feeding + o.waiting - 1) > 1e-9)
        r.push('区域の滞在割合の合計が1ではありません');
    const b = m.responseSensitivityKgPerCowDayPerW;
    if (!Array.isArray(b) || b.length !== 3 || !b.every(x => Number.isFinite(x) && x >= 0))
        r.push('感度比較は非負の3条件が必要です');
    if (m.warmupDurationSec !== 86400 || m.evaluationDurationSec !== 86400)
        r.push('準備・評価は各86400秒のみです');
    if (m.timeStepSec !== 1)
        r.push('日計算の時間刻みは1秒のみです');
    return r;
}

},
"domain/validation.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProject = validateProject;
exports.parseProject = parseProject;
const layout_js_1 = require("../template/layout.js");
const defaults_js_1 = require("../data/defaults.js");
const milk_js_1 = require("../model/milk.js");
const dailySchedule_js_1 = require("../model/dailySchedule.js");
const dailyWeather_js_1 = require("../model/dailyWeather.js");
const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
const record = (v, path) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v))
        fail(path, 'オブジェクトが必要です');
    return v;
};
const number = (v, lo, hi, path) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi)
        fail(path, `${lo}〜${hi}の有限数が必要です`);
};
const bool = (v, path) => {
    if (typeof v !== 'boolean')
        fail(path, 'true/falseが必要です');
};
const text = (v, path, max = 160) => {
    if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))
        fail(path, '文字列が不正です');
};
const id = (v, path) => {
    if (typeof v !== 'string' || !/^[a-zA-Z0-9_.-]{1,90}$/.test(v))
        fail(path, 'IDが不正です');
};
function safeTree(v, depth = 0) {
    if (depth > 24)
        fail('JSON', '階層が深すぎます');
    if (v && typeof v === 'object') {
        if (Array.isArray(v) && v.length > 2000)
            fail('JSON', '配列が大きすぎます');
        for (const [k, x] of Object.entries(v)) {
            if (['__proto__', 'prototype', 'constructor'].includes(k))
                fail('JSON', '禁止されたキーです');
            safeTree(x, depth + 1);
        }
    }
}
function validateProject(input) {
    safeTree(input);
    const p = record(input, 'Project');
    // v9→v10 in-place migration: old files carried only the constant environment.
    if (p.schemaVersion === 9) {
        if (p.model && typeof p.model === 'object' && !Array.isArray(p.model))
            p.model.version = defaults_js_1.MODEL.version;
        if (p.milkSimulation && typeof p.milkSimulation === 'object' && !Array.isArray(p.milkSimulation))
            p.milkSimulation.weatherMode = 'constant-environment';
        p.dailyWeather = { mode: 'constant', hours: [] };
        p.schemaVersion = 10;
    }
    if (p.schemaVersion !== 10)
        fail('schemaVersion', 'この版では保存形式10のみ対応です（v9は自動変換）。旧形式・未知の形式は未対応のため読み込めません。現在の案は保持します');
    text(p.appVersion, 'appVersion', 80);
    const t = record(p.template, 'template');
    if (t.id !== 'fs-amr1-50-guided-reference' || t.version !== 1)
        fail('template', '対応していないテンプレートです');
    number(t.lengthM, 32, 48, '牛舎の長さ');
    number(t.widthM, 23.5, 30, '牛舎の幅');
    if (t.eaveHeightM !== 4 || t.ridgeHeightM !== 8.7)
        fail('屋根', '本版は軒4m・棟8.7m固定です');
    const e = record(p.environment, 'environment');
    number(e.temperatureC, 20, 40, '気温');
    number(e.relativeHumidityPct, 0, 100, '湿度');
    number(e.pressurePa, 50000, 110000, '気圧');
    number(e.backgroundSpeedMps, 0, 10, '背景風速');
    number(e.ventilationM3sPerM2, .0001, 1, '換気量');
    number(e.solarRoofWm2, 0, 1200, '屋根面日射');
    const dwObj = p.dailyWeather;
    if (dwObj && typeof dwObj === 'object' && !Array.isArray(dwObj) && dwObj.hours === undefined)
        dwObj.hours = [];
    const dwReasons = (0, dailyWeather_js_1.dailyWeatherReasons)(p.dailyWeather);
    if (dwReasons.length)
        fail('dailyWeather', dwReasons[0]);
    const m = record(p.model, 'model');
    if (m.version !== defaults_js_1.MODEL.version)
        fail('model', '未対応のモデル版です');
    for (const [key, value] of Object.entries(defaults_js_1.MODEL))
        if (typeof value === 'number')
            number(m[key], key === 'radiantOffsetC' ? -20 : 0, key === 'latentHeatJkg' ? 5e6 : key === 'vaporGasConstant' ? 1000 : key === 'airCpJkgK' ? 10000 : 100, `model.${key}`);
    if (m.areaM2 <= 0 || m.wetAreaM2 > m.areaM2 || m.baseWetFraction > 1 || m.emissivity > 1 || m.kDecay <= 0 || m.airDensityKgM3 <= 0 || m.airCpJkgK <= 0 || m.vaporGasConstant <= 0 || m.patchLengthM <= 0 || m.patchWidthM <= 0)
        fail('model', '面積・係数の関係が不正です');
    const rm = record(m.roof, 'model.roof');
    if (rm.version !== defaults_js_1.MODEL.roof.version)
        fail('roof.model', '未対応の屋根モデルです');
    for (const [k, value] of Object.entries(defaults_js_1.MODEL.roof))
        if (typeof value === 'number') {
            number(rm[k], 0, k === 'backgroundSensibleW' ? 1e6 : 100, `roof.${k}`);
            if (k !== 'backgroundSensibleW' && k !== 'viewFactor' && rm[k] <= 0)
                fail('roof', '係数は正数です');
        }
    if (rm.viewFactor > 1)
        fail('roof.viewFactor', '0〜1です');
    const refs = record(p.references, 'references');
    if (refs.milkModel !== 'milk-table-cowbell178-v1')
        fail('references', '未対応の乳量表');
    if (refs.baselineMilkKgPerDay !== null)
        number(refs.baselineMilkKgPerDay, 0, 100, '基準乳量');
    const f = record(refs.fertility, 'references.fertility');
    if (f.model !== 'fertility-thi-period-or-baccouri2025-v1' || f.profileVersion !== 1)
        fail('fertility', '未対応モデル');
    number(f.p0, .001, .999, '基準受胎率');
    if (!['manual', 'simulation'].includes(f.mode))
        fail('fertility.mode', '未対応入力');
    bool(f.exposureAssumed, 'fertility.exposureAssumed');
    number(f.temperatureC, -20, 50, '代表気温');
    number(f.relativeHumidityPct, 0, 100, '代表湿度');
    const ms = record(p.milkSimulation, 'milkSimulation');
    const milkReasons = (0, milk_js_1.validateMilkSettings)(ms);
    if (milkReasons.length)
        fail('milkSimulation', milkReasons[0]);
    if (ms.weatherMode !== (0, dailyWeather_js_1.weatherModeOf)(p.dailyWeather))
        fail('milkSimulation.weatherMode', '日気象モードと一致していません');
    if (!Array.isArray(m.profiles) || m.profiles.length !== 3)
        fail('model.profiles', '3プロファイルが必要です');
    const profileIds = new Set();
    for (const x of m.profiles) {
        record(x, 'profile');
        if (!['low', 'reference', 'high'].includes(x.id) || profileIds.has(x.id))
            fail('profile.id', '重複または未知のID');
        profileIds.add(x.id);
        text(x.name, 'profile.name');
        number(x.outletMultiplier, .01, 5, 'outletMultiplier');
        number(x.hcMultiplier, .01, 5, 'hcMultiplier');
        number(x.mistEfficiency, 0, 1, 'mistEfficiency');
        number(x.maxFilmKg, .001, 5, 'maxFilmKg');
    }
    if (!Array.isArray(p.scenarios) || p.scenarios.length !== 3)
        fail('scenarios', '基準と2編集案が必要です');
    const layout = (0, layout_js_1.buildLayout)(t), ids = new Set();
    for (const s of p.scenarios) {
        record(s, 'scenario');
        id(s.id, 'scenario.id');
        if (ids.has(s.id))
            fail('scenario.id', '重複しています');
        ids.add(s.id);
        text(s.name, 'scenario.name');
        bool(s.readOnly, 'readOnly');
        if (!Array.isArray(s.fans) || s.fans.length > 40)
            fail('fans', '最大40台です');
        if (!Array.isArray(s.waterSystems) || s.waterSystems.length !== 2)
            fail('waterSystems', 'ソーカーとミストの2系統が必要です');
        const roof = record(s.roof, 'scenario.roof');
        number(roof.reflectance, 0, 1, '屋根反射率');
        number(roof.insulationM, 0, .1, '断熱材厚さ');
        bool(roof.sprayEnabled, '屋根散水');
        number(roof.flowLpmM2, 0, 1, '屋根流量');
        number(roof.onSec, 0, 86400, '屋根ON');
        number(roof.offSec, 0, 86400, '屋根OFF');
        if (roof.onSec + roof.offSec <= 0)
            fail('屋根周期', '両方0は不可');
        number(roof.hoursPerDay, 0, 24, '屋根運転時間');
        number(roof.pumpPowerKw, 0, 20, '屋根ポンプ');
        if (!(0, dailySchedule_js_1.validDailyStartHour)(roof.dailyStartHour))
            fail('屋根運転開始', '0〜24未満・0.25時間刻みが必要です');
        const deviceIds = new Set(), systemIds = new Set(), kinds = new Set();
        let nozzleCount = 0;
        const pose = (d, isFan) => {
            record(d, 'device');
            id(d.id, 'device.id');
            if (deviceIds.has(d.id))
                fail('device.id', '案内でIDが重複しています');
            deviceIds.add(d.id);
            text(d.label, 'device.label');
            bool(d.enabled, 'device.enabled');
            number(d.x, 0, t.lengthM, `${d.label}.x`);
            number(d.y, 0, t.widthM, `${d.label}.y`);
            number(d.heightM, isFan ? d.diameterM / 2 : 1.8, 4, `${d.label}.高さ`);
            number(d.yawDeg, 0, 360, `${d.label}.向き`);
            number(d.pitchDownDeg, isFan ? 0 : 30, 90, `${d.label}.下向き角`);
            const a = record(d.anchor, 'anchor');
            if (a.zoneId !== 'barn' && !layout.zones.some(z => z.id === a.zoneId))
                fail('anchor.zoneId', '未知のゾーンです');
            number(a.u, 0, 1, 'anchor.u');
            number(a.v, 0, 1, 'anchor.v');
            const xy = (0, layout_js_1.positionFromAnchor)(d, t, layout);
            if (Math.abs(xy.x - d.x) > 1e-6 || Math.abs(xy.y - d.y) > 1e-6)
                fail('anchor', '座標とアンカーが一致していません');
        };
        for (const f of s.fans) {
            number(f.diameterM, .2, 3, 'ファン径');
            number(f.outletSpeedMps, 0, 30, '出口風速');
            number(f.powerKw, 0, 20, 'ファン電力');
            number(f.hoursPerDay, 0, 24, 'ファン運転時間');
            if (!(0, dailySchedule_js_1.validDailyStartHour)(f.dailyStartHour))
                fail(`${f.id}.dailyStartHour`, '運転開始は0〜24未満・0.25時間刻みが必要です');
            pose(f, true);
        }
        for (const w of s.waterSystems) {
            record(w, 'waterSystem');
            id(w.id, 'waterSystem.id');
            if (systemIds.has(w.id))
                fail('waterSystem.id', '重複');
            systemIds.add(w.id);
            if (!['soaker', 'mist'].includes(w.kind) || kinds.has(w.kind))
                fail('waterSystem.kind', '方式は各1系統です');
            kinds.add(w.kind);
            bool(w.enabled, 'waterSystem.enabled');
            number(w.onSec, 0, 86400, '散水ON秒');
            number(w.offSec, 0, 86400, '散水OFF秒');
            if (w.onSec + w.offSec <= 0)
                fail('散水周期', 'ON/OFFの両方0は不可');
            number(w.hoursPerDay, 0, 24, '散水運転時間');
            if (!(0, dailySchedule_js_1.validDailyStartHour)(w.dailyStartHour))
                fail('散水運転開始', '0〜24未満・0.25時間刻みが必要です');
            number(w.pumpPowerKw, 0, 20, 'ポンプ電力');
            if (!Array.isArray(w.nozzles))
                fail('nozzles', '配列が必要です');
            nozzleCount += w.nozzles.length;
            for (const n of w.nozzles) {
                number(n.flowLpm, 0, 20, 'ノズル流量');
                number(n.halfAngleDeg, 1, 85, '噴霧半角');
                pose(n, false);
            }
        }
        if (nozzleCount > 100)
            fail('nozzles', '各案の全系統合計で最大100個です');
    }
    if (p.baselineScenarioId !== 'baseline' || !ids.has(p.baselineScenarioId) || !ids.has(p.activeScenarioId) || !ids.has('working-soaker') || !ids.has('working-mist'))
        fail('scenario', '案ID・参照先が不正です');
    for (const s of p.scenarios)
        if (s.readOnly !== (s.id === p.baselineScenarioId))
            fail('readOnly', '基準だけを読取専用にしてください');
    const v = record(p.view, 'view');
    if (!['2d', '3d'].includes(v.mode) || !['delta', 'deficit', 'speed', 'temperature'].includes(v.metric))
        fail('view', '表示設定が不正です');
    for (const k of ['roof', 'flow', 'particles'])
        bool(v[k], `view.${k}`);
    if (v.analysis !== undefined)
        bool(v.analysis, 'view.analysis');
    for (const k of ['realistic', 'heatmap'])
        if (v[k] !== undefined)
            bool(v[k], `view.${k}`);
    if (v.selectedAreaId !== undefined && v.selectedAreaId !== null)
        id(v.selectedAreaId, 'view.selectedAreaId');
    number(v.timeSec, 0, 3600, 'view.timeSec');
    if (!layout.probes.some(q => q.id === v.selectedProbeId))
        fail('selectedProbeId', '地点がありません');
    if (v.selectedDeviceId !== null) {
        id(v.selectedDeviceId, 'selectedDeviceId');
        const s = p.scenarios.find((s) => s.id === p.activeScenarioId);
        if (!s.fans.concat(s.waterSystems.flatMap((w) => w.nozzles)).some((d) => d.id === v.selectedDeviceId))
            fail('selectedDeviceId', '設備がありません');
    }
    if (v.camera !== null) {
        const c = record(v.camera, 'camera');
        number(c.azimuth, -100, 100, 'camera.azimuth');
        number(c.elevation, .1, 1.56, 'camera.elevation');
        number(c.distance, 8, 160, 'camera.distance');
        if (!Array.isArray(c.target) || c.target.length !== 3)
            fail('camera.target', '3座標が必要です');
        c.target.forEach((n) => number(n, -100, 200, 'camera.target'));
    }
    const prices = record(p.prices, 'prices');
    for (const k of ['electricityYenKwh', 'waterYenM3'])
        if (prices[k] !== null)
            number(prices[k], 0, 1e6, `prices.${k}`);
    if (!Array.isArray(p.provenance) || p.provenance.length < 1 || p.provenance.length > 30)
        fail('provenance', '根拠・仮定が必要です');
    for (const item of p.provenance) {
        record(item, 'provenance');
        text(item.id, 'provenance.id');
        text(item.note, 'provenance.note', 3000);
        if (!['source-based', 'adapted-reference', 'design-assumption', 'derived'].includes(item.classification))
            fail('provenance.classification', '分類が不正です');
        if (item.url !== undefined) {
            text(item.url, 'provenance.url', 2000);
            if (!/^https:\/\//.test(item.url))
                fail('provenance.url', 'HTTPSのみです');
        }
    }
}
function parseProject(text) {
    if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024)
        fail('JSON', '最大2MiBです');
    let p;
    try {
        p = JSON.parse(text);
    }
    catch {
        fail('JSON', '読めないJSONです。現在の案は保持します');
    }
    // MCP evaluate and result exports carry a full Project under `project`.
    // Only inputs are restored; supplied calculation results are never trusted.
    safeTree(p);
    if (p && typeof p === 'object' && !Array.isArray(p) && !Object.hasOwn(p, 'schemaVersion') && Object.hasOwn(p, 'project'))
        p = p.project;
    validateProject(p);
    return p;
}

},
"data/defaults.js":function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODEL = exports.APP_VERSION = void 0;
exports.createProject = createProject;
const layout_js_1 = require("../template/layout.js");
const milk_js_1 = require("../model/milk.js");
exports.APP_VERSION = '0.10.0-preview.1';
exports.MODEL = { version: 'cooling-integrated-v0.10', roof: { version: 'cooling-thermal-v0.5-assumptions-1', backgroundSensibleW: 10000, bareResistance: .02, conductivity: .035, hOutConv: 10, hOutRad: 5, hInConv: 3, hInRad: 5, viewFactor: .35, waterCapacityKgM2: .05 }, surfaceTemperatureC: 35, areaM2: 4.5, wetAreaM2: 2, patchLengthM: 2, patchWidthM: .6, baseWetFraction: .06, emissivity: .95, radiantOffsetC: 2, kSpread: .1, kDecay: 4, latentHeatJkg: 2430000, airDensityKgM3: 1.2, airCpJkgK: 1006, vaporGasConstant: 461.5, hcIntercept: 3.5, hcSlope: 4, profiles: [
        { id: 'low', name: '低値側の仮定', outletMultiplier: .8, hcMultiplier: .8, mistEfficiency: .4, maxFilmKg: .15 },
        { id: 'reference', name: '基準の仮定', outletMultiplier: 1, hcMultiplier: 1, mistEfficiency: .6, maxFilmKg: .3 },
        { id: 'high', name: '高値側の仮定', outletMultiplier: 1.2, hcMultiplier: 1.2, mistEfficiency: .8, maxFilmKg: .45 }
    ] };
function createProject() {
    const template = { id: 'fs-amr1-50-guided-reference', version: 1, lengthM: 36.4, widthM: 23.5, eaveHeightM: 4, ridgeHeightM: 8.7 }, layout = (0, layout_js_1.buildLayout)(template);
    const fans = [];
    for (const zoneId of ['feeding', 'stall-A', 'stall-B', 'stall-C', 'stall-D']) {
        const z = layout.zones.find(z => z.id === zoneId);
        for (const [i, u] of [.1, .6].entries())
            fans.push({ id: `fan-${zoneId}-${i + 1}`, label: `${z.name} ファン ${i + 1}`, enabled: true, x: z.x + u * z.widthM, y: z.y + z.depthM / 2, heightM: 3, yawDeg: 0, pitchDownDeg: 10, diameterM: 1, outletSpeedMps: 5, powerKw: .4, hoursPerDay: 16, dailyStartHour: 8, anchor: { zoneId, u, v: .5 } });
    }
    const waterSystems = ['soaker', 'mist'].map(kind => ({ id: `water-${kind}`, kind, enabled: kind === 'soaker', onSec: kind === 'soaker' ? 120 : 60, offSec: kind === 'soaker' ? 600 : 240, hoursPerDay: 8, dailyStartHour: 8, pumpPowerKw: kind === 'soaker' ? .25 : 1, nozzles: layout.probes.filter(p => p.kind === 'feeding').map((p, i) => ({ id: `${kind}-${i + 1}`, label: `${kind === 'soaker' ? 'ソーカー' : 'ミスト'} ${i + 1}`, enabled: true, x: p.x, y: p.y, heightM: 2.5, yawDeg: 0, pitchDownDeg: 90, halfAngleDeg: kind === 'soaker' ? 25 : 60, flowLpm: kind === 'soaker' ? 1.3 : .1, anchor: (0, layout_js_1.anchorPose)(p, template, layout) })) }));
    const baseline = { id: 'baseline', name: '基準案', readOnly: true, roof: { reflectance: .2, insulationM: 0, sprayEnabled: false, flowLpmM2: .05, onSec: 120, offSec: 480, hoursPerDay: 8, dailyStartHour: 8, pumpPowerKw: .25 }, fans, waterSystems };
    const soaker = { ...structuredClone(baseline), id: 'working-soaker', name: '編集案 A', readOnly: false };
    const mist = { ...structuredClone(baseline), id: 'working-mist', name: '編集案 B', readOnly: false };
    mist.waterSystems.forEach(w => w.enabled = w.kind === 'mist');
    return { schemaVersion: 10, dailyWeather: { mode: 'constant', hours: [] }, references: { milkModel: 'milk-table-cowbell178-v1', baselineMilkKgPerDay: 35, fertility: { model: 'fertility-thi-period-or-baccouri2025-v1', p0: .4, mode: 'manual', exposureAssumed: true, temperatureC: 26, relativeHumidityPct: 70, profileVersion: 1 } }, milkSimulation: structuredClone(milk_js_1.DEFAULT_MILK_SIMULATION), appVersion: exports.APP_VERSION, template, environment: { temperatureC: 32, relativeHumidityPct: 70, pressurePa: 101325, backgroundSpeedMps: .2, ventilationM3sPerM2: .015, solarRoofWm2: 800 }, model: structuredClone(exports.MODEL), baselineScenarioId: 'baseline', activeScenarioId: 'working-soaker', scenarios: [baseline, soaker, mist], view: { mode: '3d', metric: 'deficit', timeSec: 0, selectedProbeId: 'feed-07', selectedDeviceId: null, roof: false, flow: true, particles: true, camera: null, analysis: false, selectedAreaId: null }, prices: { electricityYenKwh: 27, waterYenM3: 300 }, provenance: [
            { id: 'dimensions', classification: 'adapted-reference', note: '原事例36.4×23.5m・70頭の外形を参考に、内部を50床の独自配置へ変更。設計推奨ではない。', url: 'https://holstein.pl/nowoczesna-obora-w-gospodarstwie-rodzinnym/' },
            { id: 'layout', classification: 'adapted-reference', note: '採食・休息・搾乳の区画関係を参考にした独自配置。原図やメーカー3Dデータは同梱しない。', url: 'https://www.orionkikai.co.jp/rakuno/how_to/auto-milking-system/' },
            { id: 'psychrometrics', classification: 'source-based', note: 'SIの飽和蒸気圧・湿度比・エンタルピー・比体積の関係。仮換気量の妥当性を保証するものではない。', url: 'https://psychrometrics.github.io/psychrolib/api_docs.html' },
            { id: 'milk', classification: 'source-based', note: '全酪連COWBELL No.178（2025年10月）p.6の送風体感温度式、p.8の乳量表。日本飼養標準2017・柴田ら1984の抜粋。乳量は掲載6条件・RH60〜70%のみ。' },
            { id: 'milk-daily', classification: 'design-assumption', note: '乳量仮説モデル milk-heat-deficit-v0.1 の係数は demo_assumption に相当する仮定。Y0=40kg、Qref=630W、beta=0.010、上限25%、遅れ0.2/0.5/0.3、滞在14/6/4時間相当。文献からの回帰係数ではなく、信頼区間でもない。' },
            { id: 'roof', classification: 'design-assumption', note: '屋根の係数と背景熱は熱モデルv0.5の固定仮定。遮熱反射率0.7・断熱20mm。放射・風・散水の効果をTHIや深部体温へ換算しない。' },
            { id: 'fertility', classification: 'source-based', note: 'Baccouri et al. (2025) Table 2の5期間OR。仮の基準確率40%。屋外THIから局所THIへの適用はアプリの追加仮定。', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12249091/' },
            { id: 'model', classification: 'design-assumption', note: '風速曲線、熱伝達係数、体表35℃、面積4.5m²、換気量、蒸発率、保持水量は仕様v0.4の実装仮定。現場未検証。' },
            { id: 'calculation', classification: 'derived', note: '70地点は独立試行。放熱Wを牛群へ合算しない。日乳量は仮説モデルv0.1の牛群平均、受胎は別の52日代表シナリオ。乳量の掲載表は資料として保持。' }
        ] };
}

}};const cache={};function resolve(id,from){if(!id.startsWith('.')){if(modules[id])return id;throw Error('Optional dependency not included in the offline distribution: '+id)}const out=[];for(const x of (from.slice(0,from.lastIndexOf('/')+1)+id).split('/')){if(x==='..')out.pop();else if(x!=='.'&&x)out.push(x)}return out.join('/')}function load(id){if(cache[id])return cache[id].exports;const fn=modules[id];if(!fn)throw Error('Missing module: '+id);const module={exports:{}};cache[id]=module;fn(s=>load(resolve(s,id)),module,module.exports);return module.exports}load("worker/simulation.worker.js");})();