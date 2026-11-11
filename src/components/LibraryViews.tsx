import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Disc,
  Edit3,
  FolderPlus,
  Heart,
  ListMusic,
  Music,
  Play,
  Plus,
  Search,
  Shuffle,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ActiveTab,
  AlbumSummary,
  ArtistSummary,
  PlayerSnapshot,
  Playlist,
  PlaylistDetail,
  SortDirection,
  SortField,
  Track,
} from '../types/isla';
import { TrackRow } from './TrackRow';
import { ArtworkTile } from './ArtworkTile';
import {
  filterTracks,
  formatTotalHoursMinutes,
  hexToRgba,
  sortTracks,
} from '../utils/format';
import { islaBridge } from '../services/bridge';
import { getUpcomingQueue } from '../utils/interaction';

interface LibraryViewsProps {
  activeTab: ActiveTab;
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
  playlists: Playlist[];
  player: PlayerSnapshot;
  reducedMotion: boolean;
  accentColor: string;
  isScanning: boolean;
  onAddMusicFolder: () => void;
  onImportAudioFiles: () => void;
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
}

export const LibraryViews: React.FC<LibraryViewsProps> = ({
  activeTab,
  tracks,
  albums,
  artists,
  playlists,
  player,
  reducedMotion,
  accentColor,
  isScanning,
  onAddMusicFolder,
  onImportAudioFiles,
  onPlayTrackFromList,
  onPlayQueueIndex,
  onPlayNext,
  onAddToQueue,
  onRemoveFromQueue,
  onReorderQueue,
  onClearQueue,
  onToggleFavorite,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onAddTrackToPlaylist,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('title');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [visibleLimit, setVisibleLimit] = useState(80);
  const upcoming = useMemo(() => getUpcomingQueue(player), [player.queue, player.currentQueueIndex, player.shuffle, player.repeatMode]);

  // Drill-down subviews
  const [selectedAlbumName, setSelectedAlbumName] = useState<string | null>(null);
  const [selectedArtistName, setSelectedArtistName] = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [playlistDetail, setPlaylistDetail] = useState<PlaylistDetail | null>(null);

  // Playlist creation / rename inline state
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [pendingTrackForNewPlaylist, setPendingTrackForNewPlaylist] = useState<
    number | undefined
  >(undefined);
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    setVisibleLimit(80);
  }, [activeTab, searchQuery, sortField, sortDir]);

  useEffect(() => {
    if (selectedPlaylistId !== null) {
      void islaBridge
        .getPlaylistDetail(selectedPlaylistId)
        .then(setPlaylistDetail)
        .catch(() => setSelectedPlaylistId(null));
    } else {
      setPlaylistDetail(null);
    }
  }, [selectedPlaylistId, playlists, tracks]);

  const filteredAndSortedTracks = useMemo(() => {
    const filtered = filterTracks(tracks, searchQuery);
    return sortTracks(filtered, sortField, sortDir);
  }, [tracks, searchQuery, sortField, sortDir]);

  const favoriteTracks = useMemo(
    () => tracks.filter((t) => t.isFavorite),
    [tracks]
  );

  const handleOpenNewPlaylistWithTrack = (trackId: number) => {
    setPendingTrackForNewPlaylist(trackId);
    setCreatingPlaylist(true);
    setNewPlaylistName('');
  };

  const handleConfirmCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    await onCreatePlaylist(trimmed, pendingTrackForNewPlaylist);
    setCreatingPlaylist(false);
    setNewPlaylistName('');
    setPendingTrackForNewPlaylist(undefined);
  };

  // --- Empty Library First-Run State ---
  const renderEmptyLibraryPrompt = () => (
    <div className="flex flex-col items-center justify-center text-center px-6 py-10">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-sm"
        style={{
          backgroundColor: hexToRgba(accentColor, 0.12),
          color: accentColor,
        }}
      >
        <Music size={22} strokeWidth={1.9} />
      </div>
      <h3
        className="text-[15px] font-semibold"
        style={{ color: 'var(--isla-text-primary)' }}
      >
        Your Isla Library is Empty
      </h3>
      <p
        className="text-[12.5px] leading-relaxed mt-1 max-w-[280px]"
        style={{ color: 'var(--isla-text-secondary)' }}
      >
        Select a local music folder or drop audio files anywhere on Isla to index
        your songs, artwork, and albums offline.
      </p>
      <div className="flex items-center gap-2.5 mt-4">
        <button
          type="button"
          disabled={isScanning}
          onClick={onAddMusicFolder}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12.5px] font-semibold text-white shadow-sm transition-transform active:scale-96 cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
        >
          <FolderPlus size={14} />
          <span>{isScanning ? 'Scanning...' : 'Add Music Folder'}</span>
        </button>
        <button
          type="button"
          disabled={isScanning}
          onClick={onImportAudioFiles}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12.5px] font-medium transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
          style={{
            backgroundColor: 'var(--isla-bg-subtle)',
            color: 'var(--isla-text-primary)',
          }}
        >
          <Plus size={14} />
          <span>Import Files</span>
        </button>
      </div>
    </div>
  );

  // --- Inline Quick Create Playlist Modal Banner ---
  const renderInlineCreatePlaylistBanner = () => {
    if (!creatingPlaylist) return null;
    return (
      <form
        onSubmit={handleConfirmCreatePlaylist}
        className="mx-4 mt-2.5 mb-1 p-2.5 rounded-2xl flex items-center gap-2 border"
        style={{
          backgroundColor: 'var(--isla-bg-subtle)',
          borderColor: 'var(--isla-divider)',
        }}
      >
        <input
          type="text"
          autoFocus
          value={newPlaylistName}
          onChange={(e) => setNewPlaylistName(e.target.value)}
          placeholder="Playlist name..."
          className="flex-1 bg-transparent text-[13px] px-2 py-1 rounded-lg focus:outline-none"
          style={{ color: 'var(--isla-text-primary)' }}
        />
        <button
          type="submit"
          className="px-3 py-1 rounded-full text-[12px] font-semibold text-white cursor-pointer"
          style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => {
            setCreatingPlaylist(false);
            setPendingTrackForNewPlaylist(undefined);
          }}
          className="p-1 rounded-full hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
          style={{ color: 'var(--isla-text-secondary)' }}
        >
          <X size={14} />
        </button>
      </form>
    );
  };

  // 1. QUEUE VIEW (Matches the supplied reference image tracklist directly below Now Playing)
  if (activeTab === 'queue') {
    if (player.queue.length === 0) {
      return tracks.length === 0 ? (
        renderEmptyLibraryPrompt()
      ) : (
        <div className="flex flex-col items-center justify-center text-center px-6 py-10">
          <ListMusic
            size={24}
            className="mb-2 opacity-45"
            style={{ color: 'var(--isla-text-secondary)' }}
          />
          <p
            className="text-[13.5px] font-semibold"
            style={{ color: 'var(--isla-text-primary)' }}
          >
            Playback Queue is Empty
          </p>
          <p
            className="text-[12px] mt-1 max-w-[250px]"
            style={{ color: 'var(--isla-text-secondary)' }}
          >
            Play any song from your library or click below to queue all tracks.
          </p>
          <button
            type="button"
            onClick={() => {
              if (tracks.length > 0) {
                onPlayTrackFromList(
                  tracks[0].id,
                  tracks.map((t) => t.id)
                );
              }
            }}
            className="mt-3.5 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12.5px] font-semibold text-white cursor-pointer"
            style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
          >
            <Play size={13} fill="currentColor" />
            <span>Play Library ({tracks.length})</span>
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col pb-2">
        {renderInlineCreatePlaylistBanner()}
        <div>
          {upcoming.map(({ track, index: idx }) => (
            <TrackRow
              dense
              key={`${track.id}-${idx}`}
              track={track}
              isActive={player.currentQueueIndex === idx}
              isPlaying={player.isPlaying && player.currentQueueIndex === idx}
              reducedMotion={reducedMotion}
              accentColor={accentColor}
              playlists={playlists}
              contextType="queue"
              index={idx}
              totalCount={player.queue.length}
              onPlay={() => onPlayQueueIndex(idx)}
              onPlayNext={onPlayNext}
              onAddToQueue={onAddToQueue}
              onToggleFavorite={onToggleFavorite}
              onAddToPlaylist={onAddTrackToPlaylist}
              onCreatePlaylistWithTrack={handleOpenNewPlaylistWithTrack}
              onRemoveFromList={() => onRemoveFromQueue(idx)}
              onMoveUp={
                idx > 0 ? () => onReorderQueue(idx, idx - 1) : undefined
              }
              onMoveDown={
                idx + 1 < player.queue.length
                  ? () => onReorderQueue(idx, idx + 1)
                  : undefined
              }
            />
          ))}
          {upcoming.length === 0 && <div className="px-6 py-6 text-center text-[12px]" style={{ color: 'var(--isla-text-secondary)' }}>You’re all caught up. Add another song from your library.</div>}
        </div>
        {player.queue.length > 1 && (
          <div
            className="flex items-center justify-between px-6 py-2.5 text-[11.5px] font-medium"
            style={{ color: 'var(--isla-text-secondary)' }}
          >
            <span>
              {player.queue.length} songs in queue
            </span>
            <button
              type="button"
              onClick={onClearQueue}
              className="px-2.5 py-0.5 rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
              style={{ color: 'var(--isla-text-secondary)' }}
            >
              Clear Queue
            </button>
          </div>
        )}
      </div>
    );
  }

  // 2. SONGS VIEW
  if (activeTab === 'songs') {
    if (tracks.length === 0) {
      return renderEmptyLibraryPrompt();
    }

    const visibleTracks = filteredAndSortedTracks.slice(0, visibleLimit);

    return (
      <div className="flex flex-col">
        {renderInlineCreatePlaylistBanner()}
        {/* Search & Sort Controls */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-b"
          style={{ borderColor: 'var(--isla-divider)' }}
        >
          <div
            className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-full text-[12.5px]"
            style={{ backgroundColor: 'var(--isla-bg-subtle)' }}
          >
            <Search size={13.5} style={{ color: 'var(--isla-text-secondary)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${tracks.length} songs...`}
              className="w-full bg-transparent focus:outline-none text-[12.5px]"
              style={{ color: 'var(--isla-text-primary)' }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="opacity-60 hover:opacity-100 cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <select
            value={`${sortField}:${sortDir}`}
            onChange={(e) => {
              const [f, d] = e.target.value.split(':') as [
                SortField,
                SortDirection,
              ];
              setSortField(f);
              setSortDir(d);
            }}
            aria-label="Sort songs"
            className="px-2.5 py-1.5 rounded-full text-[11.5px] font-medium cursor-pointer border-0"
            style={{
              backgroundColor: 'var(--isla-bg-subtle)',
              color: 'var(--isla-text-primary)',
            }}
          >
            <option value="title:asc">Title A–Z</option>
            <option value="artist:asc">Artist A–Z</option>
            <option value="album:asc">Album A–Z</option>
            <option value="duration:desc">Longest</option>
            <option value="dateAdded:desc">Recently Added</option>
          </select>
        </div>

        {/* Quick Play / Shuffle bar */}
        {filteredAndSortedTracks.length > 0 && (
          <div
            className="flex items-center justify-between px-5 py-2 border-b text-[12px]"
            style={{ borderColor: 'var(--isla-divider)' }}
          >
            <span style={{ color: 'var(--isla-text-secondary)' }}>
              {filteredAndSortedTracks.length}{' '}
              {filteredAndSortedTracks.length === 1 ? 'song' : 'songs'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const ids = filteredAndSortedTracks.map((t) => t.id);
                  if (ids.length > 0) {
                    onPlayTrackFromList(ids[0], ids);
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer"
                style={{ color: accentColor }}
              >
                <Play size={12} fill="currentColor" />
                <span>Play All</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids = filteredAndSortedTracks.map((t) => t.id);
                  if (ids.length > 0) {
                    const randomIndex = Math.floor(Math.random() * ids.length);
                    void islaBridge.setShuffle(true);
                    onPlayTrackFromList(ids[randomIndex], ids);
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer"
                style={{ color: 'var(--isla-text-primary)' }}
              >
                <Shuffle size={12} />
                <span>Shuffle</span>
              </button>
            </div>
          </div>
        )}

        {visibleTracks.length === 0 ? (
          <div
            className="py-10 text-center text-[13px]"
            style={{ color: 'var(--isla-text-secondary)' }}
          >
            No songs matching “{searchQuery}”
          </div>
        ) : (
          <div>
            {visibleTracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                isActive={player.currentTrack?.id === track.id}
                isPlaying={
                  player.isPlaying && player.currentTrack?.id === track.id
                }
                reducedMotion={reducedMotion}
                accentColor={accentColor}
                playlists={playlists}
                contextType="library"
                onPlay={() =>
                  onPlayTrackFromList(
                    track.id,
                    filteredAndSortedTracks.map((t) => t.id)
                  )
                }
                onPlayNext={onPlayNext}
                onAddToQueue={onAddToQueue}
                onToggleFavorite={onToggleFavorite}
                onAddToPlaylist={onAddTrackToPlaylist}
                onCreatePlaylistWithTrack={handleOpenNewPlaylistWithTrack}
              />
            ))}
            {filteredAndSortedTracks.length > visibleLimit && (
              <div className="p-3 text-center">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((l) => l + 80)}
                  className="px-4 py-1.5 rounded-full text-[12px] font-medium cursor-pointer"
                  style={{
                    backgroundColor: 'var(--isla-bg-subtle)',
                    color: 'var(--isla-text-primary)',
                  }}
                >
                  Show more ({filteredAndSortedTracks.length - visibleLimit}{' '}
                  remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // 3. ALBUMS VIEW
  if (activeTab === 'albums') {
    if (tracks.length === 0) {
      return renderEmptyLibraryPrompt();
    }

    const activeAlbum = selectedAlbumName
      ? albums.find((a) => a.name === selectedAlbumName)
      : null;

    if (activeAlbum) {
      const albumTracks = tracks.filter((t) =>
        activeAlbum.trackIds.includes(t.id)
      );
      return (
        <div className="flex flex-col">
          {renderInlineCreatePlaylistBanner()}
          <div
            className="flex items-center gap-3 px-4 py-3 border-b"
            style={{ borderColor: 'var(--isla-divider)' }}
          >
            <button
              type="button"
              onClick={() => setSelectedAlbumName(null)}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
              style={{ color: 'var(--isla-text-primary)' }}
              aria-label="Back to albums"
            >
              <ArrowLeft size={16} />
            </button>
            <ArtworkTile
              artworkDataUrl={activeAlbum.artworkDataUrl}
              title={activeAlbum.name}
              dominantColor={activeAlbum.dominantColor ?? accentColor}
              sizeClass="w-12 h-12"
              roundedClass="rounded-xl"
              iconSize={20}
            />
            <div className="flex-1 min-w-0">
              <h4
                className="text-[14.5px] font-semibold truncate"
                style={{ color: 'var(--isla-text-primary)' }}
              >
                {activeAlbum.name}
              </h4>
              <p
                className="text-[12px] truncate"
                style={{ color: 'var(--isla-text-secondary)' }}
              >
                {activeAlbum.artist} · {activeAlbum.trackCount}{' '}
                {activeAlbum.trackCount === 1 ? 'song' : 'songs'} ·{' '}
                {formatTotalHoursMinutes(activeAlbum.totalDurationSecs)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (activeAlbum.trackIds.length > 0) {
                  onPlayTrackFromList(
                    activeAlbum.trackIds[0],
                    activeAlbum.trackIds
                  );
                }
              }}
              className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-sm cursor-pointer"
              style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
              aria-label={`Play album ${activeAlbum.name}`}
            >
              <Play size={15} fill="currentColor" className="ml-0.5" />
            </button>
          </div>
          <div>
            {albumTracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                isActive={player.currentTrack?.id === track.id}
                isPlaying={
                  player.isPlaying && player.currentTrack?.id === track.id
                }
                reducedMotion={reducedMotion}
                accentColor={accentColor}
                playlists={playlists}
                contextType="library"
                onPlay={() =>
                  onPlayTrackFromList(track.id, activeAlbum.trackIds)
                }
                onPlayNext={onPlayNext}
                onAddToQueue={onAddToQueue}
                onToggleFavorite={onToggleFavorite}
                onAddToPlaylist={onAddTrackToPlaylist}
                onCreatePlaylistWithTrack={handleOpenNewPlaylistWithTrack}
              />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-3 p-4">
        {albums.map((album) => (
          <button
            key={`${album.name}-${album.artist}`}
            type="button"
            onClick={() => setSelectedAlbumName(album.name)}
            className="group flex flex-col text-left p-2.5 rounded-2xl transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.06] cursor-pointer"
          >
            <div className="relative w-full aspect-square mb-2 flex items-center justify-center">
              <ArtworkTile
                artworkDataUrl={album.artworkDataUrl}
                title={album.name}
                dominantColor={album.dominantColor ?? accentColor}
                sizeClass="w-full h-full"
                roundedClass="rounded-xl"
                iconSize={32}
              />
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  if (album.trackIds.length > 0) {
                    onPlayTrackFromList(album.trackIds[0], album.trackIds);
                  }
                }}
                className="absolute bottom-2 right-2 w-8 h-8 rounded-full flex items-center justify-center text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
              >
                <Play size={14} fill="currentColor" className="ml-0.5" />
              </span>
            </div>
            <span
              className="text-[13.5px] font-semibold truncate w-full"
              style={{ color: 'var(--isla-text-primary)' }}
            >
              {album.name}
            </span>
            <span
              className="text-[11.5px] truncate w-full mt-0.5"
              style={{ color: 'var(--isla-text-secondary)' }}
            >
              {album.artist} · {album.trackCount}{' '}
              {album.trackCount === 1 ? 'track' : 'tracks'}
            </span>
          </button>
        ))}
      </div>
    );
  }

  // 4. ARTISTS VIEW
  if (activeTab === 'artists') {
    if (tracks.length === 0) {
      return renderEmptyLibraryPrompt();
    }

    const activeArtist = selectedArtistName
      ? artists.find((a) => a.name === selectedArtistName)
      : null;

    if (activeArtist) {
      const artistTracks = tracks.filter((t) =>
        activeArtist.trackIds.includes(t.id)
      );
      return (
        <div className="flex flex-col">
          {renderInlineCreatePlaylistBanner()}
          <div
            className="flex items-center gap-3 px-4 py-3 border-b"
            style={{ borderColor: 'var(--isla-divider)' }}
          >
            <button
              type="button"
              onClick={() => setSelectedArtistName(null)}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
              style={{ color: 'var(--isla-text-primary)' }}
              aria-label="Back to artists"
            >
              <ArrowLeft size={16} />
            </button>
            <ArtworkTile
              artworkDataUrl={activeArtist.artworkDataUrl}
              title={activeArtist.name}
              dominantColor={accentColor}
              sizeClass="w-11 h-11"
              roundedClass="rounded-full"
              iconSize={18}
            />
            <div className="flex-1 min-w-0">
              <h4
                className="text-[14.5px] font-semibold truncate"
                style={{ color: 'var(--isla-text-primary)' }}
              >
                {activeArtist.name}
              </h4>
              <p
                className="text-[12px]"
                style={{ color: 'var(--isla-text-secondary)' }}
              >
                {activeArtist.albumCount}{' '}
                {activeArtist.albumCount === 1 ? 'album' : 'albums'} ·{' '}
                {activeArtist.trackCount}{' '}
                {activeArtist.trackCount === 1 ? 'song' : 'songs'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (activeArtist.trackIds.length > 0) {
                  onPlayTrackFromList(
                    activeArtist.trackIds[0],
                    activeArtist.trackIds
                  );
                }
              }}
              className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-sm cursor-pointer"
              style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
              aria-label={`Play ${activeArtist.name}`}
            >
              <Play size={15} fill="currentColor" className="ml-0.5" />
            </button>
          </div>
          <div>
            {artistTracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                isActive={player.currentTrack?.id === track.id}
                isPlaying={
                  player.isPlaying && player.currentTrack?.id === track.id
                }
                reducedMotion={reducedMotion}
                accentColor={accentColor}
                playlists={playlists}
                contextType="library"
                onPlay={() =>
                  onPlayTrackFromList(track.id, activeArtist.trackIds)
                }
                onPlayNext={onPlayNext}
                onAddToQueue={onAddToQueue}
                onToggleFavorite={onToggleFavorite}
                onAddToPlaylist={onAddTrackToPlaylist}
                onCreatePlaylistWithTrack={handleOpenNewPlaylistWithTrack}
              />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="divide-y" style={{ borderColor: 'var(--isla-divider)' }}>
        {artists.map((artist) => (
          <div
            key={artist.name}
            onClick={() => setSelectedArtistName(artist.name)}
            className="flex items-center justify-between px-5 py-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
            style={{ borderColor: 'var(--isla-divider)' }}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <ArtworkTile
                artworkDataUrl={artist.artworkDataUrl}
                title={artist.name}
                dominantColor={accentColor}
                sizeClass="w-11 h-11"
                roundedClass="rounded-full"
                iconSize={18}
              />
              <div className="min-w-0">
                <div
                  className="text-[14px] font-semibold truncate"
                  style={{ color: 'var(--isla-text-primary)' }}
                >
                  {artist.name}
                </div>
                <div
                  className="text-[12px] mt-0.5"
                  style={{ color: 'var(--isla-text-secondary)' }}
                >
                  {artist.albumCount}{' '}
                  {artist.albumCount === 1 ? 'album' : 'albums'} ·{' '}
                  {artist.trackCount}{' '}
                  {artist.trackCount === 1 ? 'song' : 'songs'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (artist.trackIds.length > 0) {
                  onPlayTrackFromList(artist.trackIds[0], artist.trackIds);
                }
              }}
              aria-label={`Play all songs by ${artist.name}`}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
              style={{ color: accentColor }}
            >
              <Play size={14} fill="currentColor" className="ml-0.5" />
            </button>
          </div>
        ))}
      </div>
    );
  }

  // 5. PLAYLISTS VIEW
  if (activeTab === 'playlists') {
    if (playlistDetail) {
      const pl = playlistDetail.playlist;
      const plTracks = playlistDetail.tracks;
      const plTrackIds = plTracks.map((t) => t.id);

      return (
        <div className="flex flex-col">
          <div
            className="flex items-center gap-3 px-4 py-3 border-b"
            style={{ borderColor: 'var(--isla-divider)' }}
          >
            <button
              type="button"
              onClick={() => setSelectedPlaylistId(null)}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
              style={{ color: 'var(--isla-text-primary)' }}
              aria-label="Back to playlists"
            >
              <ArrowLeft size={16} />
            </button>
            <ArtworkTile
              artworkDataUrl={pl.coverDataUrl}
              title={pl.name}
              dominantColor={accentColor}
              sizeClass="w-11 h-11"
              roundedClass="rounded-xl"
              iconSize={18}
            />
            <div className="flex-1 min-w-0">
              {renamingPlaylistId === pl.id ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (renameDraft.trim()) {
                      await onRenamePlaylist(pl.id, renameDraft.trim());
                      const updated = await islaBridge.getPlaylistDetail(pl.id);
                      setPlaylistDetail(updated);
                    }
                    setRenamingPlaylistId(null);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    className="w-full px-2 py-0.5 rounded-lg text-[13.5px] font-semibold bg-black/[0.05] dark:bg-white/[0.08] focus:outline-none"
                    style={{ color: 'var(--isla-text-primary)' }}
                  />
                  <button
                    type="submit"
                    className="p-1 rounded-md text-emerald-600 cursor-pointer"
                    aria-label="Save playlist name"
                  >
                    <Check size={14} />
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-1.5 min-w-0">
                  <h4
                    className="text-[14.5px] font-semibold truncate"
                    style={{ color: 'var(--isla-text-primary)' }}
                  >
                    {pl.name}
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingPlaylistId(pl.id);
                      setRenameDraft(pl.name);
                    }}
                    className="p-1 rounded-md opacity-60 hover:opacity-100 cursor-pointer"
                    title="Rename playlist"
                  >
                    <Edit3 size={12.5} />
                  </button>
                </div>
              )}
              <p
                className="text-[12px]"
                style={{ color: 'var(--isla-text-secondary)' }}
              >
                {plTracks.length} {plTracks.length === 1 ? 'song' : 'songs'} ·{' '}
                {formatTotalHoursMinutes(pl.totalDurationSecs)}
              </p>
            </div>
            {plTracks.length > 0 && (
              <button
                type="button"
                onClick={() => onPlayTrackFromList(plTrackIds[0], plTrackIds)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white shadow-sm cursor-pointer"
                style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
                aria-label={`Play playlist ${pl.name}`}
              >
                <Play size={15} fill="currentColor" className="ml-0.5" />
              </button>
            )}
          </div>

          {plTracks.length === 0 ? (
            <div
              className="py-10 px-6 text-center text-[12.5px]"
              style={{ color: 'var(--isla-text-secondary)' }}
            >
              This playlist is empty. Use the <strong>•••</strong> menu on any
              song to add tracks here.
            </div>
          ) : (
            <div>
              {plTracks.map((track, idx) => (
                <TrackRow
                  key={`${track.id}-${idx}`}
                  track={track}
                  isActive={player.currentTrack?.id === track.id}
                  isPlaying={
                    player.isPlaying && player.currentTrack?.id === track.id
                  }
                  reducedMotion={reducedMotion}
                  accentColor={accentColor}
                  playlists={playlists}
                  contextType="playlist"
                  index={idx}
                  totalCount={plTracks.length}
                  onPlay={() => onPlayTrackFromList(track.id, plTrackIds)}
                  onPlayNext={onPlayNext}
                  onAddToQueue={onAddToQueue}
                  onToggleFavorite={onToggleFavorite}
                  onAddToPlaylist={onAddTrackToPlaylist}
                  onRemoveFromList={async () => {
                    const updated = await islaBridge.removeTrackFromPlaylist(
                      pl.id,
                      idx
                    );
                    setPlaylistDetail(updated);
                  }}
                  onMoveUp={
                    idx > 0
                      ? async () => {
                          const updated =
                            await islaBridge.reorderPlaylistTracks(
                              pl.id,
                              idx,
                              idx - 1
                            );
                          setPlaylistDetail(updated);
                        }
                      : undefined
                  }
                  onMoveDown={
                    idx + 1 < plTracks.length
                      ? async () => {
                          const updated =
                            await islaBridge.reorderPlaylistTracks(
                              pl.id,
                              idx,
                              idx + 1
                            );
                          setPlaylistDetail(updated);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col">
        <div
          className="flex items-center justify-between px-5 py-2.5 border-b"
          style={{ borderColor: 'var(--isla-divider)' }}
        >
          <span
            className="text-[12.5px] font-medium"
            style={{ color: 'var(--isla-text-secondary)' }}
          >
            {playlists.length}{' '}
            {playlists.length === 1 ? 'playlist' : 'playlists'}
          </span>
          <button
            type="button"
            onClick={() => {
              setCreatingPlaylist(true);
              setNewPlaylistName('');
            }}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[12px] font-semibold text-white cursor-pointer"
            style={{ backgroundColor: accentColor, color: 'var(--isla-accent-ink)' }}
          >
            <Plus size={13} />
            <span>New Playlist</span>
          </button>
        </div>

        {renderInlineCreatePlaylistBanner()}

        {playlists.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center px-6 py-10">
            <Disc
              size={24}
              className="mb-2 opacity-45"
              style={{ color: 'var(--isla-text-secondary)' }}
            />
            <p
              className="text-[13.5px] font-semibold"
              style={{ color: 'var(--isla-text-primary)' }}
            >
              No Playlists Yet
            </p>
            <p
              className="text-[12px] mt-1 max-w-[240px]"
              style={{ color: 'var(--isla-text-secondary)' }}
            >
              Create custom offline playlists and reorder songs anytime.
            </p>
          </div>
        ) : (
          <div
            className="divide-y"
            style={{ borderColor: 'var(--isla-divider)' }}
          >
            {playlists.map((pl) => (
              <div
                key={pl.id}
                onClick={() => setSelectedPlaylistId(pl.id)}
                className="flex items-center justify-between px-5 py-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
                style={{ borderColor: 'var(--isla-divider)' }}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <ArtworkTile
                    artworkDataUrl={pl.coverDataUrl}
                    title={pl.name}
                    dominantColor={accentColor}
                    sizeClass="w-11 h-11"
                    roundedClass="rounded-xl"
                    iconSize={18}
                  />
                  <div className="min-w-0">
                    <div
                      className="text-[14px] font-semibold truncate"
                      style={{ color: 'var(--isla-text-primary)' }}
                    >
                      {pl.name}
                    </div>
                    <div
                      className="text-[12px] mt-0.5"
                      style={{ color: 'var(--isla-text-secondary)' }}
                    >
                      {pl.trackCount} {pl.trackCount === 1 ? 'song' : 'songs'} ·{' '}
                      {formatTotalHoursMinutes(pl.totalDurationSecs)}
                    </div>
                  </div>
                </div>
                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => void onDeletePlaylist(pl.id)}
                    aria-label={`Delete playlist ${pl.name}`}
                    title="Delete playlist"
                    className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-rose-500/10 text-rose-500 cursor-pointer"
                  >
                    <Trash2 size={13.5} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 6. FAVORITES VIEW
  if (activeTab === 'favorites') {
    if (favoriteTracks.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center text-center px-6 py-10">
          <Heart
            size={24}
            className="mb-2 text-rose-500 opacity-65"
            strokeWidth={1.9}
          />
          <p
            className="text-[13.5px] font-semibold"
            style={{ color: 'var(--isla-text-primary)' }}
          >
            No Favorite Songs Yet
          </p>
          <p
            className="text-[12px] mt-1 max-w-[240px]"
            style={{ color: 'var(--isla-text-secondary)' }}
          >
            Tap the heart icon on the Now Playing card or in any track’s menu to
            collect your favorite songs here.
          </p>
        </div>
      );
    }

    const favIds = favoriteTracks.map((t) => t.id);

    return (
      <div className="flex flex-col">
        {renderInlineCreatePlaylistBanner()}
        <div
          className="flex items-center justify-between px-5 py-2 border-b text-[12px]"
          style={{ borderColor: 'var(--isla-divider)' }}
        >
          <span style={{ color: 'var(--isla-text-secondary)' }}>
            {favoriteTracks.length}{' '}
            {favoriteTracks.length === 1 ? 'favorite song' : 'favorite songs'}
          </span>
          <button
            type="button"
            onClick={() => onPlayTrackFromList(favIds[0], favIds)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer"
            style={{ color: accentColor }}
          >
            <Play size={12} fill="currentColor" />
            <span>Play Favorites</span>
          </button>
        </div>
        <div>
          {favoriteTracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              isActive={player.currentTrack?.id === track.id}
              isPlaying={
                player.isPlaying && player.currentTrack?.id === track.id
              }
              reducedMotion={reducedMotion}
              accentColor={accentColor}
              playlists={playlists}
              contextType="library"
              onPlay={() => onPlayTrackFromList(track.id, favIds)}
              onPlayNext={onPlayNext}
              onAddToQueue={onAddToQueue}
              onToggleFavorite={onToggleFavorite}
              onAddToPlaylist={onAddTrackToPlaylist}
              onCreatePlaylistWithTrack={handleOpenNewPlaylistWithTrack}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
};
