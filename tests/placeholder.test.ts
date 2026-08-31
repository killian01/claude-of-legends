// The mock provider's placeholder assets: real files, not stubs. The PNG
// must be a spec-valid PNG and the GLB a spec-valid binary glTF carrying
// exactly the six renderer clips, because keyless dev renders these in the
// same surfaces (gallery, splash strip, workshop) that will later show
// provider output.

import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_CLIPS,
  PLACEHOLDER_PNG_SIZE,
  placeholderFor,
  placeholderGlb,
  placeholderPng,
} from '../server/generation/placeholder';
import { CLIP_ROLES } from '../server/generation/provider';

describe('placeholderPng', () => {
  it('emits a spec-valid PNG at the splash frame size', () => {
    const png = placeholderPng('mock://image/mock-generate2D-1');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: length 13, then width and height big-endian.
    expect(png.readUInt32BE(8)).toBe(13);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(PLACEHOLDER_PNG_SIZE.width);
    expect(png.readUInt32BE(20)).toBe(PLACEHOLDER_PNG_SIZE.height);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // RGBA
    // The IDAT payload inflates to exactly height * (1 + width * 4) bytes.
    const idatLen = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString('ascii')).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe(PLACEHOLDER_PNG_SIZE.height * (1 + PLACEHOLDER_PNG_SIZE.width * 4));
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('is deterministic per seed and distinct across seeds', () => {
    expect(placeholderPng('seed-a').equals(placeholderPng('seed-a'))).toBe(true);
    expect(placeholderPng('seed-a').equals(placeholderPng('seed-b'))).toBe(false);
  });
});

interface GltfJson {
  asset: { version: string };
  animations: { name: string; channels: unknown[]; samplers: unknown[] }[];
  buffers: { byteLength: number }[];
  accessors: { count: number }[];
  nodes: unknown[];
  meshes: unknown[];
}

function parseGlb(glb: Buffer): { json: GltfJson; binLength: number } {
  expect(glb.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.length);
  const jsonLen = glb.readUInt32LE(12);
  expect(glb.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8')) as GltfJson;
  const binLen = glb.readUInt32LE(20 + jsonLen);
  expect(glb.readUInt32LE(24 + jsonLen)).toBe(0x004e4942); // 'BIN'
  expect(20 + jsonLen + 8 + binLen).toBe(glb.length);
  return { json, binLength: binLen };
}

describe('placeholderGlb', () => {
  it('emits a binary glTF 2.0 with the six renderer clips by name', () => {
    const { json } = parseGlb(placeholderGlb('mock://animated/mock-animate-1'));
    expect(json.asset.version).toBe('2.0');
    expect(json.animations.map((a) => a.name)).toEqual([...CLIP_ROLES]);
    expect(PLACEHOLDER_CLIPS).toEqual([...CLIP_ROLES]);
    for (const anim of json.animations) {
      expect(anim.channels).toHaveLength(1);
      expect(anim.samplers).toHaveLength(1);
    }
    expect(json.nodes).toHaveLength(3);
    expect(json.meshes).toHaveLength(2);
  });

  it('declares a buffer whose byteLength matches the BIN chunk', () => {
    const { json, binLength } = parseGlb(placeholderGlb('seed'));
    expect(json.buffers).toHaveLength(1);
    expect(json.buffers[0]?.byteLength).toBe(binLength);
  });

  it('is deterministic per seed', () => {
    expect(placeholderGlb('x').equals(placeholderGlb('x'))).toBe(true);
  });
});

describe('placeholderFor', () => {
  it('picks the format from the destination extension', () => {
    expect(placeholderFor('mock://a', 'out/model.glb').readUInt32LE(0)).toBe(0x46546c67);
    expect(placeholderFor('mock://a', 'out/sheet.png')[1]).toBe(0x50);
    const stub = JSON.parse(placeholderFor('mock://a', 'out/other.bin').toString('utf8')) as {
      placeholder: string;
    };
    expect(stub.placeholder).toBe('mock://a');
  });
});
