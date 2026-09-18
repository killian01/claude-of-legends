// The build written into the page (server/build_tag.ts).

import { describe, expect, it } from 'vitest';
import { buildId, deployStamp } from '../server/build_info';
import { buildTag, isBuildId, withBuildTag } from '../server/build_tag';
import { buildIdFromMeta } from '../src/net/build_watch';

const PAGE =
  '<!doctype html>\n<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body></body>\n</html>\n';

describe('the build id', () => {
  it('is the bundle and the stamp of the deployment, or nothing without a bundle', () => {
    expect(buildId('index-abc', 'k9x')).toBe('index-abc.k9x');
    expect(buildId(null, 'k9x')).toBeNull();
    expect(deployStamp(1_700_000_000_000)).toBe((1_700_000_000).toString(36));
    expect(isBuildId(buildId('index-abc', deployStamp()) ?? '')).toBe(true);
  });

  it('moves with the deployment and with the bundle', () => {
    expect(buildId('index-abc', 'a')).not.toBe(buildId('index-abc', 'b'));
    expect(buildId('index-abc', 'a')).not.toBe(buildId('index-abd', 'a'));
  });
});

describe('the tag', () => {
  it('lands once at the end of the head, and the client reads it back', () => {
    const out = withBuildTag(PAGE, 'index-abc.k9x');
    expect(out.split('meta name="build"').length).toBe(2);
    expect(out.indexOf(buildTag('index-abc.k9x'))).toBeLessThan(out.indexOf('</head>'));
    const doc = {
      querySelector: (sel: string) =>
        sel === 'meta[name="build"]' ? { getAttribute: () => 'index-abc.k9x' } : null,
    };
    expect(buildIdFromMeta(doc)).toBe('index-abc.k9x');
  });

  it('leaves the page alone without a build, with a bad one, or with no head', () => {
    expect(withBuildTag(PAGE, null)).toBe(PAGE);
    expect(withBuildTag(PAGE, '"><script>x</script>')).toBe(PAGE);
    expect(withBuildTag('<p>no head</p>', 'index-abc.k9x')).toBe('<p>no head</p>');
  });

  it('is nothing to a page without the tag, which is the dev server', () => {
    expect(buildIdFromMeta({ querySelector: () => null })).toBeNull();
    expect(
      buildIdFromMeta({ querySelector: () => ({ getAttribute: () => 'not ok!' }) }),
    ).toBeNull();
  });
});
