// Procedural painted ability and sigil icons, the world-of-claudecraft way:
// a beveled frame, a radial background tinted by the ability's school, and
// one vector primitive picked from the cast shape and effects, cached as a
// data URL. Recipes derive from the data records themselves, so any new
// ability always gets a sensible icon with zero image assets.

import type { AbilityDef, CastSpec } from '../sim/combat/casting';
import type { SigilDef } from '../sim/content/sigils';
import type { AbilityKey } from '../sim/types';

type Ctx = CanvasRenderingContext2D;

interface IconPalette {
  base: string;
  light: string;
  dark: string;
  glow: string;
}

const PALETTES = {
  arcane: { base: '#6a4fa8', light: '#b79ae8', dark: '#2c1e50', glow: '#cdb2ff' },
  steel: { base: '#a8543a', light: '#e8a17a', dark: '#4c1e12', glow: '#ffb28a' },
  life: { base: '#4f9a48', light: '#a8e08a', dark: '#1d4420', glow: '#c8ff9a' },
  control: { base: '#b8912e', light: '#eccf7a', dark: '#553d0e', glow: '#ffe9a0' },
  wind: { base: '#3a8a9a', light: '#8ad8e0', dark: '#123c46', glow: '#aef2f8' },
  fire: { base: '#b8622e', light: '#f0a25a', dark: '#54220a', glow: '#ffc07a' },
} as const;

type PaletteName = keyof typeof PALETTES;

type PrimitiveName =
  | 'bolt'
  | 'cone'
  | 'ring'
  | 'shield'
  | 'cross'
  | 'burst'
  | 'thorns'
  | 'chevrons'
  | 'sword'
  | 'flame'
  | 'swirl';

const SIZE = 48;
const cache = new Map<string, string>();

