// Development-only fixture: exercises the real App without native playback or user data.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App';
import { CompactPill } from '../src/components/CompactPill';
import { islaBridge } from '../src/services/bridge';
import type { AppSettings, PlayerSnapshot, Track } from '../src/types/isla';
import type { AudioBeat } from '../src/utils/beat';
import '../src/styles/index.css';
import {auditIsland} from './motion-audit';
import {auditCollapse} from './collapse-audit';
import {auditPlayerGather} from './gather-audit';

const initial = await islaBridge.getInitialAppState();
const tracks: Track[] = ['Midnight City', 'A Moment Apart', 'Weightless', 'Something About Us'].map((title, id) => ({
  id: id + 1, title, artist: ['M83', 'ODESZA', 'Marconi Union', 'Daft Punk'][id],
  album: ['Hurry Up, We’re Dreaming', 'A Moment Apart', 'Ambient Transmissions', 'Discovery'][id],
  albumArtist: '', genre: '', filePath: `fixture-${id}.mp3`, normalizedPath: `fixture-${id}.mp3`,
  trackNumber: id + 1, year: 2020, durationSecs: 240, format: 'MP3', bitrateKbps: 320,
  sampleRateHz: 44100, fileSizeBytes: 1000, artworkDataUrl: null,
  dominantColor: ['#6B58BE', '#32677E', '#9F4D5C', '#8B641F'][id],
  isFavorite: id === 1, playCount: id === 1 ? 5 : 1, dateAdded: 0, fileMissing: false, bpm: 112,
}));
const previewTheme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
let settings: AppSettings = { ...initial.settings, theme: previewTheme, reducedMotion:new URLSearchParams(location.search).has('reduced'), pillSize:new URLSearchParams(location.search).get('size')==='compact'?'compact':new URLSearchParams(location.search).get('size')==='large'?'large':'default' };
document.documentElement.dataset.theme = previewTheme;
let player: PlayerSnapshot = { ...initial.player, currentTrack: tracks[0], queue: tracks, currentQueueIndex: 0, isPlaying: true, positionSecs: 74, durationSecs: 240 };
let playback = (_: PlayerSnapshot) => {};
let updated = (_: AppSettings) => {};
let beatHandler = (_: AudioBeat) => {};
let previewOutputs = [{ name:'Headphones (Realtek(R) Audio)',isDefault:true },{ name:'Speakers (Realtek(R) Audio)',isDefault:false }];
let outputsHandler = (_: typeof previewOutputs) => {};
islaBridge.getAudioOutputDevices = async () => previewOutputs.map((device) => ({...device}));
islaBridge.onAudioOutputsChanged = async (fn) => { outputsHandler=fn; return () => { if (outputsHandler === fn) outputsHandler=()=>{}; }; };
islaBridge.onAudioBeat = async (fn) => { beatHandler = fn; return () => { if (beatHandler === fn) beatHandler = () => {}; }; };
islaBridge.setIslandBounds = async (bounds) => {
  document.documentElement.dataset.previewBounds = JSON.stringify(bounds);
  const output = document.getElementById('preview-native-bounds');
  if (output) {
    output.dataset.bounds = JSON.stringify(bounds);
    output.textContent = `Native bounds: ${Math.round(bounds.width)}×${Math.round(bounds.height)} · r${Math.round(bounds.radius)}`;
  }
};
document.getElementById('root')!.style.cssText = 'width:508px;height:484px';
const emit = () => playback({ ...player });
islaBridge.getInitialAppState = async () => ({ ...initial, anchorOffsetX: new URLSearchParams(location.search).get('edge')==='right'?352:0, anchorOffsetY: new URLSearchParams(location.search).get('anchor') === 'bottom' ? 328 : 0, settings, player, tracks, stats: { ...initial.stats, totalTracks: 4 } });
islaBridge.getLibraryTracks = async () => tracks;
islaBridge.getPlayerSnapshot = async () => player;
islaBridge.onPlaybackState = async (fn) => { playback = fn; return () => {}; };
// Exercise React updates during a pulse just as native playback's progress IPC does.
islaBridge.onPlaybackProgress = async (fn) => {
  const timer = setInterval(() => {
    if (!player.isPlaying) return;
    player.positionSecs += 0.09;
    fn({ trackId: player.currentTrack?.id ?? null, positionSecs: player.positionSecs, isCrossfading: false, crossfadeProgress: 0, liveMixBpm: null });
  },90);
  return () => clearInterval(timer);
};
islaBridge.onSettingsUpdated = async (fn) => { updated = fn; return () => {}; };
islaBridge.togglePlayPause = async () => { player.isPlaying = !player.isPlaying; emit(); };
const advance = (direction: number) => {
  const index = ((player.currentQueueIndex ?? 0) + direction + tracks.length) % tracks.length;
  player = { ...player, outgoingTrack: player.currentTrack, currentTrack: tracks[index], currentQueueIndex: index, positionSecs: 0 }; emit();
};
islaBridge.nextTrack = async () => advance(1);
islaBridge.previousTrack = async () => advance(-1);
islaBridge.setVolume = async (v) => { player.volume = v; player.isMuted = false; emit(); };
islaBridge.setShuffle = async (shuffle) => { player.shuffle = shuffle; emit(); };
islaBridge.setRepeatMode = async (repeatMode) => { player.repeatMode = repeatMode; emit(); };
islaBridge.seekPlayback = async (v) => { player.positionSecs = v; emit(); };
islaBridge.playQueueIndex = async (index) => { player = { ...player, outgoingTrack: player.currentTrack, currentTrack: player.queue[index], currentQueueIndex: index, positionSecs: 0, isPlaying: true }; emit(); };
islaBridge.toggleFavorite = async (id) => { const track = tracks.find((t) => t.id === id)!; track.isFavorite = !track.isFavorite; player = { ...player, currentTrack: player.currentTrack?.id === id ? { ...track } : player.currentTrack }; emit(); return track; };
islaBridge.updateSettings = async (next) => { settings = next; updated(next); return next; };
islaBridge.previewEqualizer = async () => {};
islaBridge.saveEqualizer = async (equalizer) => { settings = { ...settings, equalizer }; updated(settings); return settings; };

