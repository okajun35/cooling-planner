import type {Template,Layout,Zone,Probe,Pose,AirCell} from '../domain/project.js';
export function buildLayout(t:Template):Layout{
 const L=t.lengthM,W=t.widthM,a=(W-18.5)/2;
 const zones:Zone[]=[
  {id:'feed',name:'Feed rail / feed vehicle',x:0,y:0,widthM:L,depthM:4,kind:'feed'},
  {id:'feeding',name:'Feeding alley',x:2.5,y:4,widthM:L-11,depthM:4,kind:'feeding'},
 ];
 const rows=[['A',8,13],['B',10.5+a,12],['C',13+a,13],['D',15.5+2*a,12]] as const;
 const stalls:Layout['stalls']=[],probes:Probe[]=[];
 for(const [row,y,n] of rows){
  zones.push({id:`stall-${row}`,name:`Stalls ${row}`,x:2.5,y,widthM:L-11,depthM:2.5,kind:'stall'});
  const left=Math.ceil(n/2),start=2.5+((L-11)-(n*1.2+2.5))/2;
  for(let i=0;i<n;i++){
   const x=start+i*1.2+(i>=left?2.5:0),id=`stall-${row}-${String(i+1).padStart(2,'0')}`;
   stalls.push({id,x,y,widthM:1.2,depthM:2.5,row});
   probes.push({id,label:`Stall ${row}${i+1}`,x:x+.6,y:y+1.25,heightM:.5,zoneId:`stall-${row}`,patchYawDeg:90,kind:'stall'});
  }
 }
 zones.push(
  {id:'aisle-1',name:'Cow alley 1',x:0,y:10.5,widthM:L-6,depthM:a,kind:'aisle'},
  {id:'aisle-2',name:'Cow alley 2',x:0,y:15.5+a,widthM:L-6,depthM:a,kind:'aisle'},
  {id:'robot',name:'Milking robot',x:L-6,y:8,widthM:3,depthM:3,kind:'robot'},
  {id:'utility',name:'Equipment / utility room',x:L-3,y:8,widthM:3,depthM:3,kind:'utility',solid:true},
  {id:'waiting',name:'Robot queue',x:L-6,y:11,widthM:6,depthM:W-15,kind:'waiting'},
  {id:'isolation-1',name:'Isolation',x:L-6,y:W-4,widthM:3,depthM:4,kind:'isolation'},
  {id:'isolation-2',name:'Office',x:L-3,y:W-4,widthM:3,depthM:4,kind:'isolation'}
 );
 for(let i=0;i<12;i++)probes.push({id:`feed-${String(i+1).padStart(2,'0')}`,label:`Feeding ${i+1}`,x:2.5+(i+.5)*(L-11)/12,y:5.75,heightM:1.3,zoneId:'feeding',patchYawDeg:90,kind:'feeding'});
 for(let j=0;j<4;j++)for(let i=0;i<2;i++)probes.push({id:`wait-${j*2+i+1}`,label:`Robot queue ${j*2+i+1}`,x:L-6+(i+.5)*3,y:11+(j+.5)*(W-15)/4,heightM:1.3,zoneId:'waiting',patchYawDeg:90,kind:'waiting'});
 const cells:AirCell[]=[];
 for(let iy=0;iy<Math.ceil(W/2);iy++)for(let ix=0;ix<Math.ceil(L/2);ix++){
  const x=ix*2,y=iy*2,w=Math.min(2,L-x),d=Math.min(2,W-y);
  cells.push({id:`cell-${ix}-${iy}`,ix,iy,x,y,widthM:w,depthM:d,areaM2:w*d});
 }
 return {zones,stalls,probes,cells,solids:zones.filter(z=>z.solid).map(z=>({min:[z.x,0,z.y],max:[z.x+z.widthM,4,z.y+z.depthM]}))};
}
export function anchorPose(p:Pick<Pose,'x'|'y'>,t:Template,layout=buildLayout(t)):Pose['anchor']{
 const zone=layout.zones.find(z=>p.x>=z.x&&p.x<=z.x+z.widthM&&p.y>=z.y&&p.y<=z.y+z.depthM);
 return zone?{zoneId:zone.id,u:(p.x-zone.x)/zone.widthM,v:(p.y-zone.y)/zone.depthM}:{zoneId:'barn',u:p.x/t.lengthM,v:p.y/t.widthM};
}
export function positionFromAnchor(p:Pose,t:Template,layout:Layout){
 const z=layout.zones.find(z=>z.id===p.anchor.zoneId);
 return z?{x:z.x+p.anchor.u*z.widthM,y:z.y+p.anchor.v*z.depthM}:{x:p.anchor.u*t.lengthM,y:p.anchor.v*t.widthM};
}
