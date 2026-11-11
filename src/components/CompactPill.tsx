import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { AppSettings, PlayerSnapshot, Track } from '../types/isla';
import { ArtworkTile } from './ArtworkTile';
import { WaveformBars } from './WaveformBars';
import { islaBridge } from '../services/bridge';
import { hexToRgba } from '../utils/format';
import { contentSpring, transportSpring } from '../utils/motion';
import { SongActivity } from './SongActivity';

export type PillTransitionKind = 'none' | 'standard' | 'loved' | 'mostPlayed' | 'crownLoved';
interface CompactPillProps {
  player: PlayerSnapshot; previousTrack: Track | null; settings: AppSettings;
  accentColor: string; isExpanded: boolean; pillHeight: number; expandUpward: boolean;
  transitionKind: PillTransitionKind; transitionDirection: 'next' | 'prev' | 'play';
  isVolumeMorph: boolean; maxPlayCount: number;
  onExpand: () => void; onTogglePlayPause: () => void; onNextTrack: () => void;
  onPreviousTrack: () => void; onToggleFavorite: (trackId: number) => void;
  onWheelVolume: (vol: number) => void; onDismissTransition: () => void;
  onHoverChange?: (hovered: boolean) => void; onPressChange?: (pressed: boolean) => void;
  onControlHoverChange?: (hovered: boolean) => void;
}