// Each primitive paints centered in a [-1, 1] square scaled to the tile.
const PRIMITIVES: Record<PrimitiveName, (g: Ctx, p: IconPalette) => void> = {
  bolt(g, p) {
    g.rotate(-Math.PI / 4);
    g.fillStyle = p.light;
    g.beginPath();
    g.moveTo(-0.8, 0);
    g.lineTo(0.25, -0.28);
    g.lineTo(0.75, 0);
    g.lineTo(0.25, 0.28);
    g.closePath();
    g.fill();
    g.strokeStyle = p.glow;
    g.lineWidth = 0.08;
    for (const off of [-0.32, 0, 0.32]) {
      g.beginPath();
      g.moveTo(-1.0, off);
      g.lineTo(-0.55, off);
      g.stroke();
    }
  },
  cone(g, p) {
    g.fillStyle = p.light;
    g.beginPath();
    g.moveTo(-0.55, 0.75);
    g.arc(-0.55, 0.75, 1.45, -Math.PI / 3.2, -Math.PI / 24);
    g.closePath();
    g.fill();
    g.strokeStyle = p.dark;
    g.lineWidth = 0.07;
    g.stroke();
  },
  ring(g, p) {
    g.strokeStyle = p.light;
    g.lineWidth = 0.2;
    g.beginPath();
    g.arc(0, 0, 0.68, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = p.glow;
    g.beginPath();
    g.arc(0, 0, 0.24, 0, Math.PI * 2);
    g.fill();
  },
  shield(g, p) {
    g.fillStyle = p.light;
    g.beginPath();
    g.moveTo(0, -0.75);
    g.quadraticCurveTo(0.62, -0.6, 0.58, -0.1);
    g.quadraticCurveTo(0.52, 0.5, 0, 0.8);
    g.quadraticCurveTo(-0.52, 0.5, -0.58, -0.1);
    g.quadraticCurveTo(-0.62, -0.6, 0, -0.75);
    g.fill();
    g.strokeStyle = p.dark;
    g.lineWidth = 0.07;
    g.stroke();
  },
  cross(g, p) {
    g.fillStyle = p.light;
    const w = 0.26;
    g.fillRect(-w / 2, -0.7, w, 1.4);
    g.fillRect(-0.7, -w / 2, 1.4, w);
    g.strokeStyle = p.dark;
    g.lineWidth = 0.06;
    g.strokeRect(-w / 2, -0.7, w, 1.4);
    g.strokeRect(-0.7, -w / 2, 1.4, w);
  },
  burst(g, p) {
    g.fillStyle = p.light;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? 0.85 : 0.34;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    g.fillStyle = p.glow;
    g.beginPath();
    g.arc(0, 0, 0.18, 0, Math.PI * 2);
    g.fill();
  },
  thorns(g, p) {
    g.strokeStyle = p.light;
    g.lineWidth = 0.12;
    g.beginPath();
    g.moveTo(-0.8, 0.5);
    g.quadraticCurveTo(0, -0.1, 0.8, 0.35);
    g.stroke();
    g.fillStyle = p.light;
    for (const [x, y, a] of [
      [-0.45, 0.22, -0.5],
      [0.0, -0.02, -0.2],
      [0.45, 0.12, 0.25],
    ] as const) {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.beginPath();
      g.moveTo(-0.1, 0);
      g.lineTo(0, -0.42);
      g.lineTo(0.1, 0);
      g.closePath();
      g.fill();
      g.restore();
    }
  },
  chevrons(g, p) {
    g.strokeStyle = p.light;
    g.lineWidth = 0.2;
    g.lineCap = 'round';
    for (const off of [-0.34, 0.14]) {
      g.beginPath();
      g.moveTo(off - 0.28, -0.5);
      g.lineTo(off + 0.28, 0);
      g.lineTo(off - 0.28, 0.5);
      g.stroke();
    }
  },
  sword(g, p) {
    g.rotate(Math.PI / 4);
    g.fillStyle = p.light;
    g.beginPath();
    g.moveTo(-0.09, -0.85);
    g.lineTo(0.09, -0.85);
    g.lineTo(0.07, 0.3);
    g.lineTo(-0.07, 0.3);
    g.closePath();
    g.fill();
    g.fillStyle = p.glow;
    g.fillRect(-0.3, 0.3, 0.6, 0.12);
    g.fillRect(-0.06, 0.42, 0.12, 0.32);
  },
  flame(g, p) {
    g.fillStyle = p.light;
    g.beginPath();
    g.moveTo(0, -0.8);
    g.quadraticCurveTo(0.55, -0.25, 0.42, 0.25);
    g.quadraticCurveTo(0.35, 0.62, 0, 0.8);
    g.quadraticCurveTo(-0.35, 0.62, -0.42, 0.25);
    g.quadraticCurveTo(-0.55, -0.25, 0, -0.8);
    g.fill();
    g.fillStyle = p.glow;
    g.beginPath();
    g.moveTo(0, -0.3);
    g.quadraticCurveTo(0.24, 0.05, 0.16, 0.35);
    g.quadraticCurveTo(0.1, 0.55, 0, 0.62);
    g.quadraticCurveTo(-0.1, 0.55, -0.16, 0.35);
    g.quadraticCurveTo(-0.24, 0.05, 0, -0.3);
    g.fill();
  },
  swirl(g, p) {
    g.strokeStyle = p.light;
    g.lineWidth = 0.16;
    g.lineCap = 'round';
    for (const [r, a0, a1, y] of [
      [0.55, Math.PI * 0.9, Math.PI * 1.9, -0.18],
      [0.42, Math.PI * 0.7, Math.PI * 1.75, 0.12],
      [0.3, Math.PI * 0.9, Math.PI * 1.8, 0.4],
    ] as const) {
      g.beginPath();
      g.arc(0.05, y, r, a0, a1);
      g.stroke();
    }
  },
};

function paint(palette: IconPalette, prim: PrimitiveName, ult: boolean): string {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) return '';

  // Radial background, dark corners.
  const bg = g.createRadialGradient(SIZE * 0.42, SIZE * 0.36, 4, SIZE / 2, SIZE / 2, SIZE * 0.72);
  bg.addColorStop(0, palette.base);
  bg.addColorStop(1, palette.dark);
  g.fillStyle = bg;
  g.fillRect(0, 0, SIZE, SIZE);

  // Ultimates get corner rays behind the primitive so the R reads special.
  if (ult) {
    g.save();
    g.translate(SIZE / 2, SIZE / 2);
    g.strokeStyle = palette.glow;
    g.globalAlpha = 0.4;
    g.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.26;
      g.beginPath();
      g.moveTo(Math.cos(a) * 14, Math.sin(a) * 14);
      g.lineTo(Math.cos(a) * 34, Math.sin(a) * 34);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;
  }

  // The primitive, glowing.
  g.save();
  g.translate(SIZE / 2, SIZE / 2);
  g.scale(SIZE * 0.36, SIZE * 0.36);
  g.shadowColor = palette.glow;
  g.shadowBlur = 7;
  PRIMITIVES[prim](g, palette);
  g.restore();

  // Beveled edge: light top-left, dark bottom-right, then a crisp frame.
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(2, SIZE - 2);
  g.lineTo(2, 2);
  g.lineTo(SIZE - 2, 2);
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.beginPath();
  g.moveTo(SIZE - 2, 2);
  g.lineTo(SIZE - 2, SIZE - 2);
  g.lineTo(2, SIZE - 2);
  g.stroke();
  g.strokeStyle = 'rgba(8,10,4,0.9)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, SIZE - 2, SIZE - 2);

  return canvas.toDataURL();
}

