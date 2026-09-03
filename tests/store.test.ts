// The disk layer: junk in, fallback out; a torn JSONL line loses one
// record, never the file.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendJsonl,
  loadJson,
  maxNumberedJson,
  pruneNumberedJson,
  readJsonl,
  saveJsonAtomic,
} from '../server/store';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-store-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('json store', () => {
  it('round-trips json and creates parent directories', () => {
    const file = path.join(tmp(), 'deep', 'players.json');
    expect(loadJson(file, [])).toEqual([]);
    saveJsonAtomic(file, [{ id: 1, name: 'bob' }]);
    expect(loadJson(file, [])).toEqual([{ id: 1, name: 'bob' }]);
  });

  it('falls back on corrupt json', () => {
    const file = path.join(tmp(), 'bad.json');
    writeFileSync(file, '{nope');
    expect(loadJson(file, { ok: true })).toEqual({ ok: true });
  });

  it('prunes numbered json files, keeping the highest numbers', () => {
    const dir = tmp();
    for (const n of [3, 10, 7, 1, 22]) saveJsonAtomic(path.join(dir, `${n}.json`), { n });
    saveJsonAtomic(path.join(dir, 'players.json'), []);
    const doomed = pruneNumberedJson(dir, 2);
    expect(doomed.sort((a, b) => a - b)).toEqual([1, 3, 7]);
    expect(loadJson(path.join(dir, '22.json'), null)).toEqual({ n: 22 });
    expect(loadJson(path.join(dir, '10.json'), null)).toEqual({ n: 10 });
    expect(loadJson(path.join(dir, '3.json'), null)).toBeNull();
    // Non-numbered files are never touched; a missing dir is a no-op.
    expect(loadJson(path.join(dir, 'players.json'), null)).toEqual([]);
    expect(pruneNumberedJson(path.join(dir, 'nope'), 2)).toEqual([]);
  });

  // The regression behind it: match ids restarted at 1 on every boot, so
  // a fresh match overwrote the replay file an older Record entry still
  // pointed at, and its Match sheet opened somebody else's match.
  it('reads the highest numbered json back, for the id restart at boot', () => {
    const dir = tmp();
    for (const n of [3, 10, 22]) saveJsonAtomic(path.join(dir, `${n}.json`), { n });
    saveJsonAtomic(path.join(dir, 'players.json'), []);
    expect(maxNumberedJson(dir)).toBe(22);
    expect(maxNumberedJson(path.join(dir, 'nope'))).toBe(0);
    expect(maxNumberedJson(tmp())).toBe(0);
  });

  it('appends jsonl lines and skips a torn last line', () => {
    const file = path.join(tmp(), 'matches.jsonl');
    expect(readJsonl(file)).toEqual([]);
    appendJsonl(file, { m: 1 });
    appendJsonl(file, { m: 2 });
    // Simulate a crash mid-append: a truncated trailing line.
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"m":3,"trunc`);
    expect(readJsonl(file)).toEqual([{ m: 1 }, { m: 2 }]);
  });
});
