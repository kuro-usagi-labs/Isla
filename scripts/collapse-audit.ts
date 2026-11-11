export async function auditCollapse(report:(value:string)=>void) {
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  const orb=()=>document.querySelector<HTMLButtonElement>('[data-compact-orb]')!;
  const group=document.querySelector<HTMLElement>('[aria-label="Playback controls"]')!;
  const sample=()=>{
    const r=group.getBoundingClientRect(),a=orb().getBoundingClientRect();
    return {label:orb().getAttribute('aria-label'),sameNode:group===document.querySelector('[aria-label="Playback controls"]'),opacity:Number(getComputedStyle(group).opacity),distance:Math.abs(r.x+r.width/2-a.x-a.width/2),inert:Boolean(group.closest('[inert]')),expanded:Boolean(document.querySelector('.xp-root:not([inert])'))};
  };
  orb().click();await wait(750);const open=sample();
  orb().click();await wait(150);const gathering=sample();
  await wait(600);const rest=sample();
  for(let i=0;i<8;i++){orb().click();await wait(90);}
  await wait(750);const reversed=sample();
  report(JSON.stringify({open,gathering,rest,reversed},null,2));
}
