// Real placeholder assets for the mock provider (keyless dev): a valid
// PNG and a valid animated GLB, built by hand with zero dependencies, so
// every surface downstream of generation (the splash strip, the gallery
// cards, the workshop view) renders something real before a provider key
// exists. Deterministic: the same seed produces the same bytes, which is
// what lets tests pin them.

import { deflateSync } from 'node:zlib';
import { CLIP_ROLES } from './provider';

// -- shared: a tiny deterministic hash and palette --------------------------

function fnv1a(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// HSL to RGB, hue in [0, 1): enough color theory to keep placeholders
// distinct per champion without ever looking like an error screen.
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number): number => {
    const t = ((t0 % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

// -- PNG --------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) c = ((CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head.subarray(4), data), 0);
  return Buffer.concat([head, data, crc]);
}

export const PLACEHOLDER_PNG_SIZE = { width: 480, height: 640 } as const;

// A painted-looking stand-in on the splash's 3:4 frame: a dark vertical
// gradient in the seed's hue, a rim-lit disc where the character would
// stand, and a diagonal atmosphere band.
export function placeholderPng(seed: string): Buffer {
  const { width, height } = PLACEHOLDER_PNG_SIZE;
  const hash = fnv1a(seed);
  const hue = (hash % 360) / 360;
  const [tr, tg, tb] = hslToRgb(hue, 0.45, 0.16);
  const [br, bg, bb] = hslToRgb(hue, 0.55, 0.05);
  const [ar, ag, ab] = hslToRgb(hue, 0.7, 0.55);
  const raw = Buffer.alloc(height * (1 + width * 4));
  const cx = width / 2;
  const cy = height * 0.42;
  const radius = width * 0.3;
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    const t = y / height;
    for (let x = 0; x < width; x++) {
      let r = tr + (br - tr) * t;
      let g = tg + (bg - tg) * t;
      let b = tb + (bb - tb) * t;
      const band = Math.abs(x - y * (width / height) - width * 0.1);
      if (band < width * 0.09) {
        const w = 0.35 * (1 - band / (width * 0.09));
        r += (ar - r) * w;
        g += (ag - g) * w;
        b += (ab - b) * w;
      }
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius) {
        const rim = d > radius * 0.82 ? 0.75 : 0.3;
        r += (ar - r) * rim;
        g += (ag - g) * rim;
        b += (ab - b) * rim;
      }
      raw[o++] = Math.round(255 * Math.min(1, r));
      raw[o++] = Math.round(255 * Math.min(1, g));
      raw[o++] = Math.round(255 * Math.min(1, b));
      raw[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// -- GLB --------------------------------------------------------------------

// The placeholder champion: a blocky figure (body and head sharing one
// unit-cube geometry, scaled per node) under a root node that carries one
// animation per renderer clip role, each visually distinct so the
// workshop's clip buttons do something honest.

interface Track {
  name: string;
  path: 'translation' | 'rotation';
  times: number[];
  // VEC3 for translation, VEC4 quaternions for rotation.
  values: number[][];
}

function yawQuat(rad: number): number[] {
  return [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];
}
function pitchQuat(rad: number): number[] {
  return [Math.sin(rad / 2), 0, 0, Math.cos(rad / 2)];
}
function rollQuat(rad: number): number[] {
  return [0, 0, Math.sin(rad / 2), Math.cos(rad / 2)];
}

const TRACKS: readonly Track[] = [
  {
    name: 'idle',
    path: 'translation',
    times: [0, 0.6, 1.2],
    values: [
      [0, 0, 0],
      [0, 0.06, 0],
      [0, 0, 0],
    ],
  },
  {
    name: 'run',
    path: 'rotation',
    times: [0, 0.25, 0.5, 0.75, 1],
    values: [rollQuat(0), rollQuat(0.14), rollQuat(0), rollQuat(-0.14), rollQuat(0)],
  },
  {
    name: 'attack',
    path: 'rotation',
    times: [0, 0.18, 0.5],
    values: [yawQuat(0), yawQuat(0.6), yawQuat(0)],
  },
  {
    name: 'cast',
    path: 'translation',
    times: [0, 0.3, 0.8],
    values: [
      [0, 0, 0],
      [0, 0.2, 0],
      [0, 0, 0],
    ],
  },
  {
    name: 'death',
    path: 'rotation',
    times: [0, 0.8],
    values: [pitchQuat(0), pitchQuat(-Math.PI / 2)],
  },
  {
    name: 'victory',
    path: 'rotation',
    times: [0, 0.75, 1.5],
    values: [yawQuat(0), yawQuat(Math.PI), yawQuat(Math.PI * 2 - 0.001)],
  },
];

// One unit cube, 24 vertices so every face is flat-shaded correctly.
function cubeGeometry(): { positions: number[]; normals: number[]; indices: number[] } {
  const faces: [number[], number[][]][] = [
    [
      [0, 0, 1],
      [
        [-0.5, -0.5, 0.5],
        [0.5, -0.5, 0.5],
        [0.5, 0.5, 0.5],
        [-0.5, 0.5, 0.5],
      ],
    ],
    [
      [0, 0, -1],
      [
        [0.5, -0.5, -0.5],
        [-0.5, -0.5, -0.5],
        [-0.5, 0.5, -0.5],
        [0.5, 0.5, -0.5],
      ],
    ],
    [
      [1, 0, 0],
      [
        [0.5, -0.5, 0.5],
        [0.5, -0.5, -0.5],
        [0.5, 0.5, -0.5],
        [0.5, 0.5, 0.5],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-0.5, -0.5, -0.5],
        [-0.5, -0.5, 0.5],
        [-0.5, 0.5, 0.5],
        [-0.5, 0.5, -0.5],
      ],
    ],
    [
      [0, 1, 0],
      [
        [-0.5, 0.5, 0.5],
        [0.5, 0.5, 0.5],
        [0.5, 0.5, -0.5],
        [-0.5, 0.5, -0.5],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-0.5, -0.5, -0.5],
        [0.5, -0.5, -0.5],
        [0.5, -0.5, 0.5],
        [-0.5, -0.5, 0.5],
      ],
    ],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const [normal, corners] of faces) {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices };
}

function align4(buffer: Buffer, pad = 0): Buffer {
  const rest = buffer.length % 4;
  return rest === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - rest, pad)]);
}

