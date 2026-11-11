import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  IslandBounds,
  EqualizerSettings,
  PlayerProgress,
  AlbumSummary,
  AppSettings,
  ArtistSummary,
  AudioDeviceInfo,
  InitialBootstrapPayload,
  LibraryFolder,
  LibraryStats,
  PlayerSnapshot,
  Playlist,
  PlaylistDetail,
  RepeatMode,
  ScanProgressPayload,
  ScanSummary,
  Track,
  WindowGeometryResult,
} from '../types/isla';
import { normalizeEqualizer } from '../utils/equalizer';
import type { AudioBeat } from '../utils/beat';
import { createLatestPublisher } from '../utils/latest-publisher';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const publishIslandBounds = createLatestPublisher(async (geometry: {bounds:IslandBounds; regions:IslandBounds[]; expanded:boolean}) => {
  if (isTauriRuntime()) await invoke('set_island_bounds', geometry);
});
const publishIslandPointer = createLatestPublisher(async (pressed: boolean) => {
  if (isTauriRuntime()) await invoke('set_island_pointer_pressed', { pressed });
});
const publishContextMenu = createLatestPublisher(async (open: boolean) => {
  if (isTauriRuntime()) await invoke('set_context_menu_open', { open });
});

const DEFAULT_SETTINGS: AppSettings = {
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

const EMPTY_PLAYER: PlayerSnapshot = {
  isPlaying: false,
  currentTrack: null,
  positionSecs: 0,
  durationSecs: 0,
  volume: 0.72,
  isMuted: false,
  shuffle: false,
  repeatMode: 'off',
  queue: [],
  currentQueueIndex: null,
  outputDevice: null,
  lastError: null,
};

const EMPTY_STATS: LibraryStats = {
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

export const islaBridge = {
  async onAudioOutputsChanged(handler: (devices: AudioDeviceInfo[]) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<AudioDeviceInfo[]>('isla://audio-devices-changed',(event) => handler(event.payload));
  },
  async onAudioBeat(handler: (beat: AudioBeat) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<AudioBeat>('isla://audio-beat', (event) => handler(event.payload));
  },
  async previewEqualizer(settings: EqualizerSettings): Promise<void> {
    if (isTauriRuntime()) await invoke('preview_equalizer', { settings });
  },
  async saveEqualizer(settings: EqualizerSettings): Promise<AppSettings> {
    if (!isTauriRuntime()) return { ...DEFAULT_SETTINGS, equalizer: normalizeEqualizer(settings) };
    return invoke<AppSettings>('save_equalizer', { settings });
  },
  async setIslandBounds(bounds: IslandBounds, regions: IslandBounds[] = [], expanded = false): Promise<void> {
    await publishIslandBounds({bounds, regions, expanded});
  },
  setIslandPointerPressed: publishIslandPointer,
  async onPlaybackProgress(handler: (progress: PlayerProgress) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<PlayerProgress>('isla://playback-progress', (ev) => handler(ev.payload));
  },
  async getInitialAppState(): Promise<InitialBootstrapPayload> {
    if (!isTauriRuntime()) {
      return {
        settings: DEFAULT_SETTINGS,
        player: EMPTY_PLAYER,
        tracks: [],
        albums: [],
        artists: [],
        playlists: [],
        folders: [],
        stats: EMPTY_STATS,
        expanded: false,
        anchorOffsetX: 88,
        anchorOffsetY: 0,
      };
    }
    return invoke<InitialBootstrapPayload>('get_initial_app_state');
  },

  async setWindowExpanded(
    expanded: boolean,
    customHeight?: number
  ): Promise<WindowGeometryResult> {
    if (!isTauriRuntime()) {
      return {
        expanded,
        x: 96,
        y: 72,
        width: 460,
        height: customHeight ?? 640,
        anchorOffsetX: 88,
        anchorOffsetY: 0,
        isDragging: false,
      };
    }
    return invoke<WindowGeometryResult>('set_window_expanded', {
      expanded,
      customHeight: customHeight ?? null,
    });
  },

  async startWindowDragging(): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
      await invoke('start_interactive_drag');
    } catch {
      // Ignore if pointer already released
    }
  },

  async setContextMenuOpen(open: boolean): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
      await publishContextMenu(open);
    } catch {
      // Ignore
    }
  },

  async saveCurrentWindowPosition(): Promise<[number, number]> {
    if (!isTauriRuntime()) return [96, 72];
    return invoke<[number, number]>('save_current_window_position');
  },

  async setAlwaysOnTop(alwaysOnTop: boolean): Promise<AppSettings> {
    if (!isTauriRuntime()) {
      return { ...DEFAULT_SETTINGS, alwaysOnTop };
    }
    return invoke<AppSettings>('set_always_on_top', { alwaysOnTop });
  },

  async minimizeToTray(): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('minimize_to_tray_command');
  },

  async quitApplication(): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('quit_application');
  },

  // --- Playback ---
  async getPlayerSnapshot(): Promise<PlayerSnapshot> {
    if (!isTauriRuntime()) return EMPTY_PLAYER;
    return invoke<PlayerSnapshot>('get_player_snapshot');
  },

  async playTrack(trackId: number, queueTrackIds?: number[]): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('play_track', {
      trackId,
      queueTrackIds: queueTrackIds ?? null,
    });
  },

  async playQueueIndex(index: number): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('play_queue_index', { index });
  },

  async togglePlayPause(): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('toggle_play_pause');
  },

  async nextTrack(): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('next_track');
  },

  async previousTrack(): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('previous_track');
  },

  async seekPlayback(positionSecs: number): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('seek_playback', { positionSecs });
  },

  async setVolume(volume: number): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('set_volume', { volume });
  },

  async toggleMute(): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('toggle_mute');
  },

  async setShuffle(shuffle: boolean): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('set_shuffle', { shuffle });
  },

  async setRepeatMode(mode: RepeatMode): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('set_repeat_mode', { mode });
  },

  async setCrossfade(
    enabled: boolean,
    durationSecs: number
  ): Promise<AppSettings> {
    if (!isTauriRuntime()) {
      return {
        ...DEFAULT_SETTINGS,
        crossfadeEnabled: enabled,
        crossfadeSecs: durationSecs,
      };
    }
    return invoke<AppSettings>('set_crossfade', { enabled, durationSecs });
  },

  async setQueue(
    trackIds: number[],
    startIndex?: number,
    autoPlay = true
  ): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('set_queue', {
      trackIds,
      startIndex: startIndex ?? 0,
      autoPlay,
    });
  },

  async addToQueue(trackId: number, playNext = false): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('add_to_queue', { trackId, playNext });
  },

  async removeFromQueue(index: number): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('remove_from_queue', { index });
  },

  async reorderQueue(fromIndex: number, toIndex: number): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('reorder_queue', { fromIndex, toIndex });
  },

  async clearQueue(): Promise<void> {
    if (!isTauriRuntime()) return;
    return invoke('clear_queue');
  },

  async getAudioOutputDevices(): Promise<AudioDeviceInfo[]> {
    if (!isTauriRuntime()) {
      return [{ name: 'System Default Output', isDefault: true }];
    }
    return invoke<AudioDeviceInfo[]>('get_audio_output_devices');
  },

  async setAudioOutputDevice(deviceName: string): Promise<AppSettings> {
    if (!isTauriRuntime()) return DEFAULT_SETTINGS;
    return invoke<AppSettings>('set_audio_output_device', { deviceName });
  },

  // --- Library ---
  async pickAndScanFolder(): Promise<ScanSummary | null> {
    if (!isTauriRuntime()) return null;
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Music Folder for Isla',
    });
    if (!selected || typeof selected !== 'string') {
      return null;
    }
    return invoke<ScanSummary>('add_and_scan_folder', { folderPath: selected });
  },

  async pickAndImportAudioFiles(): Promise<ScanSummary | null> {
    if (!isTauriRuntime()) return null;
    const selected = await open({
      directory: false,
      multiple: true,
      title: 'Import Audio Files into Isla',
      filters: [
        {
          name: 'Audio Files',
          extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus'],
        },
      ],
    });
    if (!selected) return null;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return null;
    return invoke<ScanSummary>('import_dropped_paths', {
      paths,
      autoPlay: false,
    });
  },

  async addAndScanFolderPath(folderPath: string): Promise<ScanSummary> {
    return invoke<ScanSummary>('add_and_scan_folder', { folderPath });
  },

  async importDroppedPaths(paths: string[], autoPlay = false): Promise<ScanSummary> {
    return invoke<ScanSummary>('import_dropped_paths', { paths, autoPlay });
  },

  async rescanLibrary(): Promise<ScanSummary> {
    if (!isTauriRuntime()) {
      return {
        addedOrUpdated: 0,
        skippedOrInvalid: 0,
        missingMarked: 0,
        totalLibraryTracks: 0,
      };
    }
    return invoke<ScanSummary>('rescan_library');
  },

  async removeLibraryFolder(
    folderId: number,
    removeTracks: boolean
  ): Promise<LibraryFolder[]> {
    if (!isTauriRuntime()) return [];
    return invoke<LibraryFolder[]>('remove_library_folder', {
      folderId,
      removeTracks,
    });
  },

  async removeMissingTracks(): Promise<number> {
    if (!isTauriRuntime()) return 0;
    return invoke<number>('remove_missing_tracks');
  },

  async getLibraryTracks(): Promise<Track[]> {
    if (!isTauriRuntime()) return [];
    return invoke<Track[]>('get_library_tracks');
  },

  async getAlbums(): Promise<AlbumSummary[]> {
    if (!isTauriRuntime()) return [];
    return invoke<AlbumSummary[]>('get_albums');
  },

  async getArtists(): Promise<ArtistSummary[]> {
    if (!isTauriRuntime()) return [];
    return invoke<ArtistSummary[]>('get_artists');
  },

  async getLibraryFolders(): Promise<LibraryFolder[]> {
    if (!isTauriRuntime()) return [];
    return invoke<LibraryFolder[]>('get_library_folders');
  },

  async getLibraryStats(): Promise<LibraryStats> {
    if (!isTauriRuntime()) return EMPTY_STATS;
    return invoke<LibraryStats>('get_library_stats');
  },

  async toggleFavorite(trackId: number): Promise<Track> {
    return invoke<Track>('toggle_favorite', { trackId });
  },

  // --- Playlists ---
  async getPlaylists(): Promise<Playlist[]> {
    if (!isTauriRuntime()) return [];
    return invoke<Playlist[]>('get_playlists');
  },

  async getPlaylistDetail(playlistId: number): Promise<PlaylistDetail> {
    return invoke<PlaylistDetail>('get_playlist_detail', { playlistId });
  },

  async createPlaylist(name: string, description?: string): Promise<Playlist> {
    return invoke<Playlist>('create_playlist', {
      name,
      description: description ?? '',
    });
  },

  async renamePlaylist(
    playlistId: number,
    name: string,
    description?: string
  ): Promise<Playlist> {
    return invoke<Playlist>('rename_playlist', {
      playlistId,
      name,
      description: description ?? '',
    });
  },

  async deletePlaylist(playlistId: number): Promise<Playlist[]> {
    return invoke<Playlist[]>('delete_playlist', { playlistId });
  },

  async addTrackToPlaylist(
    playlistId: number,
    trackId: number
  ): Promise<PlaylistDetail> {
    return invoke<PlaylistDetail>('add_track_to_playlist', {
      playlistId,
      trackId,
    });
  },

  async removeTrackFromPlaylist(
    playlistId: number,
    positionIndex: number
  ): Promise<PlaylistDetail> {
    return invoke<PlaylistDetail>('remove_track_from_playlist', {
      playlistId,
      positionIndex,
    });
  },

  async reorderPlaylistTracks(
    playlistId: number,
    fromIndex: number,
    toIndex: number
  ): Promise<PlaylistDetail> {
    return invoke<PlaylistDetail>('reorder_playlist_tracks', {
      playlistId,
      fromIndex,
      toIndex,
    });
  },

  // --- Settings ---
  async getSettings(): Promise<AppSettings> {
    if (!isTauriRuntime()) return DEFAULT_SETTINGS;
    return invoke<AppSettings>('get_settings');
  },

  async updateSettings(settings: AppSettings): Promise<AppSettings> {
    if (!isTauriRuntime()) return settings;
    return invoke<AppSettings>('update_settings', { settings });
  },

  // --- Event Subscriptions ---
  async onPlaybackState(
    handler: (snapshot: PlayerSnapshot) => void
  ): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<PlayerSnapshot>('isla://playback-state', (ev) => {
      handler(ev.payload);
    });
  },

  async onPlaybackError(handler: (errMsg: string) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<string>('isla://playback-error', (ev) => {
      handler(ev.payload);
    });
  },

  async onScanProgress(
    handler: (progress: ScanProgressPayload) => void
  ): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<ScanProgressPayload>('isla://scan-progress', (ev) => {
      handler(ev.payload);
    });
  },

  async onWindowMode(
    handler: (geom: WindowGeometryResult) => void
  ): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<WindowGeometryResult>('isla://window-mode', (ev) => {
      handler(ev.payload);
    });
  },

  async onSettingsUpdated(
    handler: (settings: AppSettings) => void
  ): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return listen<AppSettings>('isla://settings-updated', (ev) => {
      handler(ev.payload);
    });
  },

  async onFileDrop(
    handler: (paths: string[], phase: 'hover' | 'drop' | 'cancel') => void
  ): Promise<UnlistenFn> {
    if (!isTauriRuntime()) return () => {};
    return getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'over' || event.payload.type === 'enter') {
        handler([], 'hover');
      } else if (event.payload.type === 'drop') {
        handler(event.payload.paths, 'drop');
      } else {
        handler([], 'cancel');
      }
    });
  },
};
