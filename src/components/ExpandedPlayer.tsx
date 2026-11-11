import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from 'motion/react';
import {playerGather} from '../utils/player-gather';
import { ChevronDown, ChevronUp, Heart, ListMusic, Music, Disc, Mic2, Sparkles, Settings as SettingsIcon, Shuffle, Repeat, Repeat1, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X, ArrowRightLeft, SlidersHorizontal } from 'lucide-react';
import type { ActiveTab, AlbumSummary, AppSettings, ArtistSummary, AudioDeviceInfo, LibraryFolder, LibraryStats, PlayerSnapshot, Playlist, ScanProgressPayload, Track } from '../types/isla';
import { ArtworkTile } from './ArtworkTile';
import { LibraryViews } from './LibraryViews';
import { SettingsView } from './SettingsView';
import { EqualizerView } from './EqualizerView';
import { formatDuration, formatRemainingTime, hexToRgba } from '../utils/format';
import { getUpcomingQueue } from '../utils/interaction';
import { contentSpring, transportSpring, islandContents } from '../utils/motion';
import { islaBridge } from '../services/bridge';

export interface ExpandedPlayerProps {
  gatherGeometry?: {width:MotionValue<number>};
  onPanelHeightChange?: (height: number) => void;
  player: PlayerSnapshot;
  settings: AppSettings;
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: Playlist[];
  folders: LibraryFolder[];
  stats: LibraryStats;
  outputDevices: AudioDeviceInfo[];
  onRefreshOutputDevices?: () => void;
  refreshingOutputDevices?: boolean;
  outputDeviceError?: string|null;
  activeTab: ActiveTab;
  accentColor: string;
  isExpanded: boolean;
  anchorRatioX: number;
  anchorRatioY: number;
  scanProgress: ScanProgressPayload | null;
  statusBanner: string | null;
  onSelectTab: (tab: ActiveTab) => void;
  onCollapse: () => void;
  onTogglePlayPause: () => void;
  onNextTrack: () => void;
  onPreviousTrack: () => void;
  onSeek: (secs: number) => void;
  onSetVolume: (vol: number) => void;
  onToggleMute: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onCycleCrossfade: () => void;
  onPlayTrackFromList: (trackId: number, listTrackIds: number[]) => void;
  onPlayQueueIndex: (index: number) => void;
  onPlayNext: (trackId: number) => void;
  onAddToQueue: (trackId: number) => void;
  onRemoveFromQueue: (index: number) => void;
  onReorderQueue: (fromIndex: number, toIndex: number) => void;
  onClearQueue: () => void;
  onToggleFavorite: (trackId: number) => void;
  onCreatePlaylist: (name: string, initialTrackId?: number) => Promise<void>;
  onRenamePlaylist: (playlistId: number, name: string) => Promise<void>;
  onDeletePlaylist: (playlistId: number) => Promise<void>;
  onAddTrackToPlaylist: (playlistId: number, trackId: number) => Promise<void>;
  onAddMusicFolder: () => void;
  onImportAudioFiles: () => void;
  onRescanLibrary: () => void;
  onRemoveFolder: (folderId: number, removeTracks: boolean) => void;
  onCleanMissingTracks: () => void;
  onUpdateSettings: (next: AppSettings) => Promise<void>;
  onMinimizeToTray: () => void;
  onQuitApplication: () => void;
}

