// The build's gzip twins (scripts/precompress.ts): written beside the big
// compressible files, byte for byte the file once decoded, and nowhere
// they would not pay (pictures, sounds, small files, the entry document).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { precompressDir, worthCompressing } from '../scripts/precompress';

describe('the gzip twins', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'loc-precompress-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('picks the formats that compress, above a size', () => {
    expect(worthCompressing('map/star-orchard/map-light.glb', 14_000_000)).toBe(true);
    expect(worthCompressing('map/star-orchard/navigation.bin', 460_800)).toBe(true);
    expect(worthCompressing('map/star-orchard/manifest.json', 105_984)).toBe(true);
    expect(worthCompressing('vendor/basis/basis_transcoder.wasm', 527_333)).toBe(true);
    for (const file of ['art/home_end.jpg', 'icons/a.webp', 'sfx/a.ogg', 'voice/a.mp3']) {
      expect(worthCompressing(file, 1_000_000)).toBe(false);
    }
    expect(worthCompressing('index.html', 50_000)).toBe(false);
    expect(worthCompressing('tiny.json', 100)).toBe(false);
  });

  it('writes a twin that decodes to the file, only where it saves', async () => {
    mkdirSync(path.join(dir, 'map'), { recursive: true });
    // A walkability grid: long runs, as the real one has.
    const grid = Buffer.alloc(200_000, 1);
    grid.fill(0, 50_000, 120_000);
    writeFileSync(path.join(dir, 'map', 'navigation.bin'), grid);
    // Noise does not compress, like a model that is all WebP: no twin.
    let x = 2463534242;
    const noise = Buffer.alloc(50_000);
    for (let i = 0; i < noise.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      noise[i] = (x >>> 24) & 0xff;
    }
    writeFileSync(path.join(dir, 'map', 'noise.glb'), noise);
    writeFileSync(path.join(dir, 'art.webp'), Buffer.alloc(100_000));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html>'.repeat(1000));

    const report = await precompressDir(dir);
    expect(report.files).toBe(1);
    expect(report.before).toBe(200_000);
    expect(report.after).toBeLessThan(2_000);

    const twin = readFileSync(path.join(dir, 'map', 'navigation.bin.gz'));
    expect(gunzipSync(twin).equals(grid)).toBe(true);
    expect(existsSync(path.join(dir, 'map', 'noise.glb.gz'))).toBe(false);
    expect(existsSync(path.join(dir, 'art.webp.gz'))).toBe(false);
    expect(existsSync(path.join(dir, 'index.html.gz'))).toBe(false);
  });
});
