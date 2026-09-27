import {escapeHtml} from '../views/common.js';
export const esc=escapeHtml;
export const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
export const num=(x:number|null|undefined,d=1)=>x===null||x===undefined||!Number.isFinite(x)?'—':x.toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d});
export const signed=(x:number|null|undefined,d=1)=>x===null||x===undefined?'—':(x>0?'+':'')+num(x,d);
export const icon=(name:string,size=20)=>{
 const paths:Record<string,string>={
  barn:'<path d="M3 21V8l9-5 9 5v13M3 8h18M8 21v-8h8v8M9 8V5m6 3V5"/>',
  fan:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 10C5 8 7 4 10 4l2 6zm2 2c2-7 6-5 6-2l-6 2zm-2 2c7 2 5 6 2 6l-2-6zm-2-2c-2 7-6 5-6 2l6-2z"/>',
  roof:'<path d="m2 11 10-8 10 8M5 10v11h14V10M8 15h8m-8 4h8"/>',
  drop:'<path d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  mist:'<path d="M3 7h12a3 3 0 1 0-3-3M3 12h17M3 17h11a3 3 0 1 1-3 3"/>',
  temp:'<path d="M9 15V5a3 3 0 0 1 6 0v10a5 5 0 1 1-6 0Z"/><path d="M12 8v11m6-12h3m-3 4h3"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  undo:'<path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5"/>',
  save:'<path d="M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8"/>',
  play:'<path d="m8 4 12 8-12 8V4Z"/>',
  cow:'<path d="M5 9 3 5l5 1 4-2 4 2 5-1-2 4v8l-4 4H9l-4-4V9Z"/><path d="M9 12h0m6 0h0M8 17h8"/>',
  arrow:'<path d="M3 12h18m-6-6 6 6-6 6"/>',
  bolt:'<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  layers:'<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  grid:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18m6-18v18"/>',
  heart:'<path d="M12 21S2 15 2 8a5 5 0 0 1 10-2 5 5 0 0 1 10 2c0 7-10 13-10 13Z"/>',
 };
 return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]??paths.info}</svg>`;
};
export function field(id:string,label:string,value:number|null,unit:string,attrs:string,min:number,max:number,step:number,disabled=false){return `<label class="number-field" for="${id}"><span>${label}</span><span class="input-unit"><input id="${id}" type="number" value="${value??''}" min="${min}" max="${max}" step="${step}" ${attrs} ${disabled?'disabled':''}><em>${unit}</em></span></label>`}
export function toggle(id:string,title:string,subtitle:string,checked:boolean,attrs:string,ic:string,disabled=false){return `<label class="toggle-row" for="${id}"><span class="device-icon">${icon(ic)}</span><span class="toggle-copy"><strong>${title}</strong><small>${subtitle}</small></span><input id="${id}" type="checkbox" ${checked?'checked':''} ${disabled?'disabled':''} ${attrs}><span class="switch"></span></label>`}
export function setHTML(id:string,html:string){const root=el(id);const states=new Map([...root.querySelectorAll('details[id]')].map(d=>[d.id,(d as HTMLDetailsElement).open]));root.innerHTML=html;for(const [id,open]of states){const d=document.getElementById(id);if(d instanceof HTMLDetailsElement)d.open=open}}
