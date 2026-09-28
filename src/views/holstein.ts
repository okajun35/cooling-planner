import * as THREE from 'three';

/** Authored longitudinal cross-sections: shoulder, rib barrel, angular loin and rump.
 * Local +Z is the tail end; Y=0 is the barrel centre. Presentation geometry only. */
export function holsteinBody(){
 const sections=[[-.78,.13,.25,.00],[-.62,.27,.38,.035],[-.37,.34,.41,0],[0,.38,.43,-.025],[.34,.35,.39,.015],[.57,.32,.36,.025],[.76,.20,.30,.005],[.82,.06,.18,0]];
 const positions:number[]=[],uv:number[]=[],indices:number[]=[],sides=16;
 sections.forEach(([z,width,height,offset],j)=>{
  for(let i=0;i<=sides;i++){
   const angle=i/sides*Math.PI*2,sy=Math.sin(angle);
   // A firmer, flatter topline and a deeper abdomen, rather than an egg silhouette.
   const y=sy>=0?Math.pow(sy,.45)*height:sy*height*1.05;
   positions.push(Math.cos(angle)*width,y+offset,z);uv.push(i/sides,j/(sections.length-1));
   if(j<sections.length-1&&i<sides){const a=j*(sides+1)+i,b=a+sides+1;indices.push(a,a+1,b,b,a+1,b+1)}
  }
 });
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
