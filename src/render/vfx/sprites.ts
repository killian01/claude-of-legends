// Shared procedural sprite atlas for the pooled particle cloud: a 2x2 grid
// of soft shapes painted once to one canvas at boot. No external assets;
// the fragment shader indexes cells by the per-particle sprite attribute.

import * as THREE from 'three';

// Atlas cell indices: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
export const SPRITE = { glow: 0, spark: 1, smoke: 2, fleck: 3 } as const;

const CELL = 128;

let atlas: THREE.CanvasTexture | null = null;

function paintGlow(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  const grad = g.createRadialGradient(cx, cy, 2, cx, cy, CELL / 2 - 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);
}

// A vertical streak with a hot core: rotated by the particle's rot
// attribute it reads as a spark, a falling arrow, or a rain drop.
function paintSpark(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  const tall = g.createRadialGradient(cx, cy, 1, cx, cy, CELL / 2 - 4);
  tall.addColorStop(0, 'rgba(255,255,255,0.95)');
  tall.addColorStop(0.25, 'rgba(255,255,255,0.28)');
  tall.addColorStop(1, 'rgba(255,255,255,0)');
  g.save();
  g.translate(cx, cy);
  g.scale(0.22, 1);
  g.fillStyle = tall;
  g.beginPath();
  g.arc(0, 0, CELL / 2 - 4, 0, Math.PI * 2);
  g.fill();
  g.restore();
  const core = g.createRadialGradient(cx, cy, 1, cx, cy, CELL / 7);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.beginPath();
  g.arc(cx, cy, CELL / 7, 0, Math.PI * 2);
  g.fill();
}

// A lumpy haze blob: several soft off-center circles. Additive, so it reads
// as glowing vapor; tint it dim for smoke, bright for mist.
function paintSmoke(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  const lumps: readonly [number, number, number][] = [
    [0, 0, 0.42],
    [-0.2, -0.14, 0.3],
    [0.22, 0.1, 0.3],
    [0.05, 0.24, 0.26],
    [-0.16, 0.18, 0.24],
  ];
  for (const [ox, oy, r] of lumps) {
    const x = cx + ox * CELL;
    const y = cy + oy * CELL;
    const grad = g.createRadialGradient(x, y, 1, x, y, r * CELL);
    grad.addColorStop(0, 'rgba(255,255,255,0.24)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r * CELL, 0, Math.PI * 2);
    g.fill();
  }
}

// A small hard-edged dot with a thin halo: debris flecks and twinkles.
function paintFleck(g: CanvasRenderingContext2D, cx: number, cy: number): void {
  const halo = g.createRadialGradient(cx, cy, 1, cx, cy, CELL / 3);
  halo.addColorStop(0, 'rgba(255,255,255,0.5)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(cx, cy, CELL / 3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  g.arc(cx, cy, CELL / 9, 0, Math.PI * 2);
  g.fill();
}

export function spriteAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * 2;
  canvas.height = CELL * 2;
  const g = canvas.getContext('2d');
  if (g) {
    paintGlow(g, CELL / 2, CELL / 2);
    paintSpark(g, CELL + CELL / 2, CELL / 2);
    paintSmoke(g, CELL / 2, CELL + CELL / 2);
    paintFleck(g, CELL + CELL / 2, CELL + CELL / 2);
  }
  atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  return atlas;
}
