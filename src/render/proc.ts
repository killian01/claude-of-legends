// Procedural noise and canvas-texture helpers for the renderer, shared by
// the ground, flora, and water dressing. Everything is seeded and
// deterministic so every client renders the same map. Presentation only;
// the sim never imports from here.

import * as THREE from 'three';

// Small seeded LCG: stable visual jitter, never Math.random so the map
// dressing cannot drift between sessions or hosts.
export function makeRnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function hash2(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ Math.imul(x, 374761393), 668265263);
  h = Math.imul(h ^ Math.imul(y, 1274126177), 461845907);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// Bilinear value noise; simplex buys nothing at this scale.
export function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Normalized to [0, 1]: consumers treat the value directly as a lerp weight.
export function fbm2(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 1013) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function makeCanvasTexture(
  size: number,
  paint: (ctx: CanvasRenderingContext2D, s: number) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Grain speckle and blade strokes, authored near mid-gray: the ground's
// vertex colors carry all the hue, so one detail texture serves the whole
// map and zone tints stay a pure vertex-color lerp.
export function groundDetailTexture(): THREE.CanvasTexture {
  const rnd = makeRnd(11);
  return makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 5000; i++) {
      const v = 150 + Math.floor(rnd() * 105);
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2.5, 1 + rnd() * 2.5);
    }
    for (let i = 0; i < 1400; i++) {
      const v = 120 + Math.floor(rnd() * 100);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.3)`;
      const x = rnd() * s;
      const y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 4);
      ctx.stroke();
    }
  });
}

// Soft elongated bright blobs on transparency, scrolled in two opposed
// layers over the river for shimmer. Drawn at wrapped offsets so it tiles.
export function waterStreakTexture(): THREE.CanvasTexture {
  const rnd = makeRnd(29);
  return makeCanvasTexture(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 46; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const w = 18 + rnd() * 46;
      const h = 2 + rnd() * 3.5;
      const a = 0.1 + rnd() * 0.22;
      for (const ox of [-s, 0, s]) {
        for (const oy of [-s, 0, s]) {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, w / 2);
          g.addColorStop(0, `rgba(235,250,255,${a})`);
          g.addColorStop(1, 'rgba(235,250,255,0)');
          ctx.fillStyle = g;
          ctx.save();
          ctx.translate(x + ox, y + oy);
          ctx.scale(1, h / w);
          ctx.beginPath();
          ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  });
}
