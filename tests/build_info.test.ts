// What /api/public/build says about the software (server/build_info.ts):
// the rules' version, the content's fingerprint, and since the client
// reloads on a new build, the bundle the server serves, read off the
// built page at boot.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBuildId } from '../server/build_info';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dist(html: string | null): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-build-'));
  dirs.push(d);
  if (html !== null) {
    mkdirSync(path.join(d, 'dist'));
    writeFileSync(path.join(d, 'dist', 'index.html'), html);
  }
  return path.join(d, 'dist');
}

describe('the served build', () => {
  it('is the entry bundle the built page names', () => {
    const d = dist(
      '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-91YJ_gjc.js"></script></head></html>',
    );
    expect(readBuildId(d)).toBe('index-91YJ_gjc');
  });

  it('is null with no dist, which is development', () => {
    // The dev server serves the page; this server has nothing built and
    // must not make a client reload against a name it invented.
    expect(readBuildId(dist(null))).toBeNull();
  });

  it('is null for a page that names no bundle', () => {
    expect(readBuildId(dist('<html></html>'))).toBeNull();
  });
});
