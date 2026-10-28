// A whole-file save on a full disk: the write fails partway, the error
// still reaches the caller, the file keeps its last good copy, and no torn
// `<file>.tmp` is left holding the space a full disk needs back (a replay's
// `<id>.json.tmp` is never pruned, it matches no `<n>.json`).

import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const full = vi.hoisted(() => ({ on: false }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const writeFileSync: typeof real.writeFileSync = (file, data, options) => {
    if (!full.on) return real.writeFileSync(file, data, options);
    // The bytes that fit, then the disk is full.
    real.writeFileSync(file, String(data).slice(0, 5));
    throw Object.assign(new Error('ENOSPC: no space left on device, write'), {
      code: 'ENOSPC',
    });
  };
  return { ...real, default: { ...real, writeFileSync }, writeFileSync };
});

const { loadJson, saveJsonAtomic } = await import('../server/store');

const dirs: string[] = [];
afterEach(() => {
  full.on = false;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('saveJsonAtomic on a full disk', () => {
  it('throws, keeps the last good file, and leaves no torn tmp behind', () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'loc-store-full-'));
    dirs.push(dir);
    const file = path.join(dir, '12.json');
    saveJsonAtomic(file, { id: 12, ticks: [1, 2, 3] });
    full.on = true;
    expect(() => saveJsonAtomic(file, { id: 12, ticks: [4, 5, 6] })).toThrow(/ENOSPC/);
    full.on = false;
    expect(loadJson(file, null)).toEqual({ id: 12, ticks: [1, 2, 3] });
    expect(fs.readdirSync(dir)).toEqual(['12.json']);
  });
});