export function placeholderGlb(seed: string): Buffer {
  const hash = fnv1a(seed);
  const hue = (hash % 360) / 360;
  const body = hslToRgb(hue, 0.55, 0.45);
  const head = hslToRgb(hue, 0.4, 0.7);
  const geo = cubeGeometry();

  // Binary layout: geometry, then per-animation input and output views,
  // each 4-byte aligned. Accessor and view indices are tracked as built.
  const bins: Buffer[] = [];
  const views: unknown[] = [];
  const accessors: unknown[] = [];
  let offset = 0;
  const push = (data: Buffer, target?: number): number => {
    const aligned = align4(data);
    views.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: data.length,
      ...(target !== undefined ? { target } : {}),
    });
    bins.push(aligned);
    offset += aligned.length;
    return views.length - 1;
  };

  const posView = push(Buffer.from(new Float32Array(geo.positions).buffer), 34962);
  accessors.push({
    bufferView: posView,
    componentType: 5126,
    count: geo.positions.length / 3,
    type: 'VEC3',
    min: [-0.5, -0.5, -0.5],
    max: [0.5, 0.5, 0.5],
  });
  const normView = push(Buffer.from(new Float32Array(geo.normals).buffer), 34962);
  accessors.push({
    bufferView: normView,
    componentType: 5126,
    count: geo.normals.length / 3,
    type: 'VEC3',
  });
  const idxView = push(Buffer.from(new Uint16Array(geo.indices).buffer), 34963);
  accessors.push({
    bufferView: idxView,
    componentType: 5123,
    count: geo.indices.length,
    type: 'SCALAR',
  });

  const animations: unknown[] = [];
  for (const track of TRACKS) {
    const inputView = push(Buffer.from(new Float32Array(track.times).buffer));
    accessors.push({
      bufferView: inputView,
      componentType: 5126,
      count: track.times.length,
      type: 'SCALAR',
      min: [track.times[0]],
      max: [track.times[track.times.length - 1]],
    });
    const input = accessors.length - 1;
    const flat = track.values.flat();
    const outputView = push(Buffer.from(new Float32Array(flat).buffer));
    accessors.push({
      bufferView: outputView,
      componentType: 5126,
      count: track.values.length,
      type: track.path === 'rotation' ? 'VEC4' : 'VEC3',
    });
    animations.push({
      name: track.name,
      samplers: [{ input, interpolation: 'LINEAR', output: accessors.length - 1 }],
      channels: [{ sampler: 0, target: { node: 0, path: track.path } }],
    });
  }

  const bin = Buffer.concat(bins);
  const json = {
    asset: { version: '2.0', generator: 'claude-of-legends placeholder' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'root', children: [1, 2] },
      { name: 'body', mesh: 0, translation: [0, 0.85, 0], scale: [0.6, 1.1, 0.35] },
      { name: 'head', mesh: 1, translation: [0, 1.62, 0], scale: [0.34, 0.34, 0.34] },
    ],
    meshes: [0, 1].map((material) => ({
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material }],
    })),
    materials: [body, head].map((rgb, i) => ({
      name: i === 0 ? 'body' : 'head',
      pbrMetallicRoughness: {
        baseColorFactor: [...rgb, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.8,
      },
    })),
    animations,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  const jsonChunk = align4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // glTF
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonChunk.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4); // JSON
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4); // BIN
  return Buffer.concat([header, jsonHead, jsonChunk, binHead, bin]);
}

// Guard used by tests and callers alike: the six clips the renderer
// expects are exactly the tracks built above.
export const PLACEHOLDER_CLIPS: readonly string[] = TRACKS.map((t) => t.name);
if (PLACEHOLDER_CLIPS.length !== CLIP_ROLES.length) {
  throw new Error('placeholder clips out of step with CLIP_ROLES');
}

// What the mock's download stands in for: pick the format from the
// destination's extension, seeded by the mock URL for determinism.
export function placeholderFor(url: string, dest: string): Buffer {
  if (dest.endsWith('.glb')) return placeholderGlb(url);
  if (dest.endsWith('.png')) return placeholderPng(url);
  return Buffer.from(JSON.stringify({ placeholder: url }));
}