export const CompactPill: React.FC<CompactPillProps> = ({
  player, previousTrack, settings, accentColor, isExpanded, transitionKind,
  transitionDirection, isVolumeMorph, onExpand, onTogglePlayPause,
  onNextTrack, onPreviousTrack, onWheelVolume, onHoverChange, onPressChange, onControlHoverChange,pillHeight,
}) => {
  const origin = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const wheelVolume = useRef({ value: player.volume, at: 0 });
  const track = player.currentTrack;
  const outgoing = player.outgoingTrack ?? previousTrack;
  const notice = transitionKind !== 'none' && Boolean(track) && !isVolumeMorph;
  const reduced = settings.reducedMotion;
  const volume = Math.round((player.isMuted ? 0 : player.volume) * 100);
  const progress = player.durationSecs > 0 ? Math.min(1, player.positionSecs / player.durationSecs) : 0;
  const entry = reduced ? { opacity: 0 } : { opacity: 0, y: transitionDirection === 'prev' ? -6 : 6, filter: 'blur(2px)' };
  const exit = reduced ? { opacity: 0 } : { opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.12 } };
  const transition = reduced ? { duration: 0.1 } : contentSpring;
  const release = () => { origin.current = null; onPressChange?.(false); };
  const canPlay = Boolean(track) || player.queue.length > 0;
  useEffect(() => { if (isExpanded) onControlHoverChange?.(false); },[isExpanded,onControlHoverChange]);

  return (
    <motion.div inert={isExpanded} aria-hidden={isExpanded}
      className={`isla-pill absolute inset-0 flex items-center gap-2.5 px-3 select-none ${notice ? "isla-pill-handoff" : ""}`}
      initial={false} animate={{ opacity: isExpanded ? 0 : 1, y: reduced ? 0 : isExpanded ? -6 : 0, scale:reduced||!isExpanded?1:0.94,filter:reduced||!isExpanded?'blur(0px)':'blur(2px)' }}
      transition={reduced?{duration:0.1}:{...contentSpring,opacity:{duration:0.12,delay:isExpanded?0:0.08}}} style={{ pointerEvents: isExpanded ? 'none' : 'auto' }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => { onHoverChange?.(false); release(); }} onPointerCancel={release} onLostPointerCapture={release}
      onPointerDown={(e) => {
        if (e.button !== 0 || isExpanded || (e.target as HTMLElement).closest('[data-pill-control]')) return;
        origin.current = { x: e.clientX, y: e.clientY, dragged: false };
        e.currentTarget.setPointerCapture(e.pointerId);
        onPressChange?.(true);
      }}
      onPointerMove={(e) => {
        const p = origin.current;
        if (!p || p.dragged || Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5) return;
        p.dragged = true; onPressChange?.(false);
        void islaBridge.startWindowDragging();
      }}
      onPointerUp={(e) => {
        const p = origin.current;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        release(); if (p && !p.dragged && !isExpanded) onExpand();
      }}
      onWheel={(e) => {
        if (isExpanded || e.deltaY === 0) return;
        e.stopPropagation();
        const now = performance.now();
        const current = now - wheelVolume.current.at < 300 ? wheelVolume.current.value : player.isMuted ? 0 : player.volume;
        const next = Math.min(1, Math.max(0, current + (e.deltaY < 0 ? 0.03 : -0.03)));
        wheelVolume.current = { value: next, at: now }; onWheelVolume(next);
      }} title="Click to expand · Scroll for volume · Drag to move"
    >
      <button className="isla-pill-open absolute inset-0 rounded-[inherit]" aria-label="Open music player" data-pill-open onClick={(e) => { if (e.detail === 0) onExpand(); }} />
      <div className="relative flex-1 h-full min-w-0 pointer-events-none" style={{ marginRight: notice ? 0 : track ? isVolumeMorph ? 74 : 110 : 38 }}>
        <AnimatePresence initial={false} mode="popLayout">
          {isVolumeMorph ? (
            <motion.div key="volume" initial={entry} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={exit} transition={transition} className="absolute inset-0 flex items-center gap-3">
              <motion.div className="isla-activity-icon" style={{ color: accentColor, backgroundColor: hexToRgba(accentColor, 0.1) }} animate={reduced ? {} : { scale: [0.88, 1.06, 1] }} transition={{ duration: 0.3 }}>
                {volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </motion.div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-[11px] mb-1.5 gap-2"><span style={{ color: 'var(--isla-text-secondary)' }}>Output Volume</span><span className="isla-tabular font-semibold">{volume}%</span></div>
                <div className="h-[4px] rounded-full overflow-hidden" style={{ background: 'var(--isla-bg-active)' }}><motion.div className="h-full rounded-full" initial={false} animate={{ width: `${volume}%` }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 36 }} style={{ background: accentColor }} /></div>
              </div>
            </motion.div>
          ) : notice && track ? (
            <motion.div key={`handoff-${track.id}`} className="absolute inset-0" initial={reduced ? { opacity: 0 } : { opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={exit} transition={transition}>
              <SongActivity track={track} outgoing={outgoing} kind={transitionKind} direction={transitionDirection} reduced={reduced} isPlaying={player.isPlaying} isCrossfading={Boolean(player.isCrossfading)} accentColor={accentColor} />
            </motion.div>
          ) : (
            <motion.div key={`track-${track?.id ?? 'empty'}`} initial={entry} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={exit} transition={transition} className="absolute inset-0 flex items-center gap-2.5">
              <motion.div className="shrink-0" initial={reduced ? false : { scale: 0.88 }} animate={{ scale: 1 }} transition={transition}><ArtworkTile title={track?.title ?? 'Isla'} artworkDataUrl={track?.artworkDataUrl} dominantColor={track?.dominantColor ?? accentColor} sizeClass="w-9 h-9" roundedClass="rounded-[11px]" iconSize={15} /></motion.div>
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span title={track?.title} className="text-[12.5px] font-semibold tracking-[-0.02em] truncate leading-tight">{track?.title ?? 'Isla'}</span>
                <span title={track?.artist} className="text-[11px] truncate leading-tight" style={{ color: 'var(--isla-text-secondary)' }}>{track?.artist ?? 'Your music, within reach'}</span>
              </div>
              {settings.showPillWaveform && track && <WaveformBars isPlaying={player.isPlaying} reducedMotion={reduced} color={accentColor} />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div data-pill-control="true" className={`isla-pill-transport absolute z-10 flex items-center shrink-0 ${notice ? "isla-handoff-transport" : ""}`} style={{ right: 12 }} initial={false} animate={{bottom:Math.max(8,(pillHeight-34)/2)}} transition={reduced?{duration:0.1}:transportSpring} onMouseEnter={() => onControlHoverChange?.(true)} onMouseLeave={() => onControlHoverChange?.(false)} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        {track && !notice && !isVolumeMorph && <motion.button type="button" className="isla-pill-previous isla-transport-button" aria-label="Previous track" title="Previous track" onClick={onPreviousTrack} transition={transportSpring} whileTap={reduced ? undefined : { scale: 0.92 }}><SkipBack size={13} fill="currentColor" /></motion.button>}
        <motion.button type="button" className="isla-transport-button isla-transport-primary" data-pill-play aria-label={player.isPlaying ? 'Pause' : 'Play'} title={player.isPlaying ? 'Pause' : 'Play'} onClick={() => canPlay ? onTogglePlayPause() : onExpand()} transition={transportSpring} whileTap={reduced ? undefined : { scale: 0.92 }}>
          <AnimatePresence initial={false} mode="popLayout"><motion.span key={player.isPlaying ? 'pause' : 'play'} initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : 0.8 }} transition={{ duration: 0.14 }}>{player.isPlaying ? <Pause size={15} fill="currentColor" strokeWidth={0} /> : <Play size={15} fill="currentColor" strokeWidth={0} className="ml-0.5" />}</motion.span></AnimatePresence>
        </motion.button>
        {track && <motion.button type="button" className="isla-transport-button" aria-label="Next track" title="Next track" onClick={onNextTrack} transition={transportSpring} whileTap={reduced ? undefined : { scale: 0.92 }}><SkipForward size={14} fill="currentColor" /></motion.button>}
      </motion.div>
      {!isVolumeMorph && !notice && track && <div className="absolute bottom-0 left-7 right-7 h-[2px] rounded-full overflow-hidden pointer-events-none" style={{ background: 'var(--isla-bg-subtle)' }}><motion.div className="h-full rounded-full" initial={false} animate={{ scaleX: progress }} transition={{ duration: reduced ? 0 : 0.18, ease: 'linear' }} style={{ width: '100%', transformOrigin: 'left', background: accentColor, opacity: 0.55 }} /></div>}
    </motion.div>
  );
};
