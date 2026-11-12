// Headless production-component regression. Never connects to a user's browser
// or desktop, and never reads the music library or starts audio output.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from 'playwright';

await mkdir('.codex-backups',{recursive:true});
await writeFile('.codex-backups/input-contract.html',`<!doctype html><div id="root"></div>
<script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from '/src/App.tsx';
import {islaBridge} from '/src/services/bridge.ts';
import '/src/styles/index.css';
const init=await islaBridge.getInitialAppState();
init.settings={...init.settings,pillSize:'compact',beatPulse:true,theme:new URL(location.href).searchParams.get('theme')||'light'};
const bottom=new URL(location.href).searchParams.get('anchor')==='bottom-right';
init.anchorOffsetX=bottom?352:0;init.anchorOffsetY=bottom?328:0;
const track={id:1,title:'Input contract fixture',artist:'Isla test',album:'Fixture',albumArtist:'',genre:'',filePath:'fixture.mp3',normalizedPath:'fixture.mp3',trackNumber:null,year:null,durationSecs:180,format:'MP3',bitrateKbps:null,sampleRateHz:null,fileSizeBytes:0,artworkDataUrl:null,dominantColor:'#7560ff',isFavorite:false,dateAdded:0,fileMissing:false};
init.player={...init.player,currentTrack:track,queue:[track],isPlaying:true,volume:0.5,positionSecs:40,durationSecs:180};
islaBridge.getInitialAppState=async()=>init;
window.hitPackets=[];window.beatListeners=new Set();
window.dragRequests=0;islaBridge.startWindowDragging=async()=>{window.dragRequests++;};
islaBridge.setIslandBounds=async(bounds,regions,expanded)=>{window.hitPackets.push({bounds,regions,expanded});};
islaBridge.onAudioBeat=async fn=>{window.beatListeners.add(fn);return()=>window.beatListeners.delete(fn);};
window.pulseTimer=setInterval(()=>{for(const fn of window.beatListeners)fn({trackId:1,strength:1});},180);
createRoot(document.getElementById('root')).render(React.createElement(App));
</script>`);

const server=await createServer({server:{host:'127.0.0.1',port:1431,strictPort:true},clearScreen:false});
let browser;
const results=[];
try {
  await server.listen();
  browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER_CHANNEL||'chrome'});
  for(const theme of ['light','dark']) for(const anchor of ['top-left','bottom-right']) {
    const page=await browser.newPage({viewport:{width:508,height:484},deviceScaleFactor:1.25});
    page.setDefaultTimeout(5000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:1431/.codex-backups/input-contract.html?theme='+theme+'&anchor='+anchor);
    const orb=page.locator('[data-compact-orb]');
    await orb.waitFor();await page.waitForTimeout(1000);
    const packet=()=>page.evaluate(()=>window.hitPackets.at(-1));
    const assertRest=async label=>{
      const p=await packet();
      assert.equal(p.expanded,false,label);
      assert.equal(p.regions.length,1,label+': only artwork may capture input');
      assert(p.regions[0].width<=81&&p.regions[0].height<=81,label+': former expanded footprint remains');
      results.push({theme,anchor,label,packet:p});
    };
    await assertRest('initial artwork with pulse');
    // Pulse intentionally never becomes geometrically stable; click its live
    // center rather than waiting for Playwright's animation-stability heuristic.
    await orb.click({force:true});await page.waitForTimeout(550);
    assert.equal((await packet()).regions.length,2,'split artwork and transport');
    await page.getByRole('button',{name:'Expand music player',exact:true}).click({force:true});
    await page.waitForTimeout(650);
    assert.equal((await packet()).expanded,true,'expanded player');
    await page.getByRole('button',{name:'Collapse to floating pill',exact:true}).click({force:true});
    await page.waitForTimeout(1100);
    await assertRest('expanded player collapses to artwork with pulse');
    const box=await orb.boundingBox();
    assert(box,'artwork must remain mounted after collapse');
    const center={x:box.x+box.width/2,y:box.y+box.height/2};
    assert(await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('[data-compact-orb]')),center),'collapsed artwork is covered by another DOM layer');
    const beforeDrag=await page.evaluate(()=>window.dragRequests);
    await page.mouse.move(center.x,center.y);await page.mouse.down();
    await page.mouse.move(center.x+24,center.y-12,{steps:6});await page.mouse.up();
    assert.equal(await page.evaluate(()=>window.dragRequests),beforeDrag+1,'collapse must preserve the artwork native-drag request');
    await page.waitForTimeout(150);
    assert.equal(await orb.getAttribute('aria-label'),'Show playback controls','drag must not trigger an artwork click');
    for(let i=0;i<8;i++){await orb.dispatchEvent('click');await page.waitForTimeout(65);}
    await page.waitForTimeout(1100);
    if(await orb.getAttribute('aria-label')==='Hide playback controls'){await orb.click({force:true});await page.waitForTimeout(1000);}
    await assertRest('rapid split and merge reversals');
    await orb.click({button:'right',force:true});await page.waitForTimeout(300);
    const menu=await packet();
    assert(menu.regions.some(r=>r.width>=200),'menu must have its own input region');
    assert(menu.regions.every(r=>r.width<300),'menu backdrop must not capture canvas');
    await page.keyboard.press('Escape');await page.waitForTimeout(600);
    await assertRest('context menu exit releases the backdrop');
    await page.evaluate(()=>clearInterval(window.pulseTimer));await page.waitForTimeout(1100);
    const before=await page.evaluate(()=>window.hitPackets.length);
    await page.waitForTimeout(550);
    const after=await page.evaluate(()=>window.hitPackets.length);
    assert(after-before>=2,'settled geometry input lease must renew without music events');
    assert.deepEqual(errors,[],theme+' browser runtime errors');
    await page.close();
  }
  await writeFile('.codex-backups/input-routing-results.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify({passed:true,themes:2,anchors:2,collapseCases:results.length,headless:true,userDesktopControlled:false},null,2));
} finally {
  await browser?.close();await server.close();
}
