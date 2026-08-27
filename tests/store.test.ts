// The disk layer: junk in, fallback out; a torn JSONL line loses one
// record, never the file.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendJsonl, loadJson, readJsonl, saveJsonAtomic } from '../server/store';

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
