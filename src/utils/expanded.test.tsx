import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ExpandedPlayer, type ExpandedPlayerProps } from '../components/ExpandedPlayer';
import { islaBridge } from '../services/bridge';
import type { Track } from '../types/isla';

it('opens on Now Playing with the queue unmounted until its drawer is requested', async () => {
  const initial = await islaBridge.getInitialAppState();
  const track: Track = { id: 1, title: 'Current song', artist: 'Artist', album: 'Album', albumArtist: '', genre: '', filePath: '', normalizedPath: '', trackNumber: null, year: null, durationSecs: 200, format: 'MP3', bitrateKbps: null, sampleRateHz: null, fileSizeBytes: 0, artworkDataUrl: null, dominantColor: null, isFavorite: false, dateAdded: 0, fileMissing: false };
  const noop = () => {};
  const asyncNoop = async () => {};
  const props: ExpandedPlayerProps = {
    ...initial, player: { ...initial.player, currentTrack: track, queue: [track, { ...track, id: 2, title: 'Future song only in drawer' }], currentQueueIndex: 0 },
    activeTab: 'queue', accentColor: '#5367D6', outputDevices: [], isExpanded: true, anchorRatioX: 0.5, anchorRatioY: 0,
    scanProgress: null, statusBanner: null, onSelectTab: noop, onCollapse: noop, onTogglePlayPause: noop, onNextTrack: noop, onPreviousTrack: noop,
    onSeek: noop, onSetVolume: noop, onToggleMute: noop, onToggleShuffle: noop, onCycleRepeat: noop, onCycleCrossfade: noop,
    onPlayTrackFromList: noop, onPlayQueueIndex: noop, onPlayNext: noop, onAddToQueue: noop, onRemoveFromQueue: noop, onReorderQueue: noop, onClearQueue: noop,
    onToggleFavorite: noop, onCreatePlaylist: asyncNoop, onRenamePlaylist: asyncNoop, onDeletePlaylist: asyncNoop, onAddTrackToPlaylist: asyncNoop,
    onAddMusicFolder: noop, onImportAudioFiles: noop, onRescanLibrary: noop, onRemoveFolder: noop, onCleanMissingTracks: noop, onUpdateSettings: asyncNoop,
    onMinimizeToTray: noop, onQuitApplication: noop,
  };
  const html = renderToStaticMarkup(<ExpandedPlayer {...props} />);
  expect(html).toContain('aria-label="Now Playing"');
  expect(html).toContain('data-expanded-play="true"');
  expect(html).toContain('aria-label="Up Next"');
  expect(html).toContain('aria-label="Equalizer"');
  expect(html).not.toContain('Future song only in drawer');
  expect(html).not.toContain('id="isla-player-drawer"');
});
