import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ExpandedPlayer} from '../src/components/ExpandedPlayer';
import {CompactOrb} from '../src/components/CompactOrb';
import {EqualizerView} from '../src/components/EqualizerView';
import {islaBridge} from '../src/services/bridge';
import {liquidCompactFrame} from '../src/utils/liquid-island';
import {eqCurvePath} from '../src/utils/equalizer';
const initial=await islaBridge.getInitialAppState();
const track={id:1,title:'Afterglow',artist:'Isla Sessions',album:'Offline, on purpose',albumArtist:'',genre:'',filePath:'demo.wav',normalizedPath:'demo.wav',trackNumber:1,year:2026,durationSecs:240,format:'WAV',bitrateKbps:null,sampleRateHz:48000,fileSizeBytes:0,artworkDataUrl:null,dominantColor:'#7962C8',isFavorite:true,playCount:4,dateAdded:0,fileMissing:false};
const player={...initial.player,currentTrack:track,queue:[track],currentQueueIndex:0,isPlaying:true,positionSecs:84,durationSecs:240,volume:.72};
const settings={...initial.settings,theme:'light' as const,reducedMotion:true,pillSize:'compact' as const};
const noop=()=>{};
export function assets(){
 const common={player,settings,accentColor:'#7962C8',isExpanded:false,onExpand:noop,onOpenPlayer:noop,onNextTrack:noop,onPreviousTrack:noop,onTogglePlayPause:noop,onWheelVolume:noop,orbX:0,controlsX:72,side:'right'};
 return {
  orb:renderToStaticMarkup(<CompactOrb {...common} controls={false}/>),
  controls:renderToStaticMarkup(<CompactOrb {...common} controls/>),
  player:renderToStaticMarkup(<ExpandedPlayer {...initial as any} player={player} settings={settings} isExpanded activeTab="queue" accentColor="#7962C8" anchorRatioX={0.5} anchorRatioY={0} outputDevices={[]} onSelectTab={noop}/>),
  mini:renderToStaticMarkup(<ExpandedPlayer {...initial as any} player={player} settings={settings} isExpanded activeTab="songs" accentColor="#7962C8" anchorRatioX={0.5} anchorRatioY={0} outputDevices={[]} onSelectTab={noop}/>),
  eq:renderToStaticMarkup(<EqualizerView settings={{...settings.equalizer,enabled:true,preset:'electronic',bandsDb:[4,3,1,0,-1,-1,0,2,3,4]}} accentColor="#A493EF" reducedMotion sampleRateHz={48000}/>),
 };
}
export {liquidCompactFrame,eqCurvePath};

