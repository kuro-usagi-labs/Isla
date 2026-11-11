export async function auditPlayerGather(report:(value:string)=>void) {
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  const click=(selector:string)=>document.querySelector<HTMLButtonElement>(selector)!.click();
  const root=document.querySelector<HTMLElement>('.xp-root')!;
  const sample=()=>{const r=root.getBoundingClientRect(),s=document.querySelector('.isla-island-shell')!.getBoundingClientRect();return {width:r.width,height:r.height,opacity:Number(getComputedStyle(root).opacity),shellWidth:s.width,centerError:Math.abs(r.x+r.width/2-s.x-s.width/2),sameRoot:root===document.querySelector('.xp-root'),inert:root.inert,progressPresent:Boolean(root.querySelector('[aria-label="Playback Progress"]'))};};
  click('[data-compact-orb]');await wait(600);click('[aria-label="Expand music player"]');await wait(1300);
  const open=sample();click('[aria-label="Collapse to floating pill"]');await wait(150);const gathering=sample();
  click('[data-compact-orb]');await wait(90);click('[aria-label="Expand music player"]');await wait(1200);const reopened=sample();
  click('[aria-label="Up Next"]');await wait(650);click('[aria-label="Collapse to floating pill"]');await wait(150);const drawerGathering=sample();
  await wait(650);const rest=sample();
  report(JSON.stringify({open,gathering,reopened,drawerGathering,rest},null,2));
}
