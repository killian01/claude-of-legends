// The stamp on every address the game loads while it runs
// (src/game/asset_version.ts).

import { describe, expect, it } from 'vitest';
import {
  isStampTable,
  type StampTable,
  stampedAddress,
  stampFor,
  versioned,
  withVersion,
} from '../src/game/asset_version';

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

// The build's table (scripts/public_stamps.ts) and the deployment's id.
const FILES: StampTable = {
  '/map/star-orchard/map-light.glb': 'c93138c36c',
  '/models/champions/vesk.glb': '0a1b2c3d4e',
};
const BUILD = 'index-abc123.t2k9x0';

describe('the stamp an address goes out with', () => {
  it("is its file's own content stamp when the build's table names it", () => {
    expect(stampedAddress('/map/star-orchard/map-light.glb', FILES, BUILD)).toBe(
      '/map/star-orchard/map-light.glb?v=c93138c36c',
    );
    // The same file after another deployment: the same address, which the
    // browser still holds.
    expect(stampedAddress('/map/star-orchard/map-light.glb', FILES, 'index-def456.t2m0a1')).toBe(
      '/map/star-orchard/map-light.glb?v=c93138c36c',
    );
  });

  it('finds the file past a query or a fragment', () => {
    expect(stampFor('/models/champions/vesk.glb?x=1', FILES, BUILD)).toBe('0a1b2c3d4e');
    expect(stampedAddress('/models/champions/vesk.glb#rig', FILES, BUILD)).toBe(
      '/models/champions/vesk.glb?v=0a1b2c3d4e#rig',
    );
  });

  it("is the deployment's for an address the table does not name", () => {
    expect(stampedAddress('/models/champions/new.glb', FILES, BUILD)).toBe(
      `/models/champions/new.glb?v=${BUILD}`,
    );
    // An inherited name is not a file of the table.
    expect(stampFor('/constructor', FILES, BUILD)).toBe(BUILD);
  });

  it('is none under the dev server, which has neither', () => {
    expect(stampedAddress('/models/champions/vesk.glb', {}, null)).toBe(
      '/models/champions/vesk.glb',
    );
    // Nothing loaded under the tests is stamped either: no bundle, no page.
    expect(versioned('/models/champions/vesk.glb')).toBe('/models/champions/vesk.glb');
  });

  it('never stamps what is not an address on this site', () => {
    expect(stampedAddress('blob:https://claudeoflegends.com/1234', FILES, BUILD)).toBe(
      'blob:https://claudeoflegends.com/1234',
    );
  });
});

describe('a table', () => {
  it('maps site addresses to hex stamps', () => {
    expect(isStampTable(FILES)).toBe(true);
    expect(isStampTable({})).toBe(true);
  });

  it('is nothing else', () => {
    for (const value of [
      null,
      [],
      'stamps',
      { 'models/a.glb': 'c93138c36c' },
      { '//cdn/a.glb': 'c93138c36c' },
      { '/a.glb': 'NOT-HEX!' },
      { '/a.glb': 42 },
    ]) {
      expect(isStampTable(value)).toBe(false);
    }
  });
});