function DrawerRegion({ children, upward, reduced, label }: { children: React.ReactNode; upward: boolean; reduced: boolean; label: string }) {
  const present = useIsPresent();
  return <motion.section id="isla-player-drawer" inert={!present} aria-hidden={!present} className={'xp-drawer ' + (upward ? 'opens-up' : '')} aria-label={label}
    initial={reduced ? { opacity: 0 } : { opacity: 0, y: upward ? 12 : -12, scale:0.97 }} animate={{ opacity: 1, y: 0, scale:1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={reduced ? { duration: 0.1 } : contentSpring}>{children}</motion.section>;
}

function VolumePopover({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  const present = useIsPresent();
  return <motion.div inert={!present} aria-hidden={!present} className="xp-volume-popover isla-glass-panel" initial={reduced ? { opacity: 0 } : { opacity: 0, y: 5, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={reduced ? { duration: 0.1 } : contentSpring}>{children}</motion.div>;
}

type Drawer = 'closed' | 'queue' | 'library' | 'equalizer';
const NAV_ITEMS = [
  { id: 'songs', label: 'Songs', icon: Music }, { id: 'albums', label: 'Albums', icon: Disc },
  { id: 'artists', label: 'Artists', icon: Mic2 }, { id: 'playlists', label: 'Playlists', icon: Sparkles },
  { id: 'favorites', label: 'Favorites', icon: Heart }, { id: 'settings', label: 'Settings', icon: SettingsIcon },
] as const;

export const ExpandedPlayer: React.FC<ExpandedPlayerProps> = (props) => {
  const { player, settings, accentColor, isExpanded, activeTab, onSelectTab } = props;
  const [drawer, setDrawer] = useState<Drawer>(activeTab === 'queue' ? 'closed' : 'library');
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const queueTrigger = useRef<HTMLButtonElement>(null);
  const libraryTrigger = useRef<HTMLButtonElement>(null);
  const equalizerTrigger = useRef<HTMLButtonElement>(null);
  const volumeWrap = useRef<HTMLDivElement>(null);
  const progressBar = useRef<HTMLDivElement>(null);
  const track = player.currentTrack;
  const reduced = settings.reducedMotion;
  const upward = props.anchorRatioY > 0.5;
  const queueOpen = drawer === 'queue';
  const libraryOpen = drawer === 'library';
  const equalizerOpen = drawer === 'equalizer';
  const miniMode = libraryOpen || equalizerOpen;
  const drawerOpen = drawer !== 'closed';
  const canvasHeight=useRef(268);
  if(isExpanded)canvasHeight.current=drawerOpen?388:268;
  const fallbackWidth=useMotionValue(60);
  const liveWidth=props.gatherGeometry?.width??fallbackWidth;
  const exposure=useMotionValue(0);
  useLayoutEffect(()=>{if(isExpanded)exposure.set(1);},[isExpanded,exposure]);
  const gather=useTransform(()=>playerGather(liveWidth.get(),canvasHeight.current));
  const gatherX=useTransform(gather,g=>g.x);
  const gatherY=useTransform(gather,g=>g.y);
  const gatherScale=useTransform(gather,g=>g.scale);
  const gatherOpacity=useTransform(()=>gather.get().opacity*exposure.get());
  const resetClosed=()=>{setDrawer('closed');setVolumeOpen(false);onSelectTab('queue');};
  useMotionValueEvent(liveWidth,'change',width=>{
    if(props.gatherGeometry&&!isExpanded&&width<=60.2&&exposure.get()!==0){exposure.set(0);resetClosed();}
  });
  const duration = player.durationSecs || track?.durationSecs || 0;
  const position = scrubValue ?? player.positionSecs;
  const progress = duration > 0 ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  const volume = player.isMuted ? 0 : Math.round(player.volume * 100);
  const upcoming = useMemo(() => getUpcomingQueue(player), [player.queue, player.currentQueueIndex, player.shuffle, player.repeatMode]);
  const spring = reduced ? { duration: 0.1 } : contentSpring;
  const status = player.lastError || props.statusBanner || (props.scanProgress && !props.scanProgress.done ? 'Indexing your music… ' + props.scanProgress.scannedFiles + '/' + props.scanProgress.totalFiles : null);

  useEffect(() => { props.onPanelHeightChange?.(drawerOpen ? 388 : 268); }, [drawerOpen, props.onPanelHeightChange]);
  useEffect(() => {
    if (!isExpanded&&!props.gatherGeometry) resetClosed();
    // A close can beat the first expansion frame, leaving width already at rest.
    if(!isExpanded&&props.gatherGeometry&&liveWidth.get()<=60.2){exposure.set(0);resetClosed();}
  }, [isExpanded, onSelectTab,Boolean(props.gatherGeometry)]);
  useEffect(() => { if (isExpanded && activeTab !== 'queue') setDrawer('library'); }, [activeTab, isExpanded]);
  useEffect(() => { setScrubValue(null); }, [track?.id]);
  useEffect(() => {
    if (!volumeOpen) return;
    const outside = (e: PointerEvent) => { if (!volumeWrap.current?.contains(e.target as Node)) setVolumeOpen(false); };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [volumeOpen]);

  const closeDrawer = () => {
    const previous = drawer;
    setDrawer('closed'); onSelectTab('queue');
    requestAnimationFrame(() => (previous === 'queue' ? queueTrigger : previous === 'equalizer' ? equalizerTrigger : libraryTrigger).current?.focus({ preventScroll: true }));
  };
  const openQueue = () => { setVolumeOpen(false); onSelectTab('queue'); setDrawer(queueOpen ? 'closed' : 'queue'); };
  const openLibrary = () => {
    if (libraryOpen) { closeDrawer(); return; }
    setVolumeOpen(false); setDrawer('library');
    if (activeTab === 'queue') onSelectTab('songs');
  };
  const openEqualizer = () => { setVolumeOpen(false); onSelectTab('queue'); setDrawer(equalizerOpen ? 'closed' : 'equalizer'); };
  const seekFromPointer = (x: number) => {
    const rect = progressBar.current?.getBoundingClientRect();
    return rect && duration > 0 ? Math.min(1, Math.max(0, (x - rect.left) / rect.width)) * duration : 0;
  };
  const primaryPlay = (mini = false) => (
    <motion.button type="button" data-expanded-play className={mini ? 'xp-play xp-play-mini' : 'xp-play'}
      aria-label={player.isPlaying ? 'Pause' : 'Play'} style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
      whileHover={reduced ? undefined : { scale: 1.045 }} whileTap={reduced ? undefined : { scale: 0.92 }}
      transition={transportSpring} onClick={() => track || player.queue.length ? props.onTogglePlayPause() : openLibrary()}>
      <AnimatePresence initial={false} mode="popLayout"><motion.span key={player.isPlaying ? 'pause' : 'play'}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : 0.8 }} transition={{ duration: 0.14 }}>
        {player.isPlaying ? <Pause size={mini ? 18 : 25} fill="currentColor" strokeWidth={0} /> : <Play size={mini ? 18 : 25} fill="currentColor" strokeWidth={0} className="ml-0.5" />}
      </motion.span></AnimatePresence>
    </motion.button>
  );

  return (
    <motion.div className="xp-root" inert={!isExpanded} aria-hidden={!isExpanded}
      style={{ pointerEvents: isExpanded ? 'auto' : 'none', flexDirection: upward ? 'column-reverse' : 'column', ...(props.gatherGeometry?{height:canvasHeight.current,transformOrigin:'center center',x:gatherX,y:gatherY,scale:reduced?1:gatherScale,opacity:gatherOpacity}:{transformOrigin:`${props.anchorRatioX*100}% ${upward?100:0}%`}) }}
      initial={false} animate={props.gatherGeometry?undefined:{ opacity: isExpanded ? 1 : 0, scale:reduced||isExpanded?1:0.9, x:reduced||isExpanded?0:(props.anchorRatioX-0.5)*16, y: reduced || isExpanded ? 0 : upward ? 8 : -8 }}
      transition={reduced?{duration:0.1}:{...spring,opacity:{duration:isExpanded?0.18:0.09,delay:isExpanded?0.065:0}}}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        if (volumeOpen) { e.preventDefault(); e.stopPropagation(); setVolumeOpen(false); volumeWrap.current?.querySelector('button')?.focus(); }
        else if (drawerOpen) { e.preventDefault(); e.stopPropagation(); closeDrawer(); }
      }}>
      <motion.section className={['xp-player', queueOpen ? 'is-condensed' : '', miniMode ? 'is-library' : ''].join(' ')}
        initial={false} animate={{ height: miniMode ? 88 : queueOpen ? 232 : 268 }} transition={spring}
        aria-label="Now Playing" onPointerDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button,input,[role=slider]')) void islaBridge.startWindowDragging();
        }}>
        <motion.div className="xp-heading" {...islandContents(Boolean(props.gatherGeometry)||isExpanded,reduced,0,upward)}>
          <span className="xp-eyebrow">Now playing</span>
          <div className="flex items-center gap-2">
            {!miniMode && <button className="xp-mix" type="button" onClick={props.onCycleCrossfade} aria-label="Cycle Automix Crossfade" title="Change crossfade duration"><ArrowRightLeft size={11} />{settings.crossfadeEnabled !== false ? 'Mix ' + Math.round(settings.crossfadeSecs ?? 6) + 's' : 'Mix off'}</button>}
            <button ref={equalizerTrigger} type="button" className={'xp-eq-trigger ' + (equalizerOpen ? 'is-open' : '')} aria-label="Equalizer" aria-expanded={equalizerOpen} aria-controls="isla-player-drawer" onClick={openEqualizer} style={{ color: equalizerOpen || settings.equalizer?.enabled ? accentColor : undefined }}><SlidersHorizontal size={12} /><span>EQ</span></button>
            <button className="xp-icon xp-collapse" type="button" onClick={props.onCollapse} aria-label="Collapse to floating pill" title="Collapse (Esc)">{upward ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
          </div>
        </motion.div>
        {miniMode ? (
          <motion.div className="xp-mini" {...islandContents(Boolean(props.gatherGeometry)||isExpanded,reduced,1,upward)}>
            <ArtworkTile title={track?.title ?? 'Isla'} artworkDataUrl={track?.artworkDataUrl} dominantColor={track?.dominantColor ?? accentColor} sizeClass="w-10 h-10" roundedClass="rounded-[12px]" />
            <button className="xp-mini-info" onClick={closeDrawer} aria-label="Return to Now Playing"><strong>{track?.title ?? 'Your music, within reach'}</strong><span>{track?.artist ?? 'Choose a song from your library'}</span></button>
            {primaryPlay(true)}
            <button className="xp-icon" type="button" aria-label="Next Track" onClick={props.onNextTrack}><SkipForward size={18} fill="currentColor" /></button>
          </motion.div>
        ) : <>
          <motion.div className="xp-hero" layout="position" {...islandContents(Boolean(props.gatherGeometry)||isExpanded,reduced,1,upward)}>
            <div className="xp-cover">
              <AnimatePresence mode="popLayout" initial={false}><motion.div key={track?.id ?? 'empty'} initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 5 }} animate={{ opacity: 1, scale: 1, y: 0, width: queueOpen ? 56 : 76, height: queueOpen ? 56 : 76 }} exit={{ opacity: 0, scale: reduced ? 1 : 0.92 }} transition={spring}>
                <ArtworkTile title={track?.title ?? 'Isla'} artworkDataUrl={track?.artworkDataUrl} dominantColor={track?.dominantColor ?? accentColor} sizeClass="w-full h-full" roundedClass="rounded-[20px]" iconSize={queueOpen ? 24 : 30} />
              </motion.div></AnimatePresence>
            </div>
            <div className="xp-metadata"><h2 className="xp-title" title={track?.title}>{track?.title ?? 'Your music, within reach'}</h2><p className="xp-artist">{track?.artist ?? 'Open your library to start listening'}</p>{track?.album && <p className="xp-album">{track.album}</p>}</div>
            <motion.button className="xp-icon xp-favorite" type="button" aria-label={track?.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'} aria-pressed={Boolean(track?.isFavorite)} disabled={!track} onClick={() => track && props.onToggleFavorite(track.id)} whileTap={reduced ? undefined : { scale: 0.8 }}><Heart size={17} fill={track?.isFavorite ? 'currentColor' : 'none'} style={{ color: track?.isFavorite ? 'var(--isla-activity-loved)' : undefined }} /></motion.button>
          </motion.div>
          <motion.div className="xp-progress" {...islandContents(Boolean(props.gatherGeometry)||isExpanded,reduced,2,upward)}>
            <div ref={progressBar} className="xp-scrubber" role="slider" aria-label="Playback Progress" tabIndex={track ? 0 : -1} aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(position)} aria-valuetext={formatDuration(position) + ' of ' + formatDuration(duration)}
              onPointerDown={(e) => { if (e.button !== 0 || !track || !duration) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setScrubValue(seekFromPointer(e.clientX)); }}
              onPointerMove={(e) => { if (scrubValue !== null) setScrubValue(seekFromPointer(e.clientX)); }}
              onPointerUp={(e) => { if (scrubValue === null) return; const value = seekFromPointer(e.clientX); setScrubValue(null); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); props.onSeek(value); }}
              onPointerCancel={() => setScrubValue(null)}
              onKeyDown={(e) => { if (!track || !duration) return; const next = e.key === 'ArrowRight' ? Math.min(duration, position + 5) : e.key === 'ArrowLeft' ? Math.max(0, position - 5) : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null; if (next !== null) { e.preventDefault(); props.onSeek(next); } }}>
              <div className="xp-progress-track"><motion.div initial={false} animate={{ scaleX: progress / 100 }} transition={{ duration: reduced || scrubValue !== null ? 0 : 0.16, ease: 'linear' }} style={{ backgroundColor: accentColor }} /></div><span className="xp-progress-thumb" style={{ left: progress + '%', backgroundColor: accentColor }} />
            </div>
            <div className="xp-timestamps isla-tabular"><span>{formatDuration(position)}</span>{player.isCrossfading && <span style={{ color: accentColor }}>{Math.round(player.liveMixBpm ?? track?.bpm ?? 0) || ''} BPM · Mixing</span>}<span>{formatRemainingTime(position, duration)}</span></div>
          </motion.div>
          <motion.div className="xp-transport" {...islandContents(Boolean(props.gatherGeometry)||isExpanded,reduced,3,upward)}>
            <button className="xp-icon xp-secondary" aria-label="Toggle Shuffle" aria-pressed={player.shuffle} title="Shuffle" style={{ color: player.shuffle ? accentColor : undefined }} onClick={props.onToggleShuffle}><Shuffle size={17} /></button>
            <motion.button className="xp-icon xp-skip" aria-label="Previous Track" onClick={props.onPreviousTrack} whileTap={reduced ? undefined : { scale: 0.87 }}><SkipBack size={22} fill="currentColor" /></motion.button>
            {primaryPlay()}
            <motion.button className="xp-icon xp-skip" aria-label="Next Track" onClick={props.onNextTrack} whileTap={reduced ? undefined : { scale: 0.87 }}><SkipForward size={22} fill="currentColor" /></motion.button>
            <button className="xp-icon xp-secondary" aria-label="Cycle Repeat Mode" title={'Repeat: ' + player.repeatMode} style={{ color: player.repeatMode !== 'off' ? accentColor : undefined }} onClick={props.onCycleRepeat}>{player.repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}</button>
          </motion.div>
          <motion.div className="xp-footer" {...islandContents(Boolean(props.gatherGeometry)||isExpanded,reduced,4,upward)}>
            <button ref={queueTrigger} className={'xp-footer-action ' + (queueOpen ? 'is-active' : '')} onClick={openQueue} aria-label="Up Next" aria-controls="isla-player-drawer" aria-expanded={queueOpen} style={{ color: queueOpen ? accentColor : undefined }}><ListMusic size={15} /><span>Up Next</span>{upcoming.length > 0 && <span className="xp-count isla-tabular">{upcoming.length}</span>}</button>
            <div className="xp-volume-wrap" ref={volumeWrap} onWheel={(e) => { if (e.deltaY) props.onSetVolume(Math.min(1, Math.max(0, player.volume + (e.deltaY < 0 ? 0.03 : -0.03)))); }}>
              <button className="xp-volume" onClick={() => setVolumeOpen(!volumeOpen)} onDoubleClick={props.onToggleMute} aria-label="Volume Control" aria-expanded={volumeOpen}>{player.isMuted || !volume ? <VolumeX size={14} /> : <Volume2 size={14} />}<span className="isla-tabular">{volume}%</span></button>
              <AnimatePresence>{volumeOpen && <VolumePopover reduced={reduced}><button className="xp-icon" aria-label={player.isMuted ? 'Unmute' : 'Mute'} onClick={props.onToggleMute}>{player.isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button><input type="range" aria-label="Volume Slider" min={0} max={100} value={volume} onChange={(e) => props.onSetVolume(Number(e.target.value) / 100)} style={{ accentColor }} /></VolumePopover>}</AnimatePresence>
            </div>
            <button ref={libraryTrigger} className="xp-footer-action xp-library-trigger" aria-label="Library" onClick={openLibrary} aria-expanded={libraryOpen} aria-controls="isla-player-drawer"><Music size={14} /><span>Library</span></button>
          </motion.div>
        </>}
        {status && <div className="xp-status" role="status" style={{ borderColor: hexToRgba(accentColor, 0.2) }}>{status}</div>}
      </motion.section>
      <AnimatePresence initial={false}>
        {drawerOpen && <DrawerRegion key="player-drawer" upward={upward} reduced={reduced} label={queueOpen ? 'Up Next queue' : equalizerOpen ? 'Equalizer' : 'Music library'}>
          <div className="xp-drawer-heading"><h3>{queueOpen ? player.shuffle ? 'Queue · Shuffle' : 'Up Next' : equalizerOpen ? 'Equalizer' : 'Your library'}</h3>{queueOpen && <span className="xp-drawer-count">{upcoming.length} {upcoming.length === 1 ? 'song' : 'songs'}</span>}<button className="xp-icon" onClick={closeDrawer} aria-label="Close drawer"><X size={14} /></button></div>
          {libraryOpen && <nav className="xp-library-nav no-scrollbar" aria-label="Music library">{NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => onSelectTab(id)} aria-current={activeTab === id ? 'page' : undefined} style={{ color: activeTab === id ? accentColor : undefined }}><Icon size={14} /><span>{label}</span>{activeTab === id && <motion.span layoutId="isla-library-selection" className="xp-tab-selection" style={{ backgroundColor: hexToRgba(accentColor, 0.09) }} transition={transportSpring} />}</button>)}</nav>}
          <div className="xp-drawer-scroll isla-scroll">
            {equalizerOpen ? <EqualizerView settings={settings.equalizer} accentColor={accentColor} reducedMotion={reduced} sampleRateHz={track?.sampleRateHz ?? 48000} /> : <>
            {libraryOpen && activeTab === 'settings' ? <SettingsView onRefreshOutputDevices={props.onRefreshOutputDevices} refreshingOutputDevices={props.refreshingOutputDevices} outputDeviceError={props.outputDeviceError} settings={settings} folders={props.folders} stats={props.stats} outputDevices={props.outputDevices} accentColor={accentColor} isScanning={Boolean(props.scanProgress && !props.scanProgress.done)} onUpdateSettings={props.onUpdateSettings} onAddMusicFolder={props.onAddMusicFolder} onImportAudioFiles={props.onImportAudioFiles} onRescanLibrary={props.onRescanLibrary} onRemoveFolder={props.onRemoveFolder} onCleanMissingTracks={props.onCleanMissingTracks} onMinimizeToTray={props.onMinimizeToTray} onQuitApplication={props.onQuitApplication} /> :
              <LibraryViews activeTab={queueOpen ? 'queue' : activeTab === 'queue' ? 'songs' : activeTab} tracks={props.tracks} albums={props.albums} artists={props.artists} playlists={props.playlists} player={player} reducedMotion={reduced} accentColor={accentColor} isScanning={Boolean(props.scanProgress && !props.scanProgress.done)} onAddMusicFolder={props.onAddMusicFolder} onImportAudioFiles={props.onImportAudioFiles} onPlayTrackFromList={props.onPlayTrackFromList} onPlayQueueIndex={props.onPlayQueueIndex} onPlayNext={props.onPlayNext} onAddToQueue={props.onAddToQueue} onRemoveFromQueue={props.onRemoveFromQueue} onReorderQueue={props.onReorderQueue} onClearQueue={props.onClearQueue} onToggleFavorite={props.onToggleFavorite} onCreatePlaylist={props.onCreatePlaylist} onRenamePlaylist={props.onRenamePlaylist} onDeletePlaylist={props.onDeletePlaylist} onAddTrackToPlaylist={props.onAddTrackToPlaylist} />}
            </>}
          </div>
        </DrawerRegion>}
      </AnimatePresence>
    </motion.div>
  );
};



