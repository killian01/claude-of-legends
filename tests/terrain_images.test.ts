// The terrain's pictures once the GPU holds them (src/render/terrain_images.ts):
// found in the model's bytes, closed only after every upload and only when
// they can be had back, and decoded again from those bytes for a restored
// WebGL context.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DecodeImage,
  type GltfImages,
  glbBinOffset,
  glbImageSpans,
  type ImageSpan,
  sourceSpans,
  TerrainImages,
  textureImageCandidates,
  textureImageSpan,
} from '../src/render/terrain_images';

// A decoded picture, as the browser's ImageBitmap behaves: close() lets
// the memory go.
class FakeBitmap {
  closed = false;
  constructor(readonly tag: string) {}
  close(): void {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.stubGlobal('ImageBitmap', FakeBitmap);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// A GLB in miniature: the JSON chunk, then the binary chunk holding two
// pictures' bytes, each chunk padded to four bytes as the format wants.
function glb(json: object, bin: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(text, 20);
  const binAt = 20 + jsonLength;
  view.setUint32(binAt, binLength, true);
  view.setUint32(binAt + 4, 0x004e4942, true);
  bytes.set(bin, binAt + 8);
  return out;
}

const JSON_DEF: GltfImages = {
  buffers: [{}],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 3 },
    { buffer: 0, byteOffset: 4, byteLength: 2 },
    { buffer: 1, byteOffset: 0, byteLength: 2 },
  ],
  images: [
    { bufferView: 0, mimeType: 'image/webp' },
    { bufferView: 1, mimeType: 'image/png' },
    { bufferView: 2, mimeType: 'image/webp' },
  ],
  textures: [
    { extensions: { EXT_texture_webp: { source: 0 } } },
    { source: 1, extensions: { EXT_texture_webp: { source: 0 } } },
    { source: 1 },
  ],
};
const MODEL = glb(JSON_DEF, new Uint8Array([1, 2, 3, 0, 7, 8]));
const BIN_AT = glbBinOffset(MODEL)!;

describe("the pictures' bytes", () => {
  it('lie in the binary chunk of a GLB', () => {
    expect(BIN_AT).toBeGreaterThan(20);
    expect(Array.from(new Uint8Array(MODEL, BIN_AT, 6))).toEqual([1, 2, 3, 0, 7, 8]);
    expect(glbBinOffset(new ArrayBuffer(8))).toBeNull();
    expect(glbBinOffset(new TextEncoder().encode('not a model at all').buffer)).toBeNull();
  });

  it('are found for every image the chunk holds, and only those', () => {
    const spans = glbImageSpans(MODEL, JSON_DEF);
    expect(spans[0]).toEqual({ offset: BIN_AT, length: 3, mimeType: 'image/webp' });
    expect(spans[1]).toEqual({ offset: BIN_AT + 4, length: 2, mimeType: 'image/png' });
    // Another buffer is a file beside the model, not in it.
    expect(spans[2]).toBeNull();
    // A view past the end is not trusted.
    const past = { ...JSON_DEF, bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: 999 }] };
    expect(glbImageSpans(MODEL, past)[0]).toBeNull();
  });
});

describe('the picture a texture shows', () => {
  const spans = glbImageSpans(MODEL, JSON_DEF);

  it("is looked for where GLTFLoader looks: the extension's source first", () => {
    expect(textureImageCandidates(JSON_DEF, 0)).toEqual([0]);
    expect(textureImageCandidates(JSON_DEF, 1)).toEqual([0, 1]);
    expect(textureImageCandidates(JSON_DEF, 9)).toEqual([]);
  });

  it('is the candidate of the type the loader recorded', () => {
    expect(textureImageSpan(JSON_DEF, spans, 1, 'image/webp')).toBe(spans[0]);
    expect(textureImageSpan(JSON_DEF, spans, 1, 'image/png')).toBe(spans[1]);
    expect(textureImageSpan(JSON_DEF, spans, 1, 'image/avif')).toBeNull();
  });

  it('is only guessed when there is one to guess', () => {
    expect(textureImageSpan(JSON_DEF, spans, 0, undefined)).toBe(spans[0]);
    expect(textureImageSpan(JSON_DEF, spans, 1, undefined)).toBeNull();
  });

  it('is known per picture, shared by the clones, and dropped when they disagree', () => {
    const texture = new THREE.Texture(new FakeBitmap('a'));
    texture.userData.mimeType = 'image/webp';
    const clone = texture.clone();
    const other = new THREE.Texture(new FakeBitmap('b'));
    other.userData.mimeType = 'image/png';
    const torn = new THREE.Texture(new FakeBitmap('c'));
    torn.userData.mimeType = 'image/webp';
    const tornClone = torn.clone();
    tornClone.userData.mimeType = 'image/png';
    const associations: [unknown, { textures?: number }][] = [
      [texture, { textures: 0 }],
      [clone, { textures: 1 }],
      [other, { textures: 2 }],
      [torn, { textures: 1 }],
      [tornClone, { textures: 1 }],
      [new THREE.MeshBasicMaterial(), { materials: 0 } as { textures?: number }],
    ];
    const found = sourceSpans({ json: JSON_DEF, associations }, MODEL);
    expect(found.get(texture.source)).toEqual(spans[0]);
    expect(found.get(clone.source)).toBe(found.get(texture.source));
    expect(found.get(other.source)).toEqual(spans[1]);
    expect(found.has(torn.source)).toBe(false);
    expect(found.size).toBe(2);
  });
});

