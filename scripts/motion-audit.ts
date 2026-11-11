// Local preview only: exercise the real components and record their DOM geometry.
export async function auditIsland(report:(text:string)=>void) {
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  const visible=(selector:string)=>Array.from(document.querySelectorAll<HTMLElement>(selector)).find(el=>!el.closest('[inert]'));
  const click=(selector:string)=>{const el=visible(selector);if(!el)throw Error(`Missing ${selector}`);el.click();};
  const snapshot=()=>{
    const shell=document.querySelector<HTMLElement>('.isla-island-shell')!;
    const r=shell.getBoundingClientRect();
    return {phase:shell.dataset.compactPhase??'normal',width:Math.round(r.width),height:Math.round(r.height),expanded:Boolean(visible('.xp-root')),volume:Boolean(visible('[aria-label="Output volume"]')),controls:Boolean(visible('[aria-label="Playback controls"]'))};
  };
  const results:unknown[]=[];
  for(const name of ['controls','expanded','next','volume','queue','equalizer','library']) {
    if(name==='controls')click('[data-compact-orb], [data-pill-open]');
    if(name==='expanded') {
      click('[data-compact-orb], [data-pill-open]');await wait(650);
      if(visible('[data-compact-orb]'))click('[aria-label="Expand music player"]');
    }
    if(name==='next') {
      if(visible('[data-compact-orb]')){click('[data-compact-orb]');await wait(650);}
      click('[aria-label="Next track"]');
    }
    if(name==='volume')visible('[data-compact-orb], .isla-pill')?.dispatchEvent(new WheelEvent('wheel',{deltaY:-40,bubbles:true}));
    if(['queue','equalizer','library'].includes(name)) {
      click('[data-compact-orb], [data-pill-open]');await wait(650);
      if(visible('[data-compact-orb]'))click('[aria-label="Expand music player"]');
      await wait(1100);
      click(name==='queue'?'[aria-label="Up Next"]':name==='equalizer'?'[aria-label="Equalizer"]':'[aria-label="Library"]');
    }
    await wait(750);const open=snapshot();await wait(2250);const rest=snapshot();
    results.push({name,open,after3seconds:rest});report(JSON.stringify(results,null,2));
    await wait(200);
  }
  report(JSON.stringify(results,null,2)+'\nAUDIT COMPLETE');
}
