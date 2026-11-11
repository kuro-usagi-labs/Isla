import { motion } from 'motion/react';
import { Heart, AudioLines } from 'lucide-react';
import type { Track } from '../types/isla';
import type { PillTransitionKind } from './CompactPill';
import { ArtworkTile } from './ArtworkTile';
import { WaveformBars } from './WaveformBars';
import { hexToRgba } from '../utils/format';

interface SongActivityProps {
  track: Track;
  outgoing: Track | null;
  kind: PillTransitionKind;
  direction: 'next' | 'prev' | 'play';
  reduced: boolean;
  isPlaying: boolean;
  isCrossfading: boolean;
  accentColor: string;
}

/** The transient music activity deliberately has its own silhouette and composition. */
export function SongActivity({ track, outgoing, kind, direction, reduced, isPlaying, accentColor }: SongActivityProps) {
  // App already resolves the configured accent for the selected light/dark/system theme.
  const accent = accentColor;
  const loved = kind === 'loved' || kind === 'crownLoved';
  const movement = direction === 'prev' ? -1 : 1;
  return (
    <div className="isla-song-activity">
      <motion.div className="isla-song-aura" style={{ background: `radial-gradient(ellipse, ${hexToRgba(accent, 0.38)}, transparent 70%)` }} initial={false} animate={reduced ? { opacity: 0.4 } : { opacity: [0.15, 0.65, 0.4], scale: [0.8, 1.1, 1] }} transition={{ duration: reduced ? 0 : 1.6 }} />
      <div className="isla-song-sheen" />
      <div className="isla-song-art-stage">
        <motion.div className="isla-song-record" initial={reduced ? false : { x: -12, rotate: -35 }} animate={{ x: 0, rotate: reduced ? 0 : 22 }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 24, delay: 0.1 }}>
          <span style={{ background: accent }} />
        </motion.div>
        {outgoing && outgoing.id !== track.id && !reduced && <motion.div className="absolute inset-0" initial={{ opacity: 0.75, scale: 1, x: 0 }} animate={{ opacity: 0, scale: 0.7, x: -22 * movement, rotate: -10 * movement }} transition={{ duration: 0.28, ease: 'easeOut' }} aria-hidden="true"><ArtworkTile artworkDataUrl={outgoing.artworkDataUrl} title={outgoing.title} dominantColor={outgoing.dominantColor} sizeClass="w-16 h-16" roundedClass="rounded-[18px]" iconSize={27} /></motion.div>}
        <motion.div className="relative z-10" initial={reduced ? { opacity: 0 } : { opacity: 0, x: 22 * movement, scale: 0.7, rotate: 8 * movement, filter: 'blur(4px)' }} animate={{ opacity: 1, x: 0, scale: 1, rotate: 0, filter: 'blur(0px)' }} transition={reduced ? { duration: 0.1 } : { type: 'spring', stiffness: 310, damping: 25, mass: 0.8, delay: 0.045, opacity: { duration: 0.18 }, filter: { duration: 0.25 } }}>
          <ArtworkTile artworkDataUrl={track.artworkDataUrl} title={track.title} dominantColor={track.dominantColor ?? accent} sizeClass="w-16 h-16" roundedClass="rounded-[18px]" iconSize={27} />
        </motion.div>
      </div>
      <motion.div aria-label="Incoming song" role="status" className="isla-song-metadata" initial={reduced ? { opacity: 0 } : { opacity: 0, x: 12 * movement }} animate={{ opacity: 1, x: 0 }} transition={reduced ? { duration: 0.1 } : { type: 'spring', stiffness: 300, damping: 27, delay: 0.09 }}>
        <div className="isla-song-eyebrow" style={{ color: accent }}>
          <AudioLines size={10} strokeWidth={2.5} />
          <span>{direction === 'prev' ? 'Previous song' : direction === 'play' ? 'Now playing' : 'Next song'}</span>
          {loved && <Heart size={9} fill="currentColor" className="isla-song-loved" />}
        </div>
        <div className="isla-song-title" title={track.title}>{track.title}</div>
        <div className="isla-song-artist">{track.artist}</div>
      </motion.div>
      <div className="isla-song-wave"><WaveformBars isPlaying={isPlaying} reducedMotion={reduced} color={accent} size="md" /></div>
    </div>
  );
}
