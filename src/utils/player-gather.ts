/** Fit the retained expanded canvas into the live shell and converge on artwork. */
export function playerGather(width:number,height:number) {
  const p=Math.max(0,Math.min(1,(width-60)/352));
  const scale=0.12+0.88*p;
  const centerX=(60+352*p)/2;
  const centerY=(60+(height-60)*p)/2;
  return {scale,x:centerX-206,y:centerY-height/2,opacity:Math.max(0,Math.min(1,p/0.22)),p};
}