describe('the shipped Star Orchard', () => {
  // Both models the browser may download (src/game/map_quality.ts): every
  // picture must be found in the bytes and told apart, or the phone keeps
  // its 154 MB of bitmaps after all.
  for (const file of ['map-light.glb', 'map.glb']) {
    it(`lets every picture of ${file} be decoded again from its bytes`, () => {
      const bytes = readFileSync(new URL(`../public/map/star-orchard/${file}`, import.meta.url));
      const model = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      expect(glbBinOffset(model)).not.toBeNull();
      // The JSON chunk follows the 12-byte header and its own 8.
      const jsonLength = new DataView(model).getUint32(12, true);
      const json: GltfImages = JSON.parse(
        new TextDecoder().decode(new Uint8Array(model, 20, jsonLength)),
      );
      const spans = glbImageSpans(model, json);
      expect(spans.length).toBeGreaterThan(200);
      expect(spans.every((s) => s !== null && s.mimeType === 'image/webp')).toBe(true);
      for (let t = 0; t < (json.textures?.length ?? 0); t++) {
        expect(textureImageSpan(json, spans, t, 'image/webp')).not.toBeNull();
      }
    });
  }
});

describe('closing and decoding again', () => {
  const span: ImageSpan = { offset: BIN_AT, length: 3, mimeType: 'image/webp' };
  const pngSpan: ImageSpan = { offset: BIN_AT + 4, length: 2, mimeType: 'image/png' };

  function setup(decode: DecodeImage | null = vi.fn(async () => new FakeBitmap('again') as never)) {
    const ground = new THREE.Texture(new FakeBitmap('ground'));
    const groundClone = ground.clone();
    const bark = new THREE.Texture(new FakeBitmap('bark'));
    // A picture with no bytes to come back from, and one that is no bitmap.
    const loose = new THREE.Texture(new FakeBitmap('loose'));
    const plain = new THREE.Texture({ width: 4, height: 4 });
    const spans = new Map<THREE.Texture['source'], ImageSpan>([
      [ground.source, span],
      [bark.source, pngSpan],
      [plain.source, span],
    ]);
    const textures: THREE.Texture[] = [ground, groundClone, bark, loose, plain];
    const images = new TerrainImages(MODEL, textures, spans, decode);
    return { images, ground, groundClone, bark, loose, plain, decode };
  }

  it('uploads every texture before it closes any picture', () => {
    const { images, ground, groundClone, bark, loose, plain } = setup();
    const log: string[] = [];
    const upload = (t: THREE.Texture): void => {
      log.push(`upload ${t.uuid}`);
      expect((t.source.data as FakeBitmap).closed ?? false).toBe(false);
    };
    expect(images.release(upload)).toBe(2);
    expect(log).toHaveLength(5);
    // Each picture once, the clone's with the original's.
    expect((ground.source.data as FakeBitmap).closed).toBe(true);
    expect(groundClone.source).toBe(ground.source);
    expect((bark.source.data as FakeBitmap).closed).toBe(true);
    // What cannot come back stays as it is.
    expect((loose.source.data as FakeBitmap).closed).toBe(false);
    expect(plain.source.data).toEqual({ width: 4, height: 4 });
    expect(images.closedCount).toBe(2);
  });

  it('closes nothing when it cannot decode, and still uploads', () => {
    const { images, ground } = setup(null);
    let uploads = 0;
    expect(images.release(() => uploads++)).toBe(0);
    expect(uploads).toBe(5);
    expect((ground.source.data as FakeBitmap).closed).toBe(false);
  });

  it('decodes each closed picture again from its own bytes, and marks it for upload', async () => {
    const seen: { bytes: number[]; type: string }[] = [];
    const decode: DecodeImage = async (bytes, type) => {
      seen.push({ bytes: Array.from(bytes), type });
      return new FakeBitmap(type) as never;
    };
    const { images, ground, groundClone, bark } = setup(decode);
    images.release(() => undefined);
    const versions = [ground.version, groundClone.version, bark.version];
    await images.restore();
    expect(seen).toEqual([
      { bytes: [1, 2, 3], type: 'image/webp' },
      { bytes: [7, 8], type: 'image/png' },
    ]);
    expect((ground.source.data as FakeBitmap).tag).toBe('image/webp');
    expect((ground.source.data as FakeBitmap).closed).toBe(false);
    expect((bark.source.data as FakeBitmap).tag).toBe('image/png');
    expect([ground.version, groundClone.version, bark.version]).toEqual(versions.map((v) => v + 1));
    expect(images.closedCount).toBe(0);
    // And they close again after the next upload.
    expect(images.release(() => undefined)).toBe(2);
  });

  it('runs one decode at a time however often it is asked', async () => {
    const decode = vi.fn(async () => new FakeBitmap('again') as never);
    const { images } = setup(decode);
    images.release(() => undefined);
    await Promise.all([images.restore(), images.restore()]);
    expect(decode).toHaveBeenCalledTimes(2);
    // Nothing closed, nothing to decode.
    await images.restore();
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('keeps nothing decoded after the terrain is gone, and uploads nothing', async () => {
    const late = new FakeBitmap('late');
    const { images, ground } = setup(async () => late as never);
    images.release(() => undefined);
    const restoring = images.restore();
    images.dispose();
    await restoring;
    expect(late.closed).toBe(true);
    expect(ground.source.data).not.toBe(late);
    let uploads = 0;
    expect(images.release(() => uploads++)).toBe(0);
    expect(uploads).toBe(0);
  });
});
