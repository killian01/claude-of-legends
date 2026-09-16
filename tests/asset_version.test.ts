// The stamp on every address the game loads while it runs
// (src/game/asset_version.ts).

import { describe, expect, it } from 'vitest';
import { withVersion } from '../src/game/asset_version';

describe('a versioned address', () => {
  it('carries the stamp as a query', () => {
    expect(withVersion('/models/champions/sylra.glb', 'index-abc.k9x')).toBe(
      '/models/champions/sylra.glb?v=index-abc.k9x',
    );
    expect(withVersion('/map/star-orchard/map.glb?x=1', 's')).toBe(
      '/map/star-orchard/map.glb?x=1&v=s',
    );
    expect(withVersion('/art/a.webp#top', 's')).toBe('/art/a.webp?v=s#top');
  });

  it('is left alone without a stamp, which is the dev server', () => {
    expect(withVersion('/models/a.glb', null)).toBe('/models/a.glb');
    expect(withVersion('/models/a.glb', '')).toBe('/models/a.glb');
  });

  it('never touches what is not an address on this site', () => {
    for (const url of [
      'blob:https://claudeoflegends.com/1234',
      'data:image/webp;base64,AAAA',
      'https://elsewhere.example/a.glb',
      '//cdn.example/a.glb',
    ]) {
      expect(withVersion(url, 's')).toBe(url);
    }
  });

  it('stamps once', () => {
    expect(withVersion('/a.glb?v=old', 'new')).toBe('/a.glb?v=old');
  });
});
