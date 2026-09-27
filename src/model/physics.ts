import type {Model,Profile,HeatComponents} from '../domain/project.js';
export function thi(t:number,rh:number){return .8*t+(rh/100)*(t-14.4)+46.4}
export function onTotalSeconds(hours:number,on:number,off:number){
 if(![hours,on,off].every(Number.isFinite)||hours<0||on<0||off<0||on+off<=0)throw Error('ON/OFF周期が不正です（両方0は不可）');
 const h=hours*3600,p=on+off;return Math.floor(h/p)*on+Math.min(h%p,on);
}
export const isOn=(seconds:number,on:number,off:number,hours:number)=>seconds<hours*3600&&on>0&&on+off>0&&(seconds%(on+off))<on;
/** ASHRAE SI eq. 5/6, as documented by PsychroLib. Temperatures -100..200 C. */
export function saturationPressure(t:number){
 if(!Number.isFinite(t)||t< -100||t>200)throw Error('飽和蒸気圧の温度範囲外');
 const T=t+273.15;
 const ln=t<=.01?-5674.5359/T+6.3925247-.009677843*T+.00000062215701*T*T+2.0747825e-9*T**3-9.484024e-13*T**4+4.1635019*Math.log(T):-5800.2206/T+1.3914993-.048640239*T+.000041764768*T*T-.000000014452093*T**3+6.5459673*Math.log(T);
 return Math.exp(ln);
}
export const humidityRatio=(t:number,rh:number,pressure:number)=>{const pv=rh/100*saturationPressure(t);return .621945*pv/(pressure-pv)};
export const enthalpy=(t:number,w:number)=>1000*(1.006*t+w*(2501+1.86*t));
export const specificVolume=(t:number,w:number,p:number)=>287.042*(t+273.15)*(1+1.607858*w)/p;
export const relativeHumidity=(t:number,w:number,p:number)=>100*(p*w/(.621945+w))/saturationPressure(t);
export function mistAir(t:number,rh:number,pressure:number,volume:number,waterKgs:number,eta:number){
 const wi=humidityRatio(t,rh,pressure),h=enthalpy(t,wi),md=volume/specificVolume(t,wi,pressure);
 if(md<=0)throw Error('空気交換量が0以下です');
 if(waterKgs<=0||eta<=0||rh>=100-1e-10)return {temperatureC:t,rhPct:rh,enthalpyJkg:h,evaporatedKgs:0,unevaporatedKgs:waterKgs};
 let lo=-80,hi=t;
 for(let i=0;i<65;i++){const x=(lo+hi)/2;if(enthalpy(x,humidityRatio(x,100,pressure))>h)hi=x;else lo=x}
 const ws=humidityRatio((lo+hi)/2,100,pressure),dw=Math.min(eta*waterKgs/md,Math.max(0,ws-wi)),wo=wi+dw;
 const temperatureC=(h/1000-2501*wo)/(1.006+1.86*wo),outRH=relativeHumidity(temperatureC,wo,pressure);
 if(outRH>100+1e-6||outRH<0)throw Error('ミスト計算が飽和制約を超えました');
 return {temperatureC,rhPct:Math.min(100,outRH),enthalpyJkg:enthalpy(temperatureC,wo),evaporatedKgs:md*dw,unevaporatedKgs:waterKgs-md*dw};
}
export function convectiveHeat(area:number,ts:number,ta:number,speed:number,mult=1){return area*(3.5+4*Math.sqrt(speed))*mult*(ts-ta)}
export function heatTerms(ta:number,rh:number,speed:number,radiantC:number,m:Model,p:Profile){
 const hc=(m.hcIntercept+m.hcSlope*Math.sqrt(speed))*p.hcMultiplier,km=hc/(m.airDensityKgM3*m.airCpJkgK);
 const drho=(saturationPressure(m.surfaceTemperatureC)-rh/100*saturationPressure(ta))/(m.vaporGasConstant*((m.surfaceTemperatureC+ta)/2+273.15));
 const condensationKgs=km*m.areaM2*Math.max(-drho,0),base=km*m.areaM2*m.baseWetFraction*Math.max(drho,0);
 const components:HeatComponents={convectionW:m.areaM2*hc*(m.surfaceTemperatureC-ta),radiationW:m.emissivity*5.670374419e-8*m.areaM2*((m.surfaceTemperatureC+273.15)**4-(radiantC+273.15)**4),baseEvaporationW:m.latentHeatJkg*base,soakerEvaporationW:0,condensationW:-m.latentHeatJkg*condensationKgs};
 return {components,km,drho,condensationKgs};
}
export function filmStep(mass:number,capturedKgs:number,terms:ReturnType<typeof heatTerms>,m:Model,p:Profile,dt:number){
 const condensed=terms.condensationKgs*m.wetAreaM2/m.areaM2,received=mass+(capturedKgs+condensed)*dt,runoff=Math.max(received-p.maxFilmKg,0),pre=Math.min(received,p.maxFilmKg);
 const potential=terms.km*m.wetAreaM2*(1-m.baseWetFraction)*(pre/p.maxFilmKg)*Math.max(terms.drho,0),evaporated=Math.min(potential*dt,pre),next=pre-evaporated;
 const residual=next-mass-(capturedKgs*dt+condensed*dt-evaporated-runoff);
 if(next< -1e-12||next>p.maxFilmKg+1e-12||Math.abs(residual)>1e-8)throw Error('体表水の収支が不整合です');
 return {mass:Math.max(0,next),capturedKg:capturedKgs*dt,condensedKg:condensed*dt,evaporatedKg:evaporated,runoffKg:runoff,residualKg:residual,heatW:evaporated/dt*m.latentHeatJkg};
}
