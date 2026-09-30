import type {Project,Scenario,RoofResult,RoofSample} from '../domain/project.js';
import {saturationPressure,isOn} from './physics.js';

export const roofArea=(p:Pick<Project,'template'>)=>2*p.template.lengthM*Math.hypot(p.template.widthM/2,p.template.ridgeHeightM-p.template.eaveHeightM);
export interface RoofState {outerC:number;underC:number;airC:number;evaporatedKgsM2:number;residualWm2:number;radiantC:number}
/** Direct port of v0.5 roof_state. All numbers in SI; solve zero-storage roof/air balance. */
export function solveRoof(p:Project,s:Scenario,waterKgM2:number,dt:number,env?:Project['environment']):RoofState {
  const e=env??p.environment,m=p.model,k=m.roof,r=k.bareResistance+s.roof.insulationM/k.conductivity;
  const ca=m.airDensityKgM3*m.airCpJkgK*e.ventilationM3sPerM2*p.template.lengthM*p.template.widthM,ah=roofArea(p)*k.hInConv;
  const beta=ah/(ca+ah),b=k.backgroundSensibleW/(ca+ah),c=k.hInConv*(1-beta)+k.hInRad;
  const pv=e.relativeHumidityPct/100*saturationPressure(e.temperatureC),km=k.hOutConv/(m.airDensityKgM3*m.airCpJkgK),wet=waterKgM2/k.waterCapacityKgM2;
  function at(outerC:number):RoofState {
    const underC=e.temperatureC+(outerC-e.temperatureC+r*k.hInConv*b)/(1+r*c),airC=e.temperatureC+b+beta*(underC-e.temperatureC);
    const drho=(saturationPressure(outerC)-pv)/(m.vaporGasConstant*((outerC+e.temperatureC)/2+273.15));
    const evaporatedKgsM2=Math.min(km*wet*Math.max(drho,0),waterKgM2/dt);
    const residualWm2=(1-s.roof.reflectance)*e.solarRoofWm2-(k.hOutConv+k.hOutRad)*(outerC-e.temperatureC)-(outerC-underC)/r-m.latentHeatJkg*evaporatedKgsM2;
    const radiantC=(k.viewFactor*(underC+273.15)**4+(1-k.viewFactor)*(e.temperatureC+273.15)**4)**.25-273.15;
    return {outerC,underC,airC,evaporatedKgsM2,residualWm2,radiantC};
  }
  let lo=0,hi=130,flo=at(lo).residualWm2,fhi=at(hi).residualWm2;
  if(!Number.isFinite(flo)||!Number.isFinite(fhi)||flo*fhi>0)throw Error('cannot solve the roof heat balance; check input ranges');
  for(let i=0;i<60;i++){
    const mid=(lo+hi)/2,st=at(mid);if(Math.abs(st.residualWm2)<1e-9||hi-lo<1e-9)return st;
    if(flo*st.residualWm2<=0)hi=mid;else {lo=mid;flo=st.residualWm2}
  }
  return at((lo+hi)/2);
}
export function roofTimeline(p:Project,s:Scenario,dt=1):{result:RoofResult;states:RoofState[]} {
  const cap=p.model.roof.waterCapacityKgM2,area=roofArea(p),n=Math.round(3600/dt),dry=solveRoof(p,s,0,dt),states:RoofState[]=[],series:RoofSample[]=[];
  let mass=0,supplied=0,evaporated=0,runoff=0,maxResidual=0,outer=0,under=0,air=0,radiant=0;
  for(let i=0;i<n;i++){
    const t=i*dt,flow=s.roof.sprayEnabled&&isOn(t,s.roof.onSec,s.roof.offSec,s.roof.hoursPerDay)?s.roof.flowLpmM2/60:0;
    const received=mass+flow*dt,spill=Math.max(0,received-cap),available=Math.min(cap,received),st=available>0?solveRoof(p,s,available,dt):dry;
    mass=Math.max(0,available-st.evaporatedKgsM2*dt);supplied+=flow*dt;evaporated+=st.evaporatedKgsM2*dt;runoff+=spill;
    maxResidual=Math.max(maxResidual,Math.abs(st.residualWm2));outer+=st.outerC*dt;under+=st.underC*dt;air+=st.airC*dt;radiant+=st.radiantC*dt;states.push(st);
    if(i===0||(i+1)*dt%60===0)series.push({timeSec:(i+1)*dt,outerC:st.outerC,underC:st.underC,airC:st.airC,radiantC:st.radiantC,waterKgM2:mass,evaporatedKgsM2:st.evaporatedKgsM2});
  }
  return {states,result:{meanOuterC:outer/3600,meanUnderC:under/3600,meanAirC:air/3600,meanRadiantC:radiant/3600,areaM2:area,suppliedL:supplied*area,evaporatedKg:evaporated*area,runoffL:runoff*area,finalWaterKg:mass*area,waterResidualKg:(supplied-evaporated-runoff-mass)*area,energyResidualMaxWm2:maxResidual,series}};
}
