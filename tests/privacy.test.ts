// PRIVACY.md makes promises about what the site does and does not load.
// On an open repository those are checkable, so they are checked here: a
// privacy page that quietly stops being true is worse than none at all,
// because it is the one document a reader has no way to verify by playing.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STATS_SCRIPT, statsTag } from '../server/stats_tag';
import {
  CHOICE_PARAM,
  DISABLED_KEY,
  MATCH_ENDS,
  OLD_VISIT_KEY,
  STATS_STEPS,
} from '../src/net/stats';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('the promise that no third party sees a visitor', () => {
  it('is kept by the page that loads first', () => {
    // The entry document is the whole of the exposure: everything after it
    // is bundled from this repository. One absolute URL in here and a
    // company that is not us learns every visitor's address before a pixel
    // is drawn, which is exactly what the page says does not happen.
    const html = read('index.html');
    const external = [...html.matchAll(/(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(external).toEqual([]);
  });

  it('is kept by the tag the server adds to it', () => {
    // The one thing the deployment can put on the page names a path on
    // this origin, never a host: the counter is reached through the game's
    // own address (server/stats_tag.ts).
    const tag = statsTag('2b4f0a7e-3c1d-4e5f-8a9b-0c1d2e3f4a5b');
    expect(tag).not.toMatch(/https?:\/\//);
    expect(tag).toContain(`src="${STATS_SCRIPT}"`);
  });

  it('is kept by the client, which loads no tracker and no CDN', () => {
    // A denylist rather than an allowlist, because the client legitimately
    // names plenty of URLs in prose. These are the ones whose presence
    // would mean a request leaves for somebody else's server.
    const hosts = [
      'googletagmanager.com',
      'google-analytics.com',
      'connect.facebook.net',
      'fonts.googleapis.com',
      'fonts.gstatic.com',
      'cdn.jsdelivr.net',
      'unpkg.com',
      'cdnjs.cloudflare.com',
      'cloud.umami.is',
    ];
    const files = ['index.html', 'src/main.ts', 'src/ui/page.ts', 'src/net/stats.ts'];
    for (const file of files) {
      const text = read(file);
      for (const host of hosts) expect(`${file}: ${text.includes(host)}`).toBe(`${file}: false`);
    }
  });
});

describe('the opt-out', () => {
  it('is named on the page the way the client reads it', () => {
    // The page tells a reader how to be left out and which key that
    // writes. Renaming either without touching the page would leave the
    // reader doing something that no longer works, which is the same as
    // hiding it.
    const page = read('PRIVACY.md');
    expect(page).toContain(`\`?${CHOICE_PARAM}=off\``);
    expect(page).toContain(`\`${DISABLED_KEY}\``);
    expect(page).toContain(`\`${OLD_VISIT_KEY}\``);
  });
});

describe('the events the client sends', () => {
  it('are every one named on the page', () => {
    // The events are the part of the record this repository adds to what
    // the counter does on its own, so a fourth one must not be able to
    // appear in the code and stay off the page.
    const page = read('PRIVACY.md');
    for (const step of [...STATS_STEPS, ...MATCH_ENDS]) {
      expect(`${step}: ${page.includes(`\`${step}\``)}`).toBe(`${step}: true`);
    }
  });
});
