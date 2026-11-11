import { describe, expect, it } from 'vitest';
import { EQ_PRESETS, applyEqPreset, setEqBand, setEqPreamp, normalizeEqualizer, isEqBandAvailable } from './equalizer';

describe('equalizer settings', () => {
  it('activates EQ when the preamp slider is edited while bypassed', () => {
    expect(setEqPreamp(normalizeEqualizer(), 3)).toMatchObject({ enabled: true, preampDb: 3 });
  });
  it('marks bands excluded by the source sample rate unavailable', () => {
    expect(isEqBandAvailable(16000,48000)).toBe(true);
    expect(isEqBandAvailable(4000,8000)).toBe(false);
    expect(isEqBandAvailable(2000,8000)).toBe(true);
  });
  it('starts bypassed and flat for older app settings', () => {
    expect(normalizeEqualizer(undefined)).toEqual({ enabled: false, preset: 'flat', preampDb: 0, bandsDb: [0,0,0,0,0,0,0,0,0,0] });
  });
  it('applies a real preset and switches to Custom when a band is moved', () => {
    const bass = applyEqPreset(normalizeEqualizer(undefined), 'bass-boost');
    expect(bass.enabled).toBe(true);
    expect(bass.bandsDb[1]).toBeGreaterThan(bass.bandsDb[7]);
    const custom = setEqBand(bass, 4, -3.5);
    expect(custom.preset).toBe('custom');
    expect(custom.bandsDb[4]).toBe(-3.5);
    expect(bass.bandsDb[4]).not.toBe(-3.5);
  });
  it('bounds malformed values and provides ten finite bands for every preset', () => {
    const value = normalizeEqualizer({ enabled: true, preset: 'custom', preampDb: 900, bandsDb: [NaN, 100, -100] });
    expect(value.preampDb).toBe(6);
    expect(value.bandsDb).toEqual([0,12,-12,0,0,0,0,0,0,0]);
    for (const preset of EQ_PRESETS) {
      expect(preset.bandsDb).toHaveLength(10);
      expect(preset.bandsDb.every((band) => Number.isFinite(band) && Math.abs(band) <= 12)).toBe(true);
    }
  });
});
