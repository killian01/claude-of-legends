// Procedural 2D icons: a gradient tile with bold initials, generated once
// per key and cached as data URLs. Items are tinted by their primary stat.
// The painted image pipeline (icon_images.ts) always wins over this
// fallback; see docs/design/icon-art-style.md.

import type { ItemDef } from '../sim/content/items';
import { itemImageUrl } from './icon_images';

const cache = new Map<string, string>();

export function iconDataUrl(text: string, colorA: string, colorB: string): string {
  const key = `${text}|${colorA}|${colorB}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const g = canvas.getContext('2d');
  if (!g) return '';
  const grad = g.createLinearGradient(0, 0, 48, 48);
  grad.addColorStop(0, colorA);
  grad.addColorStop(1, colorB);
  g.fillStyle = grad;
  g.fillRect(0, 0, 48, 48);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 45, 45);
  g.font = 'bold 20px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillText(text, 25, 26);
  g.fillStyle = '#f4f0e0';
  g.fillText(text, 24, 25);
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}

function itemTint(def: ItemDef): [string, string] {
  const s = def.stats;
  if (s.ad) return ['#8a3d2a', '#c96a3a'];
  if (s.ap) return ['#5a3d8a', '#8a5fc9'];
  if (s.armor) return ['#8a742a', '#c9ae58'];
  if (s.mr) return ['#2a5a8a', '#588ac9'];
  if (s.hp) return ['#2a6a35', '#4a9a55'];
  if (s.mana) return ['#2a4a7a', '#4a6ac9'];
  if (s.attackSpeedPct) return ['#7a6a2a', '#c9b83a'];
  return ['#3a6a5a', '#5ac9a8'];
}

export function itemIconUrl(def: ItemDef): string {
  const image = itemImageUrl(def.id);
  if (image) return image;
  const initials = def.id
    .split('_')
    .map((w) => (w[0] ?? '').toUpperCase())
    .join('');
  const [a, b] = itemTint(def);
  return iconDataUrl(initials, a, b);
}
