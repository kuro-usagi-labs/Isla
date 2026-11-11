const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const capsule=(x:number,w:number)=>`M ${x+30} 0 H ${x+w-30} A 30 30 0 0 1 ${x+w} 30 A 30 30 0 0 1 ${x+w-30} 60 H ${x+30} A 30 30 0 0 1 ${x} 30 A 30 30 0 0 1 ${x+30} 0 Z`;

/** One contour stretches, develops a curved neck, then becomes two capsules. */
export function liquidCompactFrame(progress:number,side:'left'|'right') {
  const p=Number.isFinite(progress)?clamp(progress):0;
  const orbX=side==='left'?164*p:0;
  const controlsX=side==='right'?72*p:0;
  const controlsWidth=60+92*p;
  const a=side==='right'?{x:orbX,w:60}:{x:controlsX,w:controlsWidth};
  const b=side==='right'?{x:controlsX,w:controlsWidth}:{x:orbX,w:60};
  const gap=b.x-(a.x+a.w);
  const t=clamp((gap+12)/24);
  const h=24*(1-t*t*(3-2*t));
  const inset=30-Math.sqrt(900-h*h);
  const start=a.x+a.w-inset;
  const end=b.x+inset;
  let path:string;
  if(p>=0.985) path=capsule(a.x,a.w)+' '+capsule(b.x,b.w);
  else if(end<=start || p<0.6) path=capsule(a.x,Math.max(a.x+a.w,b.x+b.w)-a.x);
  else {
    const waist=h*(1-t)*0.65;
    const bend=(end-start)*0.42;
    path=`M ${a.x+30} 0 H ${a.x+a.w-30} A 30 30 0 0 1 ${start} ${30-h}
      C ${start+bend} ${30-waist} ${end-bend} ${30-waist} ${end} ${30-h}
      A 30 30 0 0 1 ${b.x+30} 0 H ${b.x+b.w-30} A 30 30 0 0 1 ${b.x+b.w} 30
      A 30 30 0 0 1 ${b.x+b.w-30} 60 H ${b.x+30} A 30 30 0 0 1 ${end} ${30+h}
      C ${end-bend} ${30+waist} ${start+bend} ${30+waist} ${start} ${30+h}
      A 30 30 0 0 1 ${a.x+a.w-30} 60 H ${a.x+30} A 30 30 0 0 1 ${a.x} 30 A 30 30 0 0 1 ${a.x+30} 0 Z`;
  }
  return {orbX,controlsX,controlsWidth,path};
}
