import type { IslandBounds } from '../types/isla';

export function containsIslandPoint(bounds: IslandBounds, x: number, y: number): boolean {
  if (x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height) return false;
  const r = Math.min(bounds.radius, bounds.width / 2, bounds.height / 2);
  const dx = x - Math.max(bounds.x + r, Math.min(bounds.x + bounds.width - r, x));
  const dy = y - Math.max(bounds.y + r, Math.min(bounds.y + bounds.height - r, y));
  return dx * dx + dy * dy <= r * r;
}

export function measureIslandHitGeometry(shell: HTMLElement) {
  const rect = shell.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const bounds: IslandBounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    radius: (parseFloat(getComputedStyle(shell).borderTopLeftRadius) || 26) * rect.width / Math.max(1, shell.offsetWidth) };
  const regions: IslandBounds[] = [];
  for (const node of Array.from(shell.querySelectorAll<HTMLElement>('[data-island-hit-region]'))) {
    if (node.closest('[inert]')) continue;
    const style = getComputedStyle(node);
    const r = node.getBoundingClientRect();
    // A just-mounted or disappearing region can have zero width. Do not send an
    // invalid region that makes native validation reject the entire geometry.
    if (r.width <= 0 || r.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
    const scale = r.width / Math.max(1, node.offsetWidth);
    const padding = Number(node.dataset.hitSlop ?? 0) * scale;
    const radius = Math.min((parseFloat(style.borderTopLeftRadius) || 0) * scale, r.width / 2, r.height / 2);
    regions.push({ x: r.x-padding, y: r.y-padding, width: r.width+padding*2, height: r.height+padding*2, radius: radius+padding });
  }
  return { bounds, regions, expanded: shell.dataset.islandExpanded === 'true' };
}

export function islandOwnsPointer(shell: HTMLElement, x: number, y: number): boolean {
  const geometry = measureIslandHitGeometry(shell);
  return Boolean(geometry && (geometry.regions.length ? geometry.regions : [geometry.bounds]).some(r => containsIslandPoint(r, x, y)));
}
