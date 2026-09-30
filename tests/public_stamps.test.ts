// The content stamps of the files under public/ (scripts/public_stamps.ts):
// a file keeps its stamp for as long as its bytes stay the same, whatever
// else a deployment changes, and takes a new one the moment they do.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { contentStamp, STAMP_LENGTH, STAMPS_FILE, stampTable } from '../scripts/public_stamps';
import { STAMPS_FILE as READ_FROM } from '../server/static_files';
import { isStampTable } from '../src/game/asset_version';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('a content stamp', () => {
  it('is the same for the same bytes, however often it is taken', () => {
    expect(contentStamp(bytes('the orchard'))).toBe(contentStamp(bytes('the orchard')));
    expect(contentStamp(bytes('the orchard'))).toMatch(new RegExp(`^[0-9a-f]{${STAMP_LENGTH}}$`));
  });

  it('moves when a single byte does', () => {
    expect(contentStamp(bytes('the orchard'))).not.toBe(contentStamp(bytes('the orchare')));
    expect(contentStamp(new Uint8Array(0))).not.toBe(contentStamp(new Uint8Array(1)));
  });
});

describe('the table', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'loc-stamps-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  // A public/ in miniature: the map, a model, an icon.
  function publicDir(name: string, model: string): string {
    const dir = path.join(root, name);
    mkdirSync(path.join(dir, 'map', 'star-orchard'), { recursive: true });
    mkdirSync(path.join(dir, 'models', 'champions'), { recursive: true });
    writeFileSync(path.join(dir, 'map', 'star-orchard', 'map-light.glb'), 'terrain');
    writeFileSync(path.join(dir, 'models', 'champions', 'vesk.glb'), model);
    writeFileSync(path.join(dir, 'logo.webp'), 'crest');
    return dir;
  }

  it('names every file by its address, in a stable order', async () => {
    const table = await stampTable(publicDir('first', 'rig'));
    expect(Object.keys(table)).toEqual([
      '/logo.webp',
      '/map/star-orchard/map-light.glb',
      '/models/champions/vesk.glb',
    ]);
    expect(table['/models/champions/vesk.glb']).toBe(contentStamp(bytes('rig')));
    expect(isStampTable(table)).toBe(true);
  });

  it('gives two builds of the same files the same table', async () => {
    const a = await stampTable(publicDir('same-a', 'rig'));
    const b = await stampTable(publicDir('same-b', 'rig'));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('moves only the stamp of the file that changed', async () => {
    const before = await stampTable(publicDir('before', 'rig'));
    const after = await stampTable(publicDir('after', 'rig, retouched'));
    const moved = Object.keys(after).filter((address) => after[address] !== before[address]);
    expect(moved).toEqual(['/models/champions/vesk.glb']);
  });

  it('is written where the server reads it', () => {
    // The Vite config loads the writer, which may import nothing of the
    // game's; the server has its own copy of the name.
    expect(STAMPS_FILE).toBe(READ_FROM);
  });
});
