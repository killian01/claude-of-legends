// Writers: the sim's navigation grid and layout, the Blender scene, and a
// debug map of the six faces (the dice layout) for looking at a revision.

import { crc32, deflateSync } from 'node:zlib';
import { cellOf } from './sphere.mjs';

export const BLOCKED_VALUE = -32768;

export function navigationBuffer(grid) {
  const buf = Buffer.alloc(grid.count * 2);
  for (let c = 0; c < grid.count; c++) {
    let v = BLOCKED_VALUE;
    if (grid.blocked[c] === 0)
      v = Math.max(-32767, Math.min(32767, Math.round(grid.height[c] * 1000)));
    buf.writeInt16LE(v, c * 2);
  }
  return buf;
}

export function packBase64(bytes) {
  return deflateSync(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
    level: 9,
  }).toString('base64');
}

// ---- PNG --------------------------------------------------------------------

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Where each face sits in the dice layout (column, row), v pointing up.
const DICE = [
  [2, 1],
  [0, 1],
  [1, 0],
  [1, 2],
  [1, 1],
  [3, 1],
];

const REGION_RGB = [
  [196, 178, 140],
  [92, 132, 82],
  [214, 206, 170],
  [196, 172, 104],
  [128, 176, 110],
  [138, 150, 160],
];

export function debugMap(grid, world, layout, paintBytes, channels) {
  const n = grid.n;
  const W = n * 4;
  const H = n * 3;
  const rgb = Buffer.alloc(W * H * 3, 8);
  const C = channels;
  const px = (c) => {
    const f = Math.floor(c / (n * n));
    const r = c - f * n * n;
    const j = Math.floor(r / n);
    const i = r - j * n;
    const [col, row] = DICE[f];
    return [col * n + i, row * n + (n - 1 - j)];
  };
  for (let c = 0; c < grid.count; c++) {
    const f = Math.floor(c / (n * n));
    const b = grid.blocked[c];
    let col;
    if (b === 0) {
      const base = REGION_RGB[f];
      const shade = 0.75 + 0.1 * grid.height[c];
      col = base.map((x) => x * shade);
      const pathV = paintBytes[c * C] / 255;
      const pave = paintBytes[c * C + 1] / 255;
      const lush = paintBytes[c * C + 4] / 255;
      col = col.map((x, k) => x * (1 - pathV * 0.6) + [235, 222, 190][k] * pathV * 0.6);
      col = col.map((x, k) => x * (1 - pave * 0.7) + [240, 236, 228][k] * pave * 0.7);
      col = col.map((x, k) => x * (1 - lush * 0.3) + [40, 90, 40][k] * lush * 0.3);
      if (grid.bridge[c] >= 0) col = [170, 120, 70];
    } else if (b & 32) col = [255, 0, 255];
    else if (b & 16) col = [230, 40, 40];
    else if (b & 1) col = [40, 90, 170];
    else if (b & 8) col = [30, 50, 36];
    else if (b & 2) col = [96, 66, 50];
    else col = [60, 60, 70];
    const [x, y] = px(c);
    const o = (y * W + x) * 3;
    rgb[o] = col[0];
    rgb[o + 1] = col[1];
    rgb[o + 2] = col[2];
  }
  const dot = (d, color, radius = 1) => {
    const c = cellOf(d, n);
    const [x, y] = px(c);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const o = (Y * W + X) * 3;
        rgb[o] = color[0];
        rgb[o + 1] = color[1];
        rgb[o + 2] = color[2];
      }
    }
  };
  const ring = (d, meters, color) => {
    grid.near(d, meters + 0.3, (c, m) => {
      if (m < meters - 0.3) return;
      const [x, y] = px(c);
      const o = (y * W + x) * 3;
      rgb[o] = color[0];
      rgb[o + 1] = color[1];
      rgb[o + 2] = color[2];
    });
  };
  for (const b of world.bushes) ring(b.at, b.r, [60, 230, 60]);
  for (const c of layout.campsDirs) ring(c, 7, [230, 60, 30]);
  for (const a of layout.arenasDirs) ring(a.at, a.r, [255, 140, 0]);
  for (const c of layout.cachesDirs)
    dot(c.at, c.golden ? [255, 200, 0] : [255, 255, 120], c.golden ? 2 : 1);
  for (const p of layout.padsDirs) {
    dot(p.at, [255, 0, 200], 2);
    dot(p.to, [255, 120, 230], 2);
  }
  return encodePng(W, H, rgb);
}
