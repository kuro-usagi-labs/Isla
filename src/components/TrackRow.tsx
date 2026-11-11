import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Heart,
  Info,
  ListEnd,
  ListPlus,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import type { Playlist, Track } from '../types/isla';
import { ArtworkTile } from './ArtworkTile';
import { WaveformBars } from './WaveformBars';
import { formatDuration, formatFileSize, hexToRgba } from '../utils/format';

interface TrackRowProps {
  track: Track;
  isActive: boolean;
  isPlaying: boolean;
  reducedMotion: boolean;
  accentColor: string;
  playlists: Playlist[];
  contextType?: 'queue' | 'library' | 'playlist';
  index?: number;
  totalCount?: number;
  dense?: boolean;
  onPlay: () => void;
  onPlayNext: (trackId: number) => void;
  onAddToQueue: (trackId: number) => void;
  onToggleFavorite: (trackId: number) => void;
  onAddToPlaylist: (playlistId: number, trackId: number) => void;
  onCreatePlaylistWithTrack?: (trackId: number) => void;
  onRemoveFromList?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  isActive,
  isPlaying,
  reducedMotion,
  accentColor,
  playlists,
  contextType = 'queue',
  index = 0,
  totalCount = 1,
  dense = false,
  onPlay,
  onPlayNext,
  onAddToQueue,
  onToggleFavorite,
  onAddToPlaylist,
  onCreatePlaylistWithTrack,
  onRemoveFromList,
  onMoveUp,
  onMoveDown,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPlaylistSub, setShowPlaylistSub] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setShowPlaylistSub(false);
        setShowDetails(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const subtitle = track.album
    ? `${track.artist} - ${track.album}`
    : track.artist;

  return (
    <div
      className={`group relative flex items-center transition-colors duration-150 border-b last:border-b-0 cursor-pointer ${dense ? 'isla-queue-row gap-2.5 px-5 py-2' : 'gap-3.5 px-5 py-2.5'}`}
      style={{
        borderColor: 'var(--isla-divider)',
        backgroundColor: isActive
          ? hexToRgba(accentColor, 0.055)
          : undefined,
      }}
      onClick={() => {
        if (!menuOpen) {
          onPlay();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(true);
      }}
    >
      {/* Hover overlay */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-black/[0.02] dark:bg-white/[0.03]" />

      {/* Left: Album Thumbnail (48x48 rounded-[11px] matching Apple Music reference) */}
      <div className="relative shrink-0">
        {dense && <button type="button" className="absolute inset-0 z-10 rounded-[11px] cursor-pointer" aria-label={`Play ${track.title}`} onClick={(e) => { e.stopPropagation(); onPlay(); }} />}
        <ArtworkTile
          artworkDataUrl={track.artworkDataUrl}
          title={track.title}
          dominantColor={track.dominantColor ?? accentColor}
          sizeClass={dense ? 'w-9 h-9' : 'w-[48px] h-[48px]'}
          roundedClass="rounded-[11px]"
          iconSize={20}
          isPlaying={isActive && isPlaying}
        />
        {isActive && (
          <div className="absolute inset-0 rounded-[12px] bg-black/28 backdrop-blur-[1px] flex items-center justify-center">
            <WaveformBars
              isPlaying={isPlaying}
              reducedMotion={reducedMotion}
              color="#ffffff"
              size="sm"
            />
          </div>
        )}
      </div>

      {/* Middle: Song Title & Artist - Album */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`${dense ? 'text-[13px] font-medium' : 'text-[15.5px] font-bold'} tracking-[-0.016em] leading-snug truncate`}
            style={{
              color: isActive ? accentColor : 'var(--isla-text-primary)',
            }}
          >
            {track.title}
          </span>
          {track.isFavorite && (
            <Heart
              size={11.5}
              className="shrink-0 text-rose-500"
              fill="currentColor"
            />
          )}
          {!dense && (track.playCount ?? 0) >= 2 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.2 rounded-full shrink-0 isla-tabular"
              style={{
                backgroundColor: hexToRgba(accentColor, 0.11),
                color: accentColor,
              }}
              title={`Played ${track.playCount} times`}
            >
              {track.playCount}×
            </span>
          )}
          {!dense && track.bpm && (
            <span
              className="text-[10px] font-semibold shrink-0 isla-tabular opacity-60"
              style={{ color: 'var(--isla-text-muted)' }}
              title={`Detected Tempo: ${Math.round(track.bpm)} BPM`}
            >
              {Math.round(track.bpm)} BPM
            </span>
          )}
          {track.fileMissing && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-medium shrink-0">
              Missing
            </span>
          )}
        </div>
        <span
          className={`${dense ? 'text-[11px]' : 'text-[13.5px]'} font-normal leading-snug truncate mt-0.5`}
          style={{ color: 'var(--isla-text-secondary)' }}
        >
          {dense ? track.artist : subtitle}
        </span>
      </div>

      {/* Right: Three dots button above tabular duration (Matches reference image) */}
      <div
        ref={menuRef}
        className="relative shrink-0 flex flex-col items-end justify-center gap-1.5 self-stretch"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((prev) => !prev);
            setShowPlaylistSub(false);
            setShowDetails(false);
          }}
          aria-label={`More actions for ${track.title}`}
          title="Track options"
          className="w-6 h-5 -mr-1 rounded-md flex items-center justify-center transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer"
          style={{ color: 'var(--isla-text-muted)' }}
        >
          <MoreHorizontal size={17} strokeWidth={2.4} />
        </button>

        <span
          className="isla-tabular text-[13px] font-bold leading-none tracking-tight"
          style={{ color: 'var(--isla-text-primary)' }}
        >
          {formatDuration(track.durationSecs)}
        </span>

        {/* Context Menu Popover */}
        {menuOpen && (
          <div
            className="isla-glass-panel absolute right-0 top-6 z-50 w-52 rounded-2xl p-1.5 text-[12.5px] shadow-xl border"
            style={{
              borderColor: 'var(--isla-divider)',
              color: 'var(--isla-text-primary)',
            }}
          >
            {!showDetails ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onPlay();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-left font-medium cursor-pointer"
                >
                  <Play size={13.5} />
                  <span>Play Now</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onPlayNext(track.id);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-left font-medium cursor-pointer"
                >
                  <ListPlus size={13.5} />
                  <span>Play Next</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onAddToQueue(track.id);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-left font-medium cursor-pointer"
                >
                  <ListEnd size={13.5} />
                  <span>Add to Queue</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleFavorite(track.id);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-left font-medium cursor-pointer"
                >
                  <Heart
                    size={13.5}
                    className={track.isFavorite ? 'text-rose-500' : ''}
                    fill={track.isFavorite ? 'currentColor' : 'none'}
                  />
                  <span>
                    {track.isFavorite ? 'Remove Favorite' : 'Add to Favorites'}
                  </span>
                </button>

                <div className="my-1 h-px" style={{ backgroundColor: 'var(--isla-divider)' }} />

                {/* Add to Playlist expandable section */}
                <button
                  type="button"
                  onClick={() => setShowPlaylistSub((s) => !s)}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-left font-medium cursor-pointer"
                >
                  <span className="flex items-center gap-2.5">
                    <Plus size={13.5} />
                    <span>Add to Playlist</span>
                  </span>
                  <span className="text-[11px] opacity-60">
                    {showPlaylistSub ? '▾' : '▸'}
                  </span>
                </button>

                {showPlaylistSub && (
                  <div className="pl-3 pr-1 py-1 space-y-0.5 max-h-28 overflow-y-auto isla-scroll">
                    {playlists.map((pl) => (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onAddToPlaylist(pl.id, track.id);
                        }}
                        className="w-full text-left px-2 py-1 rounded-lg text-[12px] truncate hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer"
                      >
                        {pl.name}
                      </button>
                    ))}
                    {onCreatePlaylistWithTrack && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onCreatePlaylistWithTrack(track.id);
                        }}
                        className="w-full text-left px-2 py-1 rounded-lg text-[12px] font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer"
                        style={{ color: accentColor }}
                      >
                        + New Playlist...
                      </button>
                    )}
                  </div>
                )}

                {(contextType === 'queue' || contextType === 'playlist') && (
                  <>
                    <div
                      className="my-1 h-px"
                      style={{ backgroundColor: 'var(--isla-divider)' }}
                    />
                    {onMoveUp && index > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onMoveUp();
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-left font-medium cursor-pointer"
                      >
                        <ArrowUp size={13.5} />
                        <span>Move Up</span>
                      </button>
                    )}
                    {onMoveDown && index + 1 < totalCount && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onMoveDown();
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-left font-medium cursor-pointer"
                      >
                        <ArrowDown size={13.5} />
                        <span>Move Down</span>
                      </button>
                    )}
                    {onRemoveFromList && (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onRemoveFromList();
                        }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-rose-500/10 text-rose-500 text-left font-medium cursor-pointer"
                      >
                        <Trash2 size={13.5} />
                        <span>
                          {contextType === 'queue'
                            ? 'Remove from Queue'
                            : 'Remove from Playlist'}
                        </span>
                      </button>
                    )}
                  </>
                )}

                <div className="my-1 h-px" style={{ backgroundColor: 'var(--isla-divider)' }} />

                <button
                  type="button"
                  onClick={() => setShowDetails(true)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-left font-medium cursor-pointer"
                >
                  <Info size={13.5} />
                  <span>File Information</span>
                </button>
              </>
            ) : (
              <div className="p-2 space-y-1.5 text-[11.5px]">
                <div className="flex items-center justify-between font-semibold">
                  <span>Audio Details</span>
                  <button
                    type="button"
                    onClick={() => setShowDetails(false)}
                    className="text-[11px] px-1.5 py-0.5 rounded bg-black/[0.06] dark:bg-white/[0.1] cursor-pointer"
                  >
                    Back
                  </button>
                </div>
                <div className="space-y-1 opacity-85">
                  <div>
                    <span className="opacity-60">Format: </span>
                    <span className="font-medium">{track.format}</span>
                    {track.bitrateKbps ? ` · ${track.bitrateKbps} kbps` : ''}
                  </div>
                  {track.sampleRateHz && (
                    <div>
                      <span className="opacity-60">Sample Rate: </span>
                      <span className="font-medium">
                        {(track.sampleRateHz / 1000).toFixed(1)} kHz
                      </span>
                    </div>
                  )}
                  {track.bpm && (
                    <div>
                      <span className="opacity-60">Tempo: </span>
                      <span className="font-medium isla-tabular">
                        {Math.round(track.bpm)} BPM
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="opacity-60">Size: </span>
                    <span className="font-medium">
                      {formatFileSize(track.fileSizeBytes)}
                    </span>
                  </div>
                  <div className="break-all text-[10.5px] opacity-70 pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
                    {track.filePath}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
