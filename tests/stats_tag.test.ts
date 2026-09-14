// The tag the server puts on the entry document (server/stats_tag.ts).

import { describe, expect, it } from 'vitest';
import { isWebsiteId, STATS_SCRIPT, statsTag, withStatsTag } from '../server/stats_tag';
import { BEFORE_SEND_NAME } from '../src/net/stats';

const ID = '2b4f0a7e-3c1d-4e5f-8a9b-0c1d2e3f4a5b';
const PAGE =
  '<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body></body>\n</html>\n';

describe('the tag', () => {
  it('names a path on this origin, the site, and the hook the client installs', () => {
    const tag = statsTag(ID);
    expect(tag).toContain(`src="${STATS_SCRIPT}"`);
    expect(STATS_SCRIPT.startsWith('/')).toBe(true);
    expect(tag).toContain(`data-website-id="${ID}"`);
    expect(tag).toContain(`data-before-send="${BEFORE_SEND_NAME}"`);
    expect(tag).not.toMatch(/https?:\/\//);
  });

  it('lands once, at the end of the head', () => {
    const out = withStatsTag(PAGE, ID);
    expect(out.split(STATS_SCRIPT).length).toBe(2);
    expect(out.indexOf(statsTag(ID))).toBeLessThan(out.indexOf('</head>'));
    expect(out.indexOf(statsTag(ID))).toBeGreaterThan(out.indexOf('<title>'));
  });

  it('leaves the page alone with no site, a bad site, or no head', () => {
    expect(withStatsTag(PAGE, '')).toBe(PAGE);
    expect(withStatsTag(PAGE, '"><script>alert(1)</script>')).toBe(PAGE);
    expect(withStatsTag('<p>no head</p>', ID)).toBe('<p>no head</p>');
  });

  it('knows what a site id looks like', () => {
    expect(isWebsiteId(ID)).toBe(true);
    expect(isWebsiteId(ID.toUpperCase())).toBe(true);
    expect(isWebsiteId('abc')).toBe(false);
    expect(isWebsiteId(`${ID} `)).toBe(false);
  });
});
