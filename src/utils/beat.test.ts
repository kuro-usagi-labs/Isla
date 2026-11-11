import { describe, expect, it } from 'vitest';
import { readBeatStrength, beatPulseScale, canPulsePill } from './beat';

describe('audio-driven pill pulse', () => {
  it('rejects stale-track and invalid audio events', () => {
    expect(readBeatStrength({ trackId: 1, strength: 0.9 }, 2)).toBe(0);
    expect(readBeatStrength({ trackId: null, strength: 1 }, null)).toBe(0);
    for (const strength of [NaN, Infinity, -1]) expect(readBeatStrength({ trackId: 2, strength }, 2)).toBe(0);
    expect(readBeatStrength({ trackId: 2, strength: 0.7 }, 2)).toBe(0.7);
  });
  it('returns to exact resting scale and caps the deformation', () => {
    expect(beatPulseScale(0)).toEqual({ x: 1, y: 1 });
    expect(beatPulseScale(10)).toEqual(beatPulseScale(1));
    expect(beatPulseScale(0.5).x).toBeGreaterThan(1.03);
    expect(beatPulseScale(0.5).y).toBe(beatPulseScale(0.5).x);
    expect(beatPulseScale(1).x).toBeLessThanOrEqual(1.06);
    expect(beatPulseScale(1).y).toBeLessThanOrEqual(1.06);
  });
  it('stays still when off, paused, muted, silent, expanded, morphing or reduced motion', () => {
    const state = { enabled: true, playing: true, muted: false, volume: 0.7, expanded: false, morphing: false, dragging: false, reducedMotion: false };
    expect(canPulsePill(state)).toBe(true);
    for (const patch of [{ enabled: false },{ playing: false },{ muted: true },{ volume: 0 },{ expanded: true },{ morphing: true },{ dragging: true },{ reducedMotion: true },{ interacting: true }]) {
      expect(canPulsePill({ ...state, ...patch })).toBe(false);
    }
  });
});
