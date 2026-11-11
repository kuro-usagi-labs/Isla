export interface AudioBeat { trackId: number | null; strength: number }
export function readBeatStrength(beat: AudioBeat, trackId: number | null): number {
  return trackId !== null && beat.trackId === trackId && Number.isFinite(beat.strength) ? Math.max(0,Math.min(1,beat.strength)) : 0;
}
export function beatPulseScale(strength: number) {
  // Lift softer onsets as well; the old linear mapping made most beats invisible.
  const amount = Number.isFinite(strength) ? Math.sqrt(Math.max(0,Math.min(1,strength))) : 0;
  return { x: 1+amount*0.06, y: 1+amount*0.06 };
}
export function canPulsePill(state: { enabled: boolean; playing: boolean; muted: boolean; volume: number; expanded: boolean; morphing: boolean; dragging: boolean; reducedMotion: boolean; interacting?: boolean }) {
  return state.enabled && state.playing && !state.muted && state.volume > 0.001 && !state.expanded && !state.morphing && !state.dragging && !state.reducedMotion && !state.interacting;
}
