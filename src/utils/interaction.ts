import type { AppSettings, PlayerProgress, PlayerSnapshot } from '../types/isla';

export function getReadableAccent(hex: string, dark: boolean): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) hex = '#5B7CFA';
  let rgb = hex.slice(1).match(/../g)!.map((c) => parseInt(c, 16));
  for (let i = 0; i < 40; i++) {
    const linear = rgb.map((c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    const light = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    if (dark ? light >= 0.32 : light <= 0.18) break;
    rgb = rgb.map((c) => dark ? c + (255 - c) * 0.08 : c * 0.94);
  }
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function compactActivation(size: AppSettings['pillSize'], controls: boolean): 'reveal'|'collapse'|'expand' {
  return size === 'compact' ? controls ? 'collapse' : 'reveal' : 'expand';
}

export function playbackFraction(position: number, duration: number): number {
  return Number.isFinite(position) && Number.isFinite(duration) && duration > 0 ? Math.max(0,Math.min(1,position/duration)) : 0;
}

export function getCompactLayout(anchorX: number, anchorY: number, controls: boolean) {
  const orbAnchor = Math.max(0,Math.min(352,anchorX));
  const side = orbAnchor <= 176 ? 'right' : 'left';
  const orbX = controls && side === 'left' ? 164 : 0;
  return { x:orbAnchor-orbX, y:anchorY / 328 > 0.5 ? 328 : 0, width:controls ? 224 : 60, height:60, radius:30,
    orbX, controlsX:side === 'right' ? 72 : 0, side };
}

export function getIslandGeometry(size: AppSettings['pillSize'], anchorX: number, anchorY: number, expanded: boolean, notice: boolean, volume: boolean, expandedHeight = 268, compactControls = false) {
  const base = size === 'compact' ? { width: 60, height: 60 } : size === 'large' ? { width: 292, height: 62 } : { width: 260, height: 58 };
  if (expanded) {
    const height = Math.max(268, Math.min(388, expandedHeight));
    return { x: 0, y: anchorY / (388 - base.height) > 0.5 ? 388 - height : 0, width: 412, height, radius: 28 };
  }
  if(size==='compact'&&volume) {
    return {x:anchorX<=176?anchorX:anchorX-164,y:anchorY/328>0.5?328:0,width:224,height:60,radius:30};
  }
  if (size === 'compact' && !notice && !volume) {
    const {x,y,width,height,radius}=getCompactLayout(anchorX,anchorY,compactControls);
    return {x,y,width,height,radius};
  }
  const width = volume ? Math.max(base.width + 28, 288) : notice ? 372 : base.width;
  const height = volume ? base.height + 6 : notice ? 140 : base.height;
  const ratioX = Math.min(1, Math.max(0, anchorX / (412 - base.width)));
  const x = Math.max(0, Math.min(412 - width, Math.round(anchorX - (width - base.width) * ratioX)));
  const y = anchorY / (388 - base.height) > 0.5 ? 388 - height : 0;
  return { x, y, width, height, radius: notice && !volume ? 40 : height / 2 };
}

export function getUpcomingQueue(player: PlayerSnapshot) {
  const items = player.queue.map((track, index) => ({ track, index }));
  const current = player.currentQueueIndex;
  if (current === null || current < 0 || current >= items.length) return items;
  if (player.shuffle) return items.filter((item) => item.index !== current);
  const upcoming = items.slice(current + 1);
  return player.repeatMode === 'all' ? [...upcoming, ...items.slice(0, current)] : upcoming;
}

export function shouldHandlePlaybackKey(target: string): boolean {
  return !['button', 'slider', 'switch', 'checkbox', 'radio', 'tab', 'input', 'textarea', 'select', 'textbox', 'contenteditable', 'a', 'menuitem'].includes(target.toLowerCase());
}

export function applyPlaybackProgress(player: PlayerSnapshot, progress: PlayerProgress): PlayerSnapshot {
  if (!player.isPlaying || player.currentTrack?.id !== progress.trackId) return player;
  return { ...player, positionSecs: progress.positionSecs, isCrossfading: progress.isCrossfading,
    crossfadeProgress: progress.crossfadeProgress, liveMixBpm: progress.liveMixBpm,
    outgoingTrack: progress.isCrossfading ? player.outgoingTrack : null };
}
