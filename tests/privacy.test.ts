// PRIVACY.md makes promises about what the site does and does not load.
// On an open repository those are checkable, so they are checked here: a
// privacy page that quietly stops being true is worse than none at all,
// because it is the one document a reader has no way to verify by playing.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyDay } from '../server/pulse';
import { VISIT_KEY } from '../src/net/pulse_ping';

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
    ];
    const files = ['index.html', 'src/main.ts', 'src/ui/page.ts'];
    for (const file of files) {
      const text = read(file);
      for (const host of hosts) expect(`${file}: ${text.includes(host)}`).toBe(`${file}: false`);
    }
  });
});

describe('the one line the client stores', () => {
  it('is named on the page under the key the client really writes', () => {
    // The page promises a browser exactly one stored value and names it.
    // Renaming the key without touching the page would leave a reader
    // looking for something that is not there, which is the same as
    // hiding it.
    expect(read('PRIVACY.md')).toContain(`\`${VISIT_KEY}\``);
  });
});

describe('the table of what is counted', () => {
  it('lists every counter the server actually keeps', () => {
    // The counters are the part a reader most needs to trust, so a sixth
    // one must not be able to appear in the code and stay out of the page.
    const page = read('PRIVACY.md');
    for (const key of Object.keys(emptyDay('2026-09-06'))) {
      if (key === 'day') continue;
      expect(`${key}: ${page.includes(`\`${key}\``)}`).toBe(`${key}: true`);
    }
  });
});
