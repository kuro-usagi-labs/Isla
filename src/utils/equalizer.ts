import presetData from '../data/equalizer-presets.json';
import type { EqualizerSettings } from '../types/isla';

export const EQ_FREQUENCIES = [31,63,125,250,500,1000,2000,4000,8000,16000];
export const EQ_LABELS = ['31','63','125','250','500','1k','2k','4k','8k','16k'];
export const EQ_PRESETS: { id: string; name: string; description: string; bandsDb: number[] }[] = presetData;

export function normalizeEqualizer(value?: Partial<EqualizerSettings>): EqualizerSettings {
  const finite = (n: number | undefined, min: number, max: number) => Number.isFinite(n) ? Math.max(min,Math.min(max,n!)) : 0;
  return { enabled: Boolean(value?.enabled), preset: value?.preset === 'custom' || EQ_PRESETS.some((p) => p.id === value?.preset) ? value!.preset! : 'flat',
    preampDb: finite(value?.preampDb,-12,6), bandsDb: Array.from({length:10},(_,i) => finite(value?.bandsDb?.[i],-12,12)) };
}
export function applyEqPreset(current: EqualizerSettings, id: string): EqualizerSettings {
  const preset = EQ_PRESETS.find((p) => p.id === id);
  return preset ? { ...current, enabled: true, preset: preset.id, bandsDb: [...preset.bandsDb] } : current;
}
export function setEqBand(current: EqualizerSettings, index: number, value: number): EqualizerSettings {
  if (index < 0 || index >= 10) return current;
  const bandsDb = [...current.bandsDb]; bandsDb[index] = value;
  return normalizeEqualizer({ ...current, enabled: true, preset: 'custom', bandsDb });
}
export function setEqPreamp(current: EqualizerSettings, value: number): EqualizerSettings {
  return normalizeEqualizer({ ...current, enabled: true, preampDb: value });
}
export function isEqBandAvailable(frequency: number, sampleRate = 48000): boolean {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.max(8000,sampleRate) : 48000;
  return frequency < rate * 0.45;
}
export function eqCurvePath(bands: number[]): string {
  const points = normalizeEqualizer({ bandsDb: bands }).bandsDb.map((gain,i) => ({ x: 8+i*36, y: 23-gain*1.35 }));
  return points.slice(1).reduce((path,p,i) => path+' C '+(points[i].x+12)+','+points[i].y+' '+(p.x-12)+','+p.y+' '+p.x+','+p.y, 'M '+points[0].x+','+points[0].y);
}
