// What the landing promises a would-be contributor
// (ui/landing_contribute.ts). The one failure worth a gate is a link that
// points at a file the repository does not have: the section exists to be
// believed, and a 404 behind "read the guide" costs more than saying
// nothing would have.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTRIBUTE_LEAD, CONTRIBUTE_TITLE, CONTRIBUTE_WAYS } from '../src/ui/landing_contribute';
import { REPO } from '../src/ui/links';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the ways to contribute', () => {
  it('all point into this repository', () => {
    for (const way of CONTRIBUTE_WAYS) expect(way.href.startsWith(`${REPO}/`)).toBe(true);
  });

  it('point at files that exist, where they point at a file', () => {
    // A blob URL names a path in the tree, so it can be checked here. The
    // issue label page cannot be, and is exempt.
    for (const way of CONTRIBUTE_WAYS) {
      const blob = way.href.split('/blob/main/')[1];
      if (blob === undefined) continue;
      expect(`${blob}: ${existsSync(path.join(ROOT, blob))}`).toBe(`${blob}: true`);
    }
  });

  it('say what to do, in the imperative, and say why', () => {
    for (const way of CONTRIBUTE_WAYS) {
      expect(way.title.length).toBeGreaterThan(0);
      expect(way.cta.length).toBeGreaterThan(0);
      // Long enough to be a reason rather than a label. The tiles above
      // them are the shortest text on the page; this row has to earn a
      // scroll, so it is allowed more.
      expect(way.line.length).toBeGreaterThan(80);
      expect(way.line.length).toBeLessThan(220);
    }
  });

  it('are three, because a row of them is the shape the landing has room for', () => {
    expect(CONTRIBUTE_WAYS).toHaveLength(3);
  });

  it('lead with a claim and back it', () => {
    expect(CONTRIBUTE_TITLE.length).toBeGreaterThan(0);
    // The licence is the load-bearing word: "open" without it is a mood.
    expect(CONTRIBUTE_LEAD).toContain('MIT');
  });
});