const noop = () => {};
function BeatPreviewControls() {
  const [audit,setAudit]=React.useState('');
  const [running,setRunning] = React.useState(false);
  const [headphones,setHeadphones] = React.useState(true);
  React.useEffect(() => {
    if (!running) return;
    const emitBeat = () => { if (player.isPlaying && !player.isMuted) beatHandler({ trackId: player.currentTrack?.id ?? null,strength: 0.9 }); };
    emitBeat();
    const timer = setInterval(emitBeat,480);
    return () => clearInterval(timer);
  },[running]);
  return <div style={{ position:'fixed',right:16,top:16,display:new URLSearchParams(location.search).has('proof')?'none':'grid',gap:8,fontSize:12 }}>
    <button type="button" onClick={()=>{setAudit('RUNNING');void auditIsland(setAudit).catch(e=>setAudit(String(e)));}}>Run motion audit</button>
    <button type="button" onClick={()=>{setAudit('RUNNING');void auditCollapse(setAudit).catch(e=>setAudit(String(e)));}}>Run reversal audit</button>
    <button type="button" onClick={()=>{setAudit('RUNNING');void auditPlayerGather(setAudit).catch(e=>setAudit(String(e)));}}>Run player gather audit</button>
    {audit&&<pre id="motion-audit" style={{maxHeight:420,overflow:'auto',fontSize:10}}>{audit}</pre>}
    <button type="button" onClick={()=>document.querySelector('[data-compact-orb]')?.dispatchEvent(new WheelEvent('wheel',{deltaY:-40,bubbles:true}))}>Test volume wheel</button>
    <button type="button" onClick={() => beatHandler({ trackId: player.currentTrack?.id ?? null,strength: 1 })}>Test beat onset</button>
    <button type="button" onClick={() => setRunning(!running)}>{running ? 'Stop beat loop' : 'Start beat loop'}</button>
    <button type="button" onClick={() => {
      const connected = !headphones; setHeadphones(connected);
      previewOutputs = connected ? [{ name:'Headphones (Realtek(R) Audio)',isDefault:true },{ name:'Speakers (Realtek(R) Audio)',isDefault:false }] : [{name:'Speakers (Realtek(R) Audio)',isDefault:true}];
      outputsHandler(previewOutputs);
    }}>{headphones ? 'Disconnect headphones' : 'Reconnect headphones'}</button>
    <output id="preview-native-bounds" />
  </div>;
}
const handoffPreview = new URLSearchParams(location.search).get('activity') === 'handoff';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{handoffPreview ?
  <div style={{ position: 'relative', margin: 24, width: 372, height: 140, borderRadius: 40 }} className="isla-glass-island">
    <CompactPill player={{ ...player, currentTrack: tracks[1] }} previousTrack={tracks[0]} settings={settings} accentColor="#32677E" isExpanded={false} pillHeight={58} expandUpward={false} transitionKind="loved" transitionDirection="next" isVolumeMorph={false} maxPlayCount={5} onExpand={noop} onTogglePlayPause={noop} onNextTrack={noop} onPreviousTrack={noop} onToggleFavorite={noop} onWheelVolume={noop} onDismissTransition={noop} />
  </div> : <><App /><BeatPreviewControls /></>}</React.StrictMode>);
