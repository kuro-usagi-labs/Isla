export type RepeatMode = 'off' | 'all' | 'one';

export type ActiveTab =
  | 'queue'
  | 'songs'
  | 'albums'
  | 'artists'
  | 'playlists'
  | 'favorites'
  | 'settings';

export type SortField = 'title' | 'artist' | 'album' | 'duration' | 'dateAdded';
export type SortDirection = 'asc' | 'desc';

export interface Track {
  id: number;
  filePath: string;
  normalizedPath: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  trackNumber: number | null;
  year: number | null;
  durationSecs: number;
  format: string;
  bitrateKbps: number | null;
  sampleRateHz: number | null;
  bpm?: number | null;
  fileSizeBytes: number;
  artworkDataUrl: string | null;
  dominantColor: string | null;
  isFavorite: boolean;
  playCount?: number;
  dateAdded: number;
  fileMissing: boolean;
}

export interface AlbumSummary {
  name: string;
  artist: string;
  year: number | null;
  trackCount: number;
  totalDurationSecs: number;
  artworkDataUrl: string | null;
  dominantColor: string | null;
  trackIds: number[];
}

export interface ArtistSummary {
  name: string;
  albumCount: number;
  trackCount: number;
  totalDurationSecs: number;
  artworkDataUrl: string | null;
  trackIds: number[];
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  trackCount: number;
  totalDurationSecs: number;
  coverDataUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistDetail {
  playlist: Playlist;
  tracks: Track[];
}

export interface PlayerSnapshot {
  isPlaying: boolean;
  currentTrack: Track | null;
  outgoingTrack?: Track | null;
  positionSecs: number;
  durationSecs: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  crossfadeEnabled?: boolean;
  crossfadeSecs?: number;
  isCrossfading?: boolean;
  crossfadeProgress?: number;
  liveMixBpm?: number | null;
  queue: Track[];
  currentQueueIndex: number | null;
  outputDevice: string | null;
  lastError: string | null;
}

export interface PlayerProgress {
  trackId: number | null;
  positionSecs: number;
  isCrossfading: boolean;
  crossfadeProgress: number;
  liveMixBpm: number | null;
}

export interface IslandBounds {
  x: number; y: number; width: number; height: number; radius: number;
}

export interface LibraryFolder {
  id: number;
  path: string;
  trackCount: number;
  lastScanned: number | null;
}

export interface LibraryStats {
  totalTracks: number;
  totalAlbums: number;
  totalArtists: number;
  totalPlaylists: number;
  totalFavorites: number;
  totalDurationSecs: number;
  totalSizeBytes: number;
  missingTracks: number;
  folderCount: number;
}

export interface ScanProgressPayload {
  folderPath: string;
  scannedFiles: number;
  totalFiles: number;
  currentFile: string;
  done: boolean;
}

export interface ScanSummary {
  addedOrUpdated: number;
  skippedOrInvalid: number;
  missingMarked: number;
  totalLibraryTracks: number;
}

export interface AudioDeviceInfo {
  name: string;
  isDefault: boolean;
}

export interface EqualizerSettings {
  enabled: boolean;
  preset: string;
  preampDb: number;
  bandsDb: number[];
}

export interface AppSettings {
  equalizer: EqualizerSettings;
  theme: 'light' | 'dark' | 'system';
  glassIntensity: 'subtle' | 'balanced' | 'luminous';
  accentColor: string;
  dynamicArtworkAccent: boolean;
  reducedMotion: boolean;
  alwaysOnTop: boolean;
  pillSize: 'compact' | 'default' | 'large';
  startExpanded: boolean;
  rememberPosition: boolean;
  collapseOnBlur: boolean;
  showPillWaveform: boolean;
  beatPulse: boolean;
  outputDevice: string;
  defaultVolume: number;
  defaultShuffle: boolean;
  defaultRepeat: RepeatMode;
  crossfadeEnabled?: boolean;
  crossfadeSecs?: number;
  launchAtStartup: boolean;
  minimizeToTray: boolean;
  globalShortcutsEnabled: boolean;
  windowX: number | null;
  windowY: number | null;
}

export interface WindowGeometryResult {
  expanded: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorOffsetX: number;
  anchorOffsetY: number;
  isDragging: boolean;
}

export interface InitialBootstrapPayload {
  settings: AppSettings;
  player: PlayerSnapshot;
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: Playlist[];
  folders: LibraryFolder[];
  stats: LibraryStats;
  expanded: boolean;
  anchorOffsetX: number;
  anchorOffsetY: number;
}
