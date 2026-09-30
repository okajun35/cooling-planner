import type {Layout} from '../domain/project.js';

/**
 * Display faces for area-cooling-visualization-v0.1. Each face is a rectangle that
 * shows the value of exactly one evaluation probe — it is NOT an area-wide sample.
 * Faces are derived from the template layout; physics, probes, and weights are untouched.
 */
export interface FaceRect {id:string;probeId:string;label:string;kind:'stall'|'feeding'|'waiting';x:number;y:number;widthM:number;depthM:number;surfaceY:number}

/** Rendered elevation of each face in 3D. Stall faces sit just above the .15 m stall
 * base block; feeding/waiting faces just above the floor. Clicks must intersect the
 * face at this height — projecting onto y=0 selects a neighbouring face in oblique views. */
export const FACE_SURFACE_Y:{stall:number;other:number}={stall:.158,other:.052};

export function buildFaces(l:Layout):FaceRect[]{
  const faces:FaceRect[]=[];
  for(const st of l.stalls){
    const q=l.probes.find(q=>q.id===st.id);
    faces.push({id:`face-${st.id}`,probeId:st.id,label:q?.label??st.id,kind:'stall',x:st.x,y:st.y,widthM:st.widthM,depthM:st.depthM,surfaceY:FACE_SURFACE_Y.stall});
  }
  const feedZone=l.zones.find(z=>z.kind==='feeding')!,feed=l.probes.filter(q=>q.kind==='feeding');
  for(let i=0;i<feed.length;i++)faces.push({id:`face-${feed[i].id}`,probeId:feed[i].id,label:feed[i].label,kind:'feeding',x:feedZone.x+i*feedZone.widthM/feed.length,y:feedZone.y,widthM:feedZone.widthM/feed.length,depthM:feedZone.depthM,surfaceY:FACE_SURFACE_Y.other});
  const waitZone=l.zones.find(z=>z.kind==='waiting')!,wait=l.probes.filter(q=>q.kind==='waiting');
  for(let k=0;k<wait.length;k++)faces.push({id:`face-${wait[k].id}`,probeId:wait[k].id,label:wait[k].label,kind:'waiting',x:waitZone.x+(k%2)*waitZone.widthM/2,y:waitZone.y+Math.floor(k/2)*waitZone.depthM/4,widthM:waitZone.widthM/2,depthM:waitZone.depthM/4,surfaceY:FACE_SURFACE_Y.other});
  return faces;
}

export interface AreaGroup {id:string;label:string;probeIds:string[];subtotal?:boolean}

/** Display areas: stall rows A-D, feeding, waiting, plus the all-stall subtotal. */
export function buildAreas(l:Layout):AreaGroup[]{
  const out:AreaGroup[]=[];
  for(const row of ['A','B','C','D'])out.push({id:`stall-${row}`,label:`Stalls ${row}`,probeIds:l.probes.filter(q=>q.zoneId===`stall-${row}`).map(q=>q.id)});
  out.push({id:'feeding',label:'Feeding alley',probeIds:l.probes.filter(q=>q.kind==='feeding').map(q=>q.id)});
  out.push({id:'waiting',label:'Waiting area',probeIds:l.probes.filter(q=>q.kind==='waiting').map(q=>q.id)});
  out.push({id:'stalls',label:'All stalls (subtotal)',subtotal:true,probeIds:l.probes.filter(q=>q.kind==='stall').map(q=>q.id)});
  return out;
}

/** Which display area a probe belongs to (used for area-row highlighting). */
export const areaOfProbe=(l:Layout,probeId:string)=>buildAreas(l).find(a=>a.probeIds.includes(probeId))??null;
