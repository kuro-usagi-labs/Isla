import type { SortDirection, SortField, Track } from '../types/isla';

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatRemainingTime(positionSecs: number, durationSecs: number): string {
  if (!Number.isFinite(durationSecs) || durationSecs <= 0) {
    return '-0:00';
  }
  const remaining = Math.max(0, Math.ceil(durationSecs - Math.max(0, positionSecs)));
  return `-${formatDuration(remaining)}`;
}

export function formatTotalHoursMinutes(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0 min';
  }
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 60) {
    return `${Math.max(1, totalMins)} min`;
  }
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx++;
  }
  return `${val.toFixed(unitIdx === 0 ? 0 : 1)} ${units[unitIdx]}`;
}

export function filterTracks(tracks: Track[], query: string): Track[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  return tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q) ||
      t.genre.toLowerCase().includes(q)
  );
}

export function sortTracks(
  tracks: Track[],
  field: SortField,
  direction: SortDirection = 'asc'
): Track[] {
  const copy = [...tracks];
  const mul = direction === 'asc' ? 1 : -1;
  copy.sort((a, b) => {
    switch (field) {
      case 'title':
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) * mul;
      case 'artist':
        return (
          (a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) ||
            a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })) * mul
        );
      case 'album':
        return (
          (a.album.localeCompare(b.album, undefined, { sensitivity: 'base' }) ||
            (a.trackNumber ?? 999) - (b.trackNumber ?? 999)) * mul
        );
      case 'duration':
        return (a.durationSecs - b.durationSecs) * mul;
      case 'dateAdded':
        return (a.dateAdded - b.dateAdded) * mul;
      default:
        return 0;
    }
  });
  return copy;
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) {
    return `rgba(91, 124, 250, ${alpha})`;
  }
  const num = Number.parseInt(clean, 16);
  if (Number.isNaN(num)) {
    return `rgba(91, 124, 250, ${alpha})`;
  }
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
