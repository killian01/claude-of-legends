// Player identity: token in, stable player out, discriminators unique per
// name, everything surviving a registry reload from disk.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handleOf, PlayerRegistry } from '../server/players';

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-players-'));
  dirs.push(d);
  return path.join(d, 'players.json');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Deterministic discriminators: first free value from 1000 up.
const seqDisc = (used: ReadonlySet<number>): number => {
  for (let d = 1000; ; d++) if (!used.has(d)) return d;
};

describe('player registry', () => {
  it('creates once per token and refreshes name and last-seen', () => {
    const reg = new PlayerRegistry(tmpFile(), seqDisc);
    const a = reg.getOrCreate('tok-a', 'bob', 100);
    expect(a.id).toBe(1);
    expect(handleOf(a)).toBe('bob#1000');
    const same = reg.getOrCreate('tok-a', 'bob', 200);
    expect(same.id).toBe(1);
    expect(same.seenAt).toBe(200);
    const renamed = reg.getOrCreate('tok-a', 'bobby', 300);
    expect(renamed.id).toBe(1);
    expect(renamed.name).toBe('bobby');
    // The disc is stable across a rename with no collision.
    expect(renamed.disc).toBe(1000);
  });

  it('keeps two bobs apart, including through a rename collision', () => {
    const reg = new PlayerRegistry(tmpFile(), seqDisc);
    const a = reg.getOrCreate('tok-a', 'bob', 1);
    const b = reg.getOrCreate('tok-b', 'bob', 2);
    expect(a.disc).not.toBe(b.disc);
    // c is carl#1000; renaming to bob collides with bob#1000: fresh disc.
    const c = reg.getOrCreate('tok-c', 'carl', 3);
    expect(c.disc).toBe(1000);
    const cAsBob = reg.getOrCreate('tok-c', 'bob', 4);
    expect(cAsBob.disc).not.toBe(a.disc);
    expect(cAsBob.disc).not.toBe(b.disc);
  });

  it('survives a reload from disk with ids intact', () => {
    const file = tmpFile();
    const reg = new PlayerRegistry(file, seqDisc);
    reg.getOrCreate('tok-a', 'bob', 1);
    reg.getOrCreate('tok-b', 'ana', 2);
    const reloaded = new PlayerRegistry(file, seqDisc);
    expect(reloaded.count).toBe(2);
    expect(reloaded.findByToken('tok-b')?.name).toBe('ana');
    // New creations continue the id sequence instead of reusing ids.
    expect(reloaded.getOrCreate('tok-c', 'cid', 3).id).toBe(3);
    expect(reloaded.findById(1)?.name).toBe('bob');
  });
});
