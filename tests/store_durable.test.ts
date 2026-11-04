// A whole-file save reaches the disk before it takes the file's name: the
// tmp is flushed (fsync) and only then renamed over the last good copy. A
// rename that lands before the bytes do leaves an empty accounts or
// sessions file after a power loss, which loadJson then sets aside.

import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const writeFileSync: typeof real.writeFileSync = (file, data, options) => {
    const flush = typeof options === 'object' && options !== null && options.flush === true;
    calls.push(`write ${path.basename(String(file))}${flush ? ' flushed' : ''}`);
    return real.writeFileSync(file, data, options);
  };
  const renameSync: typeof real.renameSync = (from, to) => {
    calls.push(`rename ${path.basename(String(from))} ${path.basename(String(to))}`);
    return real.renameSync(from, to);
  };
  const fns = { writeFileSync, renameSync };
  return { ...real, default: { ...real, ...fns }, ...fns };
});

const { loadJson, saveJsonAtomic } = await import('../server/store');

const dirs: string[] = [];
afterEach(() => {
  calls.length = 0;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('saveJsonAtomic', () => {
  it('flushes the tmp to the disk before renaming it over the file', () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'loc-store-durable-'));
    dirs.push(dir);
    const file = path.join(dir, 'accounts.json');
    saveJsonAtomic(file, { nextId: 2, accounts: [{ id: 1 }] });
    expect(calls).toEqual([
      'write accounts.json.tmp flushed',
      'rename accounts.json.tmp accounts.json',
    ]);
    expect(loadJson(file, null)).toEqual({ nextId: 2, accounts: [{ id: 1 }] });
    expect(fs.readdirSync(dir)).toEqual(['accounts.json']);
  });
});
