import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useMotionValue, useMotionTemplate, useMotionValueEvent, useReducedMotion } from 'motion/react';
import type {
  ActiveTab,
  AlbumSummary,
  AppSettings,
  ArtistSummary,
  LibraryFolder,
  LibraryStats,
  PlayerSnapshot,
  Playlist,
  RepeatMode,
  ScanProgressPayload,
  Track,
} from './types/isla';
import { islaBridge } from './services/bridge';
import { AppContextMenu } from './components/AppContextMenu';
import { CompactPill, type PillTransitionKind } from './components/CompactPill';
import { CompactOrb } from './components/CompactOrb';
import { CompactVolume } from './components/CompactVolume';
import {compactFlowReducer,initialCompactFlow} from './utils/compact-flow';
import { ExpandedPlayer } from './components/ExpandedPlayer';
import { hexToRgba } from './utils/format';
import { applyPlaybackProgress, getIslandGeometry, getCompactLayout, compactActivation, getReadableAccent, shouldHandlePlaybackKey } from './utils/interaction';
import { islandTransition } from './utils/motion';
import { normalizeEqualizer } from './utils/equalizer';
import { canPulsePill } from './utils/beat';
import { useBeatPulse } from './hooks/useBeatPulse';
import { useAudioOutputs } from './hooks/useAudioOutputs';
import { createIdleCollapse } from './utils/idle-collapse';

const INITIAL_SETTINGS: AppSettings = {
  equalizer: normalizeEqualizer(),
  theme: 'light',
  glassIntensity: 'balanced',
  accentColor: '#5B7CFA',
  dynamicArtworkAccent: true,
  reducedMotion: false,
  alwaysOnTop: true,
  pillSize: 'default',
  startExpanded: false,
  rememberPosition: true,
  collapseOnBlur: false,
  showPillWaveform: true,
  beatPulse: true,
  outputDevice: '',
  defaultVolume: 0.72,
  defaultShuffle: false,
  defaultRepeat: 'off',
  crossfadeEnabled: true,
  crossfadeSecs: 6.0,
  launchAtStartup: false,
  minimizeToTray: true,
  globalShortcutsEnabled: true,
  windowX: 96,
  windowY: 72,
};

const INITIAL_PLAYER: PlayerSnapshot = {
  isPlaying: false,
  currentTrack: null,
  outgoingTrack: null,
  positionSecs: 0,
  durationSecs: 0,
  volume: 0.72,
  isMuted: false,
  shuffle: false,
  repeatMode: 'off',
  crossfadeEnabled: true,
  crossfadeSecs: 6.0,
  isCrossfading: false,
  crossfadeProgress: 0,
  queue: [],
  currentQueueIndex: null,
  outputDevice: null,
  lastError: null,
};

const INITIAL_STATS: LibraryStats = {
  totalTracks: 0,
  totalAlbums: 0,
  totalArtists: 0,
  totalPlaylists: 0,
  totalFavorites: 0,
  totalDurationSecs: 0,
  totalSizeBytes: 0,
  missingTracks: 0,
  folderCount: 0,
};

