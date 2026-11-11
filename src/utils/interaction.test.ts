import { describe, expect, it } from 'vitest';
import { getIslandGeometry, shouldHandlePlaybackKey, applyPlaybackProgress, getReadableAccent, getUpcomingQueue } from './interaction';
import { islaBridge } from '../services/bridge';

describe('island interaction contracts', () => {
  it('grows an expanded drawer upward while preserving the bottom edge', () => {
    expect(getIslandGeometry('default', 76, 330, true, false, false, 268)).toEqual({ x: 0, y: 120, width: 412, height: 268, radius: 28 });
    expect(getIslandGeometry('default', 76, 330, true, false, false, 388)).toEqual({ x: 0, y: 0, width: 412, height: 388, radius: 28 });
  });
  it('keeps the top edge anchored when opening the drawer downward', () => {
    expect(getIslandGeometry('default', 76, 0, true, false, false, 268)).toEqual({ x: 0, y: 0, width: 412, height: 268, radius: 28 });
  });
  it('keeps original queue indices when duplicate songs appear after the current track', async () => {
    const { player } = await islaBridge.getInitialAppState();
    const first = { id: 1 } as NonNullable<typeof player.currentTrack>;
    const second = { id: 2 } as NonNullable<typeof player.currentTrack>;
    expect(getUpcomingQueue({ ...player, queue: [first, second, first], currentQueueIndex: 1 }).map((item) => [item.track.id, item.index])).toEqual([[1, 2]]);
    expect(getUpcomingQueue({ ...player, queue: [first, second, first], currentQueueIndex: 1, repeatMode: 'all' }).map((item) => item.index)).toEqual([2, 0]);
    expect(getUpcomingQueue({ ...player, queue: [first, second, first], currentQueueIndex: 1, shuffle: true }).map((item) => item.index)).toEqual([0, 2]);
  });
  it('lifts a dark cover accent on dark surfaces while preserving its hue', () => {
    expect(getReadableAccent('#302050', true)).not.toBe('#302050');
    const rgb = getReadableAccent('#302050', true).match(/\w\w/g)!.map((c) => parseInt(c, 16));
    expect(rgb[2]).toBeGreaterThan(rgb[0]);
    expect(rgb[0]).toBeGreaterThan(140);
  });
  it('darkens pale cover accents on light surfaces', () => {
    const rgb = getReadableAccent('#EEEEFF', false).match(/\w\w/g)!.map((c) => parseInt(c, 16));
    expect(Math.max(...rgb)).toBeLessThan(150);
  });
  it('volume takes geometry priority over a notification at the right/bottom edge', () => {
    expect(getIslandGeometry('default', 152, 330, false, true, true)).toEqual({ x: 124, y: 324, width: 288, height: 64, radius: 32 });
  });
  it('keeps song notices within the canvas at the left edge', () => {
    expect(getIslandGeometry('compact', 0, 0, false, true, false)).toEqual({ x: 0, y: 0, width: 372, height: 140, radius: 40 });
  });
  it('lets focused buttons, sliders and editable text own Space', () => {
    for (const target of ['button', 'slider', 'switch', 'checkbox', 'radio', 'tab', 'input', 'textarea', 'select', 'textbox', 'contenteditable']) expect(shouldHandlePlaybackKey(target)).toBe(false);
    expect(shouldHandlePlaybackKey('body')).toBe(true);
  });
  it('ignores a late progress tick for the previous track', async () => {
    const { player } = await islaBridge.getInitialAppState();
    const progress = { trackId: 99, positionSecs: 90, isCrossfading: false, crossfadeProgress: 0, liveMixBpm: null };
    expect(applyPlaybackProgress(player, progress)).toBe(player);
  });
});
