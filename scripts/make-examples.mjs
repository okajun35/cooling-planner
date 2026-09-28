/** Generate validated, importable v9 projects and deterministic integrated results. */
import {writeFile,mkdir} from 'node:fs/promises';
import {createProject} from '../.compiled/data/defaults.js';
import {validateProject} from '../.compiled/domain/validation.js';
import {simulate} from '../.compiled/model/simulation.js';
import {simulateDaily,mergeDaily} from '../.compiled/model/dailySimulation.js';
import {milkReference,fertilityReference} from '../.compiled/model/references.js';
await mkdir('examples',{recursive:true});await mkdir('evidence',{recursive:true});
const save=async(name,p)=>{validateProject(p);await writeFile('examples/'+name,JSON.stringify(p,null,2)+'\n')};
const base=createProject();await save('01-initial.json',base);
const roof=structuredClone(base);Object.assign(roof.scenarios[1].roof,{reflectance:.7,insulationM:.02});await save('02-roof-comparison.json',roof);
const linked=structuredClone(roof);linked.references.fertility.mode='simulation';linked.references.fertility.exposureAssumed=true;await save('03-explicit-period-assumption.json',linked);
const water=structuredClone(roof);water.scenarios[1].roof.sprayEnabled=true;water.view.selectedDeviceId='soaker-1';await save('04-roof-and-cow-spraying.json',water);
const result=simulate(roof),daily=simulateDaily(roof);mergeDaily(result,daily.daily,daily.status==='error'?'error':'complete');
const pid=roof.view.selectedProbeId;
const summary={model:roof.model.version,schemaVersion:roof.schemaVersion,inputHash:result.inputHash,durationSec:result.durationSec,dailyMilkStatus:result.dailyMilkStatus,weather:roof.environment,milkModel:roof.milkSimulation,selectedProbeId:pid,baselineDescription:'既存ファン10台＋ソーカー12個、屋根対策なし。無設備との比較ではない。',scenarios:result.scenarios.map(s=>{const q=s.points.find(x=>x.probeId===pid);return {id:s.id,name:roof.scenarios.find(x=>x.id===s.id).name,roof:{...s.roof,series:undefined},selectedPoint:{...q,series:undefined},resources:s.resources,trialWaterL:s.trialWaterL,trialKwh:s.trialKwh,dailyMilk:s.dailyMilk}}),milkExample:milkReference(27,65,2.24,35),fertilityExamples:[15,20,22,26].map(t=>({temperatureC:t,rh:70,...fertilityReference({...base.references.fertility,temperatureC:t},null,null)}))};
await writeFile('evidence/integrated-example-results.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary.scenarios.map(s=>({name:s.name,temperature:s.selectedPoint.meanAirTemperatureC,under:s.roof.meanUnderC,wind:s.selectedPoint.meanSpeedMps,heatDelta:s.selectedPoint.deltaQrefW,range:s.selectedPoint.parameterEnvelopeW,waterL:s.resources.waterLPerDay})),null,2));