export const App: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const [compactFlow,dispatchCompact] = useReducer(compactFlowReducer,initialCompactFlow);
  const compactControls=compactFlow.phase==='controls';
  const setCompactControls=useCallback((open:boolean)=>dispatchCompact({type:open?'reveal':'reset'}),[]);
  const [expandedPanelHeight, setExpandedPanelHeight] = useState(268);
  const [anchorOffset, setAnchorOffset] = useState<{ x: number; y: number }>({
    x: 76,
    y: 0,
  });
  const [isDraggingWindow, setIsDraggingWindow] = useState(false);
  const [isPillPressed, setIsPillPressed] = useState(false);
  const [isTransportHovered, setIsTransportHovered] = useState(false);
  const [isShellMorphing,setIsShellMorphing] = useState(false);
  const [isMorphingGlow, setIsMorphingGlow] = useState(false);
  const [transitionKind, setTransitionKind] =
    useState<PillTransitionKind>('none');
  const [transitionDirection, setTransitionDirection] = useState<
    'next' | 'prev' | 'play'
  >('next');
  const [isVolumeMorph, setIsVolumeMorph] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
    null
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>('queue');
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  useEffect(() => { setCompactControls(false); },[settings.pillSize,expanded]);
  const [isDarkTheme, setIsDarkTheme] = useState(false);
  const systemReducedMotion = useReducedMotion();
  const reduceMotion = settings.reducedMotion || Boolean(systemReducedMotion);
  const motionSettings = useMemo(() => ({ ...settings, reducedMotion: reduceMotion }), [settings, reduceMotion]);
  useEffect(() => { document.documentElement.dataset.reducedMotion = String(reduceMotion); }, [reduceMotion]);
  const shellRef = useRef<HTMLDivElement>(null);
  const pulseCenterX = useMotionValue(206);
  const pulseCenterY = useMotionValue(29);
  const liveShellWidth=useMotionValue(60);
  const pulseOrigin = useMotionTemplate`${pulseCenterX}px ${pulseCenterY}px`;
  const boundsFrame = useRef<number | null>(null);
  const settledBoundsFrame = useRef<number | null>(null);
  const lastBoundsAt = useRef(0);
  const focusWasInside = useRef(false);
  const publishBounds = useCallback(() => {
    if (boundsFrame.current !== null) return;
    boundsFrame.current = requestAnimationFrame(() => {
      boundsFrame.current = null;
      const shell = shellRef.current;
      if (!shell) return;
      const r = shell.getBoundingClientRect();
      const radius = (parseFloat(getComputedStyle(shell).borderTopLeftRadius) || 26) * r.width / Math.max(1,shell.offsetWidth);
      const regions = Array.from(shell.querySelectorAll<HTMLElement>('[data-island-hit-region]')).filter(node=>!node.closest('[inert]')).map((node) => {
        const rect=node.getBoundingClientRect();
        const scale=rect.width/Math.max(1,node.offsetWidth);
        const padding=Number(node.dataset.hitSlop??0)*scale;
        const radius=Math.min((parseFloat(getComputedStyle(node).borderTopLeftRadius)||0)*scale,rect.width/2,rect.height/2);
        return {x:rect.x-padding,y:rect.y-padding,width:rect.width+padding*2,height:rect.height+padding*2,radius:radius+padding};
      });
      void islaBridge.setIslandBounds({ x: r.x, y: r.y, width: r.width, height: r.height, radius },regions).catch(() => {});
      lastBoundsAt.current = performance.now();
    });
  }, []);
  const [player, setPlayer] = useState<PlayerSnapshot>(INITIAL_PLAYER);
  const publishSettledBounds = useCallback(() => {
    if (settledBoundsFrame.current !== null) cancelAnimationFrame(settledBoundsFrame.current);
    // Motion can complete before its final styles are flushed. Measure on a later paint.
    settledBoundsFrame.current = requestAnimationFrame(() => {
      settledBoundsFrame.current = null;
      publishBounds();
    });
  },[publishBounds]);
  const [previousTrack, setPreviousTrack] = useState<Track | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [stats, setStats] = useState<LibraryStats>(INITIAL_STATS);
  const { devices: outputDevices,refresh: refreshOutputDevices,refreshing: refreshingOutputDevices,error: outputDeviceError } = useAudioOutputs();
  const [scanProgress, setScanProgress] = useState<ScanProgressPayload | null>(
    null
  );
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [isDragHovering, setIsDragHovering] = useState(false);

  const glowTimerRef = useRef<number | null>(null);
  const lastTrackIdRef = useRef<number | null>(null);
  const lastTrackObjRef = useRef<Track | null>(null);
  const pendingDirectionRef = useRef<'next' | 'prev' | 'play'>('next');

  const triggerMorphGlow = useCallback((durationMs: number) => {
    if (glowTimerRef.current !== null) {
      window.clearTimeout(glowTimerRef.current);
    }
    setIsMorphingGlow(true);
    glowTimerRef.current = window.setTimeout(() => {
      setIsMorphingGlow(false);
      glowTimerRef.current = null;
    }, durationMs);
  }, []);

  const showTransientBanner = useCallback((msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => {
      setStatusBanner((cur) => (cur === msg ? null : cur));
    }, 3200);
  }, []);

  const refreshLibraryData = useCallback(async () => {
    const [
      nextTracks,
      nextAlbums,
      nextArtists,
      nextPlaylists,
      nextFolders,
      nextStats,
      nextSnap,
    ] = await Promise.all([
      islaBridge.getLibraryTracks(),
      islaBridge.getAlbums(),
      islaBridge.getArtists(),
      islaBridge.getPlaylists(),
      islaBridge.getLibraryFolders(),
      islaBridge.getLibraryStats(),
      islaBridge.getPlayerSnapshot(),
    ]);
    setTracks(nextTracks);
    setAlbums(nextAlbums);
    setArtists(nextArtists);
    setPlaylists(nextPlaylists);
    setFolders(nextFolders);
    setStats(nextStats);
    setPlayer(nextSnap);
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    void islaBridge.setContextMenuOpen(false);
  }, []);
  const clearTransientActivity = useCallback(() => {
    setTransitionKind('none');
    setIsVolumeMorph(false);
    setIsTransportHovered(false);
  },[]);
  useEffect(() => { if (expanded) clearTransientActivity(); },[expanded,clearTransientActivity]);

  // Content morphs inside a 508×484 click-through canvas with full shadow clearance.
  const commitExpand = useCallback(async () => {
    closeContextMenu();
    clearTransientActivity();
    setIsPillPressed(false);
    triggerMorphGlow(300);
    setExpanded(true);
    await islaBridge.setWindowExpanded(true, 412);
  }, [closeContextMenu, triggerMorphGlow, clearTransientActivity]);

  const handleExpand=useCallback(()=>{
    if(settings.pillSize==='compact'&&(compactControls||isVolumeMorph||compactFlow.phase==='merging')) {
      clearTransientActivity();setIsPillPressed(false);
      dispatchCompact({type:'request',intent:'expand'});
    } else {void commitExpand();}
  },[settings.pillSize,compactControls,isVolumeMorph,compactFlow.phase,clearTransientActivity,commitExpand]);
  useEffect(()=>{if(compactFlow.phase==='expand')void commitExpand();},[compactFlow.phase,commitExpand]);

  const handleCollapse = useCallback(async () => {
    closeContextMenu();
    clearTransientActivity();
    setIsPillPressed(false);
    triggerMorphGlow(240);
    setExpanded(false);
    setCompactControls(false);
    await islaBridge.setWindowExpanded(false, 412);
  }, [closeContextMenu, triggerMorphGlow, clearTransientActivity]);

  const idleCallback=useRef(()=>{});
  idleCallback.current=()=>{void handleCollapse();};
  const [idleCollapse]=useState(()=>createIdleCollapse(()=>idleCallback.current()));
  const idleActive=expanded||compactFlow.phase!=='orb'||isVolumeMorph||transitionKind!=='none'||Boolean(contextMenu);
  useEffect(()=>{
    // Internal merge/expand phases and playback updates must preserve the deadline.
    idleCollapse.arm(idleActive?(isVolumeMorph?1100:2400):null);
  },[idleCollapse,idleActive,isVolumeMorph]);
  useEffect(()=>{
    const release=()=>idleCollapse.release();
    window.addEventListener('pointerup',release,true);
    window.addEventListener('pointercancel',release,true);
    window.addEventListener('blur',release);
    return()=>{
      window.removeEventListener('pointerup',release,true);
      window.removeEventListener('pointercancel',release,true);
      window.removeEventListener('blur',release);
      idleCollapse.dispose();
    };
  },[idleCollapse]);

  const handlePillActivate = useCallback(() => {
    if(settings.pillSize==='compact'&&(compactControls||isVolumeMorph||compactFlow.phase==='merging')) {
      clearTransientActivity();setIsPillPressed(false);setCompactControls(false);return;
    }
    if(isVolumeMorph){handleExpand();return;}
    if (compactActivation(settings.pillSize,compactControls) === 'reveal') {
      clearTransientActivity();
      setIsPillPressed(false);
      setCompactControls(true);
      triggerMorphGlow(260);
    } else { void handleExpand(); }
  },[settings.pillSize,compactControls,compactFlow.phase,isVolumeMorph,clearTransientActivity,triggerMorphGlow,handleExpand]);

  // Initial bootstrap & event listeners
  useEffect(() => {
    let mounted = true;

    void islaBridge.getInitialAppState().then((init) => {
      if (!mounted) return;
      setSettings(init.settings);
      setPlayer(init.player);
      setTracks(init.tracks);
      setAlbums(init.albums);
      setArtists(init.artists);
      setPlaylists(init.playlists);
      setFolders(init.folders);
      setStats(init.stats);
      setExpanded(init.expanded);
      setAnchorOffset({
        x: init.anchorOffsetX ?? 76,
        y: init.anchorOffsetY ?? 0,
      });
    });


    const unlistenPromises = [
      islaBridge.onPlaybackState((snap) => {
        if (mounted) setPlayer(snap);
      }),
      islaBridge.onPlaybackProgress((progress) => {
        if (mounted) setPlayer((current) => applyPlaybackProgress(current, progress));
      }),
      islaBridge.onPlaybackError((err) => {
        if (mounted) showTransientBanner(err);
      }),
      islaBridge.onScanProgress((prog) => {
        if (!mounted) return;
        setScanProgress(prog.done ? null : prog);
      }),
      islaBridge.onWindowMode((geom) => {
        if (!mounted) return;
        setIsDraggingWindow(Boolean(geom.isDragging));
        setAnchorOffset({
          x: geom.anchorOffsetX ?? 76,
          y: geom.anchorOffsetY ?? 0,
        });
        setExpanded((prev) => {
          if (prev !== geom.expanded) {
            triggerMorphGlow(280);
          }
          return geom.expanded;
        });
      }),
      islaBridge.onSettingsUpdated((nextSettings) => {
        if (mounted) setSettings(nextSettings);
      }),
      islaBridge.onFileDrop((paths, phase) => {
        if (!mounted) return;
        if (phase === 'hover') {
          setIsDragHovering(true);
        } else if (phase === 'cancel') {
          setIsDragHovering(false);
        } else if (phase === 'drop') {
          setIsDragHovering(false);
          if (paths.length > 0) {
            void islaBridge
              .importDroppedPaths(paths, true)
              .then(async (summary) => {
                await refreshLibraryData();
                showTransientBanner(
                  `Imported ${summary.addedOrUpdated} audio track(s)`
                );
              })
              .catch((err: unknown) => {
                showTransientBanner(String(err));
              });
          }
        }
      }),
    ];

    return () => {
      mounted = false;
      void Promise.all(unlistenPromises).then((unlistens) =>
        unlistens.forEach((fn) => fn())
      );
    };
  }, [refreshLibraryData, showTransientBanner, triggerMorphGlow]);

  // Theme & Glass attributes synchronization
  useEffect(() => {
    const root = document.documentElement;
    const mediaDark = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const isDark =
        settings.theme === 'dark' ||
        (settings.theme === 'system' && mediaDark.matches);
      root.setAttribute('data-theme', isDark ? 'dark' : 'light');
      setIsDarkTheme(isDark);
      root.setAttribute('data-glass', settings.glassIntensity);
    };

    applyTheme();
    mediaDark.addEventListener('change', applyTheme);
    return () => mediaDark.removeEventListener('change', applyTheme);
  }, [settings.theme, settings.glassIntensity]);

  // Effective accent color (allows subtle artwork influence when enabled)
  const effectiveAccentColor = useMemo(() => {
    if (
      settings.dynamicArtworkAccent &&
      player.currentTrack?.dominantColor
    ) {
      return getReadableAccent(player.currentTrack.dominantColor, isDarkTheme);
    }
    return getReadableAccent(settings.accentColor || '#5B7CFA', isDarkTheme);
  }, [
    settings.dynamicArtworkAccent,
    settings.accentColor,
    player.currentTrack?.dominantColor,
    isDarkTheme,
  ]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--isla-accent',
      effectiveAccentColor
    );
  }, [effectiveAccentColor]);

  // Suppress default WebView2 browser context menu globally & close custom menu on blur
  useEffect(() => {
    const onGlobalContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    const onWindowBlur = () => {
      closeContextMenu();
      if (settings.collapseOnBlur && expanded) {
        void handleCollapse();
      }
    };
    window.addEventListener('contextmenu', onGlobalContextMenu);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('contextmenu', onGlobalContextMenu);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [closeContextMenu, settings.collapseOnBlur, expanded, handleCollapse]);

  // Keyboard accessibility shortcuts
  useEffect(() => {
    // Context menus are above drawers; capture Escape before a drawer consumes it.
    const onCaptureKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && contextMenu) {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase() ?? 'body';
      const isInput = target?.isContentEditable || ['input', 'textarea', 'select'].includes(tag);
      const ownsKey = !shouldHandlePlaybackKey(tag) || !shouldHandlePlaybackKey(target?.isContentEditable ? 'contenteditable' : target?.getAttribute('role') ?? tag);

      if (e.key === 'Escape') {
        if (contextMenu) {
          e.preventDefault();
          closeContextMenu();
          return;
        }
        if (expanded && !isInput) {
          e.preventDefault();
          void handleCollapse();
        } else if ((compactControls||compactFlow.phase==='merging') && !isInput) {
          e.preventDefault();
          clearTransientActivity();
          setCompactControls(false);
        }
      } else if (e.key === ' ' && !isInput && !ownsKey && !e.repeat && !e.defaultPrevented) {
        e.preventDefault();
        void islaBridge.togglePlayPause();
      } else if ((e.key === 'm' || e.key === 'M') && !isInput && !e.repeat) {
        e.preventDefault();
        void islaBridge.toggleMute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keydown', onCaptureKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keydown', onCaptureKeyDown, true);
    };
  }, [contextMenu, closeContextMenu, expanded, handleCollapse,compactControls,compactFlow.phase,clearTransientActivity]);

  // Maximum play count across the library & queue to detect the user's Most Played tracks
  const maxPlayCount = useMemo(() => {
    let max = 0;
    for (const t of tracks) {
      if ((t.playCount ?? 0) > max) max = t.playCount ?? 0;
    }
    for (const t of player.queue) {
      if ((t.playCount ?? 0) > max) max = t.playCount ?? 0;
    }
    if ((player.currentTrack?.playCount ?? 0) > max) {
      max = player.currentTrack?.playCount ?? 0;
    }
    return max;
  }, [tracks, player.queue, player.currentTrack]);

  const classifyTrackTransition = useCallback(
    (track: Track, currentMaxPlays: number): PillTransitionKind => {
      const plays = track.playCount ?? 0;
      const isLoved = Boolean(track.isFavorite);
      const isMostPlayed =
        plays >= 2 && plays >= Math.max(2, currentMaxPlays);

      if (isLoved && isMostPlayed) return 'crownLoved';
      if (isMostPlayed) return 'mostPlayed';
      if (isLoved) return 'loved';
      return 'standard';
    },
    []
  );

  const triggerTrackTransitionMorph = useCallback(
    (
      kind: PillTransitionKind,
      direction: 'next' | 'prev' | 'play' = 'next'
    ) => {
      setTransitionDirection(direction);
      setTransitionKind(kind);
      triggerMorphGlow(1100);
      idleCollapse.touch();
    },
    [triggerMorphGlow,idleCollapse]
  );

  const showVolumeMorph=useCallback(()=>{
    setIsVolumeMorph(true);
    idleCollapse.touch();
  },[idleCollapse]);
  useEffect(()=>{if(compactFlow.phase==='volume')showVolumeMorph();},[compactFlow.phase,showVolumeMorph]);
  const handleWheelVolume = useCallback((vol:number)=>{
    void islaBridge.setVolume(vol);
    if(settings.pillSize!=='compact'||isVolumeMorph){showVolumeMorph();return;}
    if(compactFlow.phase==='merging'&&compactFlow.pending==='expand')return;
    clearTransientActivity();setIsPillPressed(false);
    dispatchCompact({type:'request',intent:'volume'});
  },[settings.pillSize,isVolumeMorph,compactFlow,showVolumeMorph,clearTransientActivity]);

  // Playback & Library handlers
  const handleCycleRepeat = async () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const next =
      order[(order.indexOf(player.repeatMode) + 1) % order.length];
    await islaBridge.setRepeatMode(next);
  };

  const handleCycleCrossfade = async () => {
    const presets: { enabled: boolean; secs: number; label: string }[] = [
      { enabled: false, secs: 6, label: 'Off' },
      { enabled: true, secs: 3, label: '3s' },
      { enabled: true, secs: 6, label: '6s' },
      { enabled: true, secs: 9, label: '9s' },
      { enabled: true, secs: 12, label: '12s' },
    ];
    const curEnabled = settings.crossfadeEnabled !== false;
    const curSecs = Math.round(settings.crossfadeSecs ?? 6);
    const curIdx = presets.findIndex((p) =>
      !p.enabled ? !curEnabled : curEnabled && p.secs === curSecs
    );
    const nextPreset = presets[(curIdx + 1) % presets.length];
    const saved = await islaBridge.setCrossfade(
      nextPreset.enabled,
      nextPreset.secs
    );
    setSettings(saved);
    showTransientBanner(
      nextPreset.enabled
        ? `Automix Crossfade: ${nextPreset.label} smooth blend`
        : 'Automix Crossfade: Off'
    );
  };

  const handleToggleFavorite = async (trackId: number) => {
    const updatedTrack = await islaBridge.toggleFavorite(trackId);
    await refreshLibraryData();
    if (updatedTrack.isFavorite && !expanded && player.currentTrack?.id === trackId) {
      const plays = player.currentTrack.playCount ?? 0;
      const isTop = plays >= 2 && plays >= Math.max(2, maxPlayCount);
      triggerTrackTransitionMorph(
        isTop ? 'crownLoved' : 'loved',
        'play'
      );
    }
  };

  const handleNextTrackWithMorph = useCallback(() => {
    focusWasInside.current = true;
    pendingDirectionRef.current = 'next';
    void islaBridge.nextTrack();
  }, []);

  const handlePrevTrackWithMorph = useCallback(() => {
    focusWasInside.current = true;
    pendingDirectionRef.current = 'prev';
    void islaBridge.previousTrack();
  }, []);

  const handleAddMusicFolder = async () => {
    try {
      const summary = await islaBridge.pickAndScanFolder();
      if (summary) {
        await refreshLibraryData();
        showTransientBanner(
          `Indexed ${summary.addedOrUpdated} track(s) from folder`
        );
      }
    } catch (err) {
      showTransientBanner(String(err));
    }
  };

  const handleImportAudioFiles = async () => {
    try {
      const summary = await islaBridge.pickAndImportAudioFiles();
      if (summary) {
        await refreshLibraryData();
        showTransientBanner(
          `Imported ${summary.addedOrUpdated} audio file(s)`
        );
      }
    } catch (err) {
      showTransientBanner(String(err));
    }
  };

  const handleRescanLibrary = async () => {
    try {
      const summary = await islaBridge.rescanLibrary();
      await refreshLibraryData();
      showTransientBanner(
        `Library rescan complete (${summary.totalLibraryTracks} songs)`
      );
    } catch (err) {
      showTransientBanner(String(err));
    }
  };

  const handleRemoveFolder = async (folderId: number, removeTracks: boolean) => {
    await islaBridge.removeLibraryFolder(folderId, removeTracks);
    await refreshLibraryData();
    showTransientBanner('Removed folder from library');
  };

  const handleCleanMissingTracks = async () => {
    const count = await islaBridge.removeMissingTracks();
    await refreshLibraryData();
    showTransientBanner(`Removed ${count} missing track(s)`);
  };

  const handleCreatePlaylist = async (
    name: string,
    initialTrackId?: number
  ) => {
    const created = await islaBridge.createPlaylist(name);
    if (initialTrackId !== undefined) {
      await islaBridge.addTrackToPlaylist(created.id, initialTrackId);
    }
    await refreshLibraryData();
    showTransientBanner(`Created playlist “${created.name}”`);
  };

  const handleRenamePlaylist = async (playlistId: number, name: string) => {
    await islaBridge.renamePlaylist(playlistId, name);
    await refreshLibraryData();
  };

  const handleDeletePlaylist = async (playlistId: number) => {
    await islaBridge.deletePlaylist(playlistId);
    await refreshLibraryData();
    showTransientBanner('Deleted playlist');
  };

  const handleAddTrackToPlaylist = async (
    playlistId: number,
    trackId: number
  ) => {
    await islaBridge.addTrackToPlaylist(playlistId, trackId);
    await refreshLibraryData();
    showTransientBanner('Added song to playlist');
  };

  const handleUpdateSettings = async (next: AppSettings) => {
    const saved = await islaBridge.updateSettings(next);
    setSettings(saved);
  };

  // Detect track changes (Next / Previous / Auto-Advance) to trigger the Dynamic Island Track Transition Morph
  useEffect(() => {
    const currentTrack = player.currentTrack;
    const currentId = currentTrack?.id ?? null;
    if (
      currentTrack &&
      currentId !== null &&
      lastTrackIdRef.current !== null &&
      currentId !== lastTrackIdRef.current
    ) {
      if (lastTrackObjRef.current) {
        setPreviousTrack(lastTrackObjRef.current);
      }
      const kind = classifyTrackTransition(currentTrack, maxPlayCount);
      const dir = pendingDirectionRef.current;
      pendingDirectionRef.current = 'next';
      if (!expanded && compactFlow.phase!=='merging') {
        triggerTrackTransitionMorph(kind, dir);
      }
      // Refresh library in background so updated playCount is reflected in lists
      void islaBridge.getLibraryTracks().then(setTracks);
    }
    lastTrackIdRef.current = currentId;
    if (currentTrack) {
      lastTrackObjRef.current = currentTrack;
    }
  }, [
    player.currentTrack,
    expanded,
    maxPlayCount,
    classifyTrackTransition,
    triggerTrackTransitionMorph,
  ]);

  // Dynamic Island geometry & normalized directional anchor ratios [0..1]
  const pillDimensions = useMemo(() => {
    if (settings.pillSize === 'compact') {
      return { width: 60, height: 60, radius: 30 };
    }
    if (settings.pillSize === 'large') {
      return { width: 292, height: 62, radius: 31 };
    }
    return { width: 260, height: 58, radius: 29 };
  }, [settings.pillSize]);

  const maxOffsetX = Math.max(1, 412 - pillDimensions.width);
  const maxOffsetY = Math.max(1, 388 - pillDimensions.height);
  const anchorRatioX = Math.min(1, Math.max(0, anchorOffset.x / maxOffsetX));
  const anchorRatioY = Math.min(1, Math.max(0, anchorOffset.y / maxOffsetY));
  const expandUpward = anchorRatioY > 0.5;

  // One continuous shell: player, handoff activity, volume and resting capsule.
  const isTransitionMorph = !expanded && !isVolumeMorph && transitionKind !== 'none' && Boolean(player.currentTrack);
  const beatPulse = useBeatPulse(canPulsePill({ enabled: settings.beatPulse, playing: player.isPlaying, muted: player.isMuted,
    volume: player.volume, expanded, morphing: isTransitionMorph || isVolumeMorph || isShellMorphing, dragging: isDraggingWindow || isPillPressed,
    reducedMotion: reduceMotion, interacting: isTransportHovered || Boolean(contextMenu) }), player.currentTrack?.id ?? null,reduceMotion);
  useMotionValueEvent(beatPulse.scaleX,'change',(scale) => {
    // Resets must reach native hit testing even when the last beat frame was just sent.
    if (scale === 1) publishSettledBounds();
    else if (performance.now()-lastBoundsAt.current > 30) publishBounds();
  });
  const orbLayout = settings.pillSize === 'compact' && !expanded && !isTransitionMorph && !isVolumeMorph;
  const compactLayout = getCompactLayout(anchorOffset.x,anchorOffset.y,compactControls);
  const geometry = getIslandGeometry(settings.pillSize, anchorOffset.x, anchorOffset.y, expanded, isTransitionMorph, isVolumeMorph, expandedPanelHeight,compactControls);
  useEffect(()=>{
    if(compactFlow.phase!=='merging'||isShellMorphing||isVolumeMorph||isTransitionMorph||expanded)return;
    // A rapid second activation can arrive before the first split paints at all.
    // In that case no geometry animation completes; two paints confirm the orb is ready.
    let second:number|undefined;
    const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
      if(Math.abs((shellRef.current?.offsetWidth??0)-60)<1)dispatchCompact({type:'settled'});
    });});
    return()=>{cancelAnimationFrame(first);if(second!==undefined)cancelAnimationFrame(second);};
  },[compactFlow.phase,isShellMorphing,isVolumeMorph,isTransitionMorph,expanded]);
  const islandTarget = {
    x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height,
    borderRadius: geometry.radius,
    scaleX: expanded || reduceMotion ? 1 : isPillPressed ? 0.985 : 1,
    scaleY: expanded || reduceMotion ? 1 : isPillPressed ? 0.985 : 1,
  };

  const shellTransition = islandTransition(
    expanded ? 'expanded' : isVolumeMorph ? 'volume' : isTransitionMorph ? 'notice' : 'compact',
    reduceMotion,
    isDraggingWindow,
  );

  const originX = `${(anchorRatioX * 100).toFixed(2)}%`;
  const originY = `${(anchorRatioY * 100).toFixed(2)}%`;

  // Special border glow color when morphing for Loved or Most Played tracks
  const specialGlowColor =
    transitionKind === 'crownLoved'
      ? '#EC4899'
      : transitionKind === 'mostPlayed'
        ? '#F59E0B'
        : transitionKind === 'loved'
          ? '#F43F5E'
          : effectiveAccentColor;

  useEffect(() => {
    publishBounds();
  }, [expanded, compactControls,expandedPanelHeight, settings.pillSize, anchorOffset.x, anchorOffset.y, isTransitionMorph, isVolumeMorph, publishBounds]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (focusWasInside.current) {
        const selector = expanded ? "[data-expanded-play]" : orbLayout||settings.pillSize==='compact'&&isVolumeMorph ? "[data-compact-orb]" : "[data-pill-play]";
        Array.from(shellRef.current?.querySelectorAll<HTMLButtonElement>(selector)??[])
          .find(button=>!button.closest('[inert]'))?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [expanded,compactControls,orbLayout,isVolumeMorph,settings.pillSize]);

  useEffect(() => () => {
    if (glowTimerRef.current !== null) clearTimeout(glowTimerRef.current);
    if (boundsFrame.current !== null) cancelAnimationFrame(boundsFrame.current);
    boundsFrame.current = null;
    if (settledBoundsFrame.current !== null) cancelAnimationFrame(settledBoundsFrame.current);
    settledBoundsFrame.current = null;
  }, []);

  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "never"}>
    <div className="relative w-full h-full flex items-start justify-start p-[48px]"
      onKeyDownCapture={()=>idleCollapse.touch()}
      onPointerDownCapture={()=>idleCollapse.hold()}
      onClickCapture={()=>idleCollapse.touch()}
      onWheelCapture={()=>idleCollapse.touch()}
      onInputCapture={()=>idleCollapse.touch()}
      onContextMenuCapture={()=>idleCollapse.touch()}>
      {isDragHovering && (
        <div
          className="pointer-events-none fixed inset-3 z-50 rounded-3xl border-2 border-dashed flex items-center justify-center text-[13px] font-semibold backdrop-blur-md"
          style={{
            borderColor: effectiveAccentColor,
            backgroundColor: 'rgba(255, 255, 255, 0.72)',
            color: '#171717',
          }}
        >
          Drop audio files or folders to import into Isla
        </div>
      )}

      {/* UNIFIED iOS DYNAMIC ISLAND MORPH SHELL */}
      <motion.div className="isla-pulse-stage relative shrink-0 w-[412px] h-[388px]" style={{ ...beatPulse, transformOrigin: pulseOrigin }}>
      <motion.div
        ref={shellRef}
        data-compact-phase={settings.pillSize==='compact'?compactFlow.phase:undefined}
        onFocusCapture={() => { focusWasInside.current = true; }}
        onKeyDownCapture={() => { focusWasInside.current = true; }}
        onPointerDownCapture={() => { focusWasInside.current = false; }}
        onUpdate={(latest) => {
          if(typeof latest.width==='number')liveShellWidth.set(latest.width);
          if (typeof latest.x === 'number' && typeof latest.width === 'number') pulseCenterX.set(latest.x+latest.width/2);
          if (typeof latest.y === 'number' && typeof latest.height === 'number') pulseCenterY.set(latest.y+latest.height/2);
          if (performance.now() - lastBoundsAt.current > 30) publishBounds();
        }}
        onAnimationStart={()=>setIsShellMorphing(true)}
        onAnimationComplete={()=>{
          setIsShellMorphing(false);publishSettledBounds();
          if(compactFlow.phase==='merging'&&!isVolumeMorph&&!isTransitionMorph&&!expanded&&Math.abs((shellRef.current?.offsetWidth??0)-60)<1)
            dispatchCompact({type:'settled'});
        }}
        initial={false}
        animate={islandTarget}
        transition={shellTransition}
        style={{
          transformOrigin: `${originX} ${originY}`,
          overflow: 'visible',
          isolation: 'isolate',
          color: 'var(--isla-text-primary)',
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
          void islaBridge.setContextMenuOpen(true);
        }}
        className="isla-island-shell relative"
      >
        {/* One shared uniform pulse carries the entire composition without layout projection. */}
        <motion.div aria-hidden="true" className="isla-glass-island isla-pulse-surface pointer-events-none absolute inset-0"
          animate={{opacity:orbLayout?0:1}} transition={{duration:reduceMotion?0.1:0.18}}
          style={{ borderRadius: 'inherit', zIndex: 0 }} />
        <div className="isla-island-content absolute inset-0" style={{ borderRadius: 'inherit', overflow: orbLayout||settings.pillSize==='compact'?'visible':'clip', zIndex: 1 }}>
        {/* Subtle iOS Dynamic Island liquid refraction glow pulse during morph */}
        <motion.div
          initial={false}
          animate={{
            opacity: isMorphingGlow && !isTransitionMorph && !orbLayout ? 0.14 : 0,
            scale: isMorphingGlow && !isTransitionMorph ? 1.04 : 0.92,
          }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 w-64 h-28 rounded-full blur-2xl z-20"
          style={{
            top: expandUpward ? 'auto' : '-2rem',
            bottom: expandUpward ? '-2rem' : 'auto',
            background: `radial-gradient(circle, ${hexToRgba(specialGlowColor, 0.55)} 0%, transparent 72%)`,
          }}
        />

        {/* STATE A: COMPACT PILL & LIVE ACTIVITY MORPH LAYER */}
        {settings.pillSize==='compact' && <CompactOrb player={player} settings={motionSettings} accentColor={effectiveAccentColor}
          isExpanded={!orbLayout&&!isVolumeMorph} volumeMorph={isVolumeMorph} controls={compactControls} orbX={compactLayout.orbX} controlsX={compactLayout.controlsX} side={compactLayout.side}
          onExpand={handlePillActivate} onOpenPlayer={handleExpand} onTogglePlayPause={()=>void islaBridge.togglePlayPause()}
          onNextTrack={handleNextTrackWithMorph} onPreviousTrack={handlePrevTrackWithMorph}
          onWheelVolume={handleWheelVolume} onPressChange={setIsPillPressed} onControlHoverChange={setIsTransportHovered}
          geometryTransition={shellTransition} onGeometryChange={publishBounds}/>}
        <AnimatePresence>{settings.pillSize==='compact'&&isVolumeMorph&&!expanded&&<CompactVolume key="compact-volume" volume={player.isMuted?0:player.volume} side={compactLayout.side} accentColor={effectiveAccentColor} reduced={reduceMotion} onWheelVolume={handleWheelVolume}/>}</AnimatePresence>
        {!orbLayout && !(settings.pillSize==='compact'&&isVolumeMorph) && <CompactPill
          player={player}
          previousTrack={previousTrack}
          settings={motionSettings}
          accentColor={effectiveAccentColor}
          isExpanded={expanded}
          pillHeight={pillDimensions.height}
          expandUpward={expandUpward}
          transitionKind={transitionKind}
          transitionDirection={transitionDirection}
          isVolumeMorph={isVolumeMorph}
          maxPlayCount={maxPlayCount}
          onExpand={handleExpand}
          onTogglePlayPause={() => void islaBridge.togglePlayPause()}
          onNextTrack={handleNextTrackWithMorph}
          onPreviousTrack={handlePrevTrackWithMorph}
          onToggleFavorite={(tid) => void handleToggleFavorite(tid)}
          onWheelVolume={handleWheelVolume}
          onDismissTransition={() => setTransitionKind('none')}
          onPressChange={setIsPillPressed}
          onControlHoverChange={setIsTransportHovered}
        />}

        {/* STATE B & C: EXPANDED PLAYER & LIBRARY LAYER */}
        <ExpandedPlayer
          gatherGeometry={settings.pillSize==='compact'?{width:liveShellWidth}:undefined}
          onPanelHeightChange={setExpandedPanelHeight}
          player={player}
          settings={motionSettings}
          tracks={tracks}
          albums={albums}
          artists={artists}
          playlists={playlists}
          folders={folders}
          stats={stats}
          outputDevices={outputDevices}
          onRefreshOutputDevices={refreshOutputDevices}
          refreshingOutputDevices={refreshingOutputDevices}
          outputDeviceError={outputDeviceError}
          activeTab={activeTab}
          accentColor={effectiveAccentColor}
          isExpanded={expanded}
          anchorRatioX={anchorRatioX}
          anchorRatioY={anchorRatioY}
          scanProgress={scanProgress}
          statusBanner={statusBanner}
          onSelectTab={setActiveTab}
          onCollapse={() => void handleCollapse()}
          onTogglePlayPause={() => void islaBridge.togglePlayPause()}
          onNextTrack={handleNextTrackWithMorph}
          onPreviousTrack={handlePrevTrackWithMorph}
          onSeek={(secs) => void islaBridge.seekPlayback(secs)}
          onSetVolume={(vol) => void islaBridge.setVolume(vol)}
          onToggleMute={() => void islaBridge.toggleMute()}
          onToggleShuffle={() => void islaBridge.setShuffle(!player.shuffle)}
          onCycleRepeat={() => void handleCycleRepeat()}
          onCycleCrossfade={() => void handleCycleCrossfade()}
          onPlayTrackFromList={(trackId, listIds) =>
            void islaBridge.playTrack(trackId, listIds)
          }
          onPlayQueueIndex={(idx) => void islaBridge.playQueueIndex(idx)}
          onPlayNext={(trackId) => {
            void islaBridge.addToQueue(trackId, true);
            showTransientBanner('Playing next in queue');
          }}
          onAddToQueue={(trackId) => {
            void islaBridge.addToQueue(trackId, false);
            showTransientBanner('Added to queue');
          }}
          onRemoveFromQueue={(idx) => void islaBridge.removeFromQueue(idx)}
          onReorderQueue={(from, to) => void islaBridge.reorderQueue(from, to)}
          onClearQueue={() => void islaBridge.clearQueue()}
          onToggleFavorite={(tid) => void handleToggleFavorite(tid)}
          onCreatePlaylist={handleCreatePlaylist}
          onRenamePlaylist={handleRenamePlaylist}
          onDeletePlaylist={handleDeletePlaylist}
          onAddTrackToPlaylist={handleAddTrackToPlaylist}
          onAddMusicFolder={() => void handleAddMusicFolder()}
          onImportAudioFiles={() => void handleImportAudioFiles()}
          onRescanLibrary={() => void handleRescanLibrary()}
          onRemoveFolder={(fid, rem) => void handleRemoveFolder(fid, rem)}
          onCleanMissingTracks={() => void handleCleanMissingTracks()}
          onUpdateSettings={handleUpdateSettings}
          onMinimizeToTray={() => void islaBridge.minimizeToTray()}
          onQuitApplication={() => void islaBridge.quitApplication()}
        />
        </div>
      </motion.div>

      </motion.div>
      {/* ISLA APPLICATION RIGHT-CLICK CONTEXT MENU */}
      <AppContextMenu
        open={Boolean(contextMenu)}
        x={contextMenu?.x ?? 120}
        y={contextMenu?.y ?? 120}
        expanded={expanded}
        player={player}
        settings={motionSettings}
        accentColor={effectiveAccentColor}
        onClose={closeContextMenu}
        onToggleExpand={() => {
          if (expanded) {
            void handleCollapse();
          } else {
            void handleExpand();
          }
        }}
        onTogglePlayPause={() => void islaBridge.togglePlayPause()}
        onNextTrack={handleNextTrackWithMorph}
        onPreviousTrack={handlePrevTrackWithMorph}
        onToggleShuffle={() => void islaBridge.setShuffle(!player.shuffle)}
        onCycleRepeat={() => void handleCycleRepeat()}
        onCycleCrossfade={() => void handleCycleCrossfade()}
        onAddMusicFolder={() => void handleAddMusicFolder()}
        onImportAudioFiles={() => void handleImportAudioFiles()}
        onToggleAlwaysOnTop={() =>
          void handleUpdateSettings({
            ...settings,
            alwaysOnTop: !settings.alwaysOnTop,
          })
        }
        onToggleTheme={() =>
          void handleUpdateSettings({
            ...settings,
            theme: settings.theme === 'dark' ? 'light' : 'dark',
          })
        }
        onOpenSettings={() => {
          setActiveTab('settings');
          if (!expanded) {
            void handleExpand();
          }
        }}
        onMinimizeToTray={() => void islaBridge.minimizeToTray()}
        onQuitApplication={() => void islaBridge.quitApplication()}
      />
    </div>
    </MotionConfig>
  );
};
