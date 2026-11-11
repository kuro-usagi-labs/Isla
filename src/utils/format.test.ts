import { describe, expect, it } from 'vitest';
import {
  filterTracks,
  formatDuration,
  formatFileSize,
  formatRemainingTime,
  hexToRgba,
  sortTracks,
} from './format';
import type { Track } from '../types/isla';

const SAMPLE_TRACKS: Track[] = [
  {
    id: 1,
    filePath: 'D:\\Music\\Give A Little.mp3',
    normalizedPath: 'd:\\music\\give a little.mp3',
    title: 'Give A Little',
    artist: 'Maggie Rogers',
    album: 'Heard It In A Past Life',
    albumArtist: 'Maggie Rogers',
    genre: 'Indie Pop',
    trackNumber: 2,
    year: 2019,
    durationSecs: 227,
    format: 'MP3',
    bitrateKbps: 320,
    sampleRateHz: 44100,
    fileSizeBytes: 5400000,
    artworkDataUrl: null,
    dominantColor: '#5B7CFA',
    isFavorite: true,
    dateAdded: 1700000100,
    fileMissing: false,
  },
  {
    id: 2,
    filePath: 'D:\\Music\\Blue.mp3',
    normalizedPath: 'd:\\music\\blue.mp3',
    title: 'Blue',
    artist: 'Kamal.',
    album: 'Single',
    albumArtist: 'Kamal.',
    genre: 'Alternative',
    trackNumber: 1,
    year: 2021,
    durationSecs: 185,
    format: 'FLAC',
    bitrateKbps: 980,
    sampleRateHz: 48000,
    fileSizeBytes: 18200000,
    artworkDataUrl: null,
    dominantColor: '#3B82F6',
    isFavorite: false,
    dateAdded: 1700000200,
    fileMissing: false,
  },
];

describe('Isla formatting and library utilities', () => {
  it('formats elapsed and remaining durations accurately', () => {
    expect(formatDuration(115)).toBe('1:55');
    expect(formatDuration(185)).toBe('3:05');
    expect(formatDuration(274)).toBe('4:34');
    expect(formatRemainingTime(115, 227)).toBe('-1:52');
  });

  it('formats file sizes cleanly', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024 * 1024 * 5.2)).toBe('5.2 MB');
  });

  it('filters and sorts tracks by title, artist, and duration', () => {
    const filtered = filterTracks(SAMPLE_TRACKS, 'maggie');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Give A Little');

    const byTitle = sortTracks(SAMPLE_TRACKS, 'title', 'asc');
    expect(byTitle[0].title).toBe('Blue');
    expect(byTitle[1].title).toBe('Give A Little');

    const byDurationDesc = sortTracks(SAMPLE_TRACKS, 'duration', 'desc');
    expect(byDurationDesc[0].title).toBe('Give A Little');
  });

  it('converts hex accent colors to rgba', () => {
    expect(hexToRgba('#5B7CFA', 0.2)).toBe('rgba(91, 124, 250, 0.2)');
  });
});