function has(json: string, word: string): boolean {
  return json.includes(`"${word}"`);
}

function pickPalette(spec: CastSpec, json: string): PaletteName {
  if (has(json, 'dot') || has(json, 'burn')) return 'fire';
  if (has(json, 'heal') || has(json, 'shield')) return 'life';
  if (has(json, 'stun') || has(json, 'taunt') || has(json, 'knockback') || has(json, 'pull'))
    return 'control';
  if (spec.kind === 'dash' || has(json, 'haste')) return 'wind';
  if (json.includes('adRatio')) return 'steel';
  return 'arcane';
}

function pickPrimitive(spec: CastSpec, json: string): PrimitiveName {
  switch (spec.kind) {
    case 'skillshot':
      return 'bolt';
    case 'cone':
      return 'cone';
    case 'dash':
      return 'chevrons';
    case 'wall':
      return 'shield';
    case 'zone':
      return has(json, 'root') || has(json, 'mark') ? 'thorns' : 'ring';
    default:
      break;
  }
  if (has(json, 'shield')) return 'shield';
  if (has(json, 'heal')) return 'cross';
  if (has(json, 'stun')) return 'burst';
  if (has(json, 'root') || has(json, 'mark')) return 'thorns';
  if (has(json, 'dot')) return 'flame';
  if (has(json, 'haste') || has(json, 'attackSpeed')) return 'swirl';
  if (json.includes('adRatio')) return 'sword';
  return 'burst';
}

export function abilityIconUrl(key: AbilityKey, ability: AbilityDef): string {
  const json = JSON.stringify(ability.spec);
  const cacheKey = `ability|${key}|${ability.name}|${json.length}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const url = paint(
    PALETTES[pickPalette(ability.spec, json)],
    pickPrimitive(ability.spec, json),
    key === 'R',
  );
  cache.set(cacheKey, url);
  return url;
}

const SIGIL_RECIPES: Record<string, { pal: PaletteName; prim: PrimitiveName }> = {
  riftstep: { pal: 'arcane', prim: 'chevrons' },
  zephyr: { pal: 'wind', prim: 'swirl' },
  mend: { pal: 'life', prim: 'cross' },
  sear: { pal: 'fire', prim: 'flame' },
};

export function sigilIconUrl(sigil: SigilDef): string {
  const cacheKey = `sigil|${sigil.id}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const recipe = SIGIL_RECIPES[sigil.id] ?? { pal: 'arcane', prim: 'burst' };
  const url = paint(PALETTES[recipe.pal], recipe.prim, false);
  cache.set(cacheKey, url);
  return url;
}
