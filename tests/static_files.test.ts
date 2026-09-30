// How the server answers for a built file (server/static_files.ts): the
// cache rule that keeps every deployment reaching every tab while a
// returning visitor keeps the map (across deployments too, by the file's
// own content stamp), the validator for what must be revalidated, and the
// gzip twin the build wrote (scripts/precompress.ts) sent in place of the
// file when the browser takes it.

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  acceptsGzip,
  cacheControlFor,
  carriesFileStamp,
  carriesStamp,
  etagFor,
  etagMatches,
  IMMUTABLE,
  planStatic,
  REVALIDATE,
  readFileStamps,
  type StaticFile,
  type StaticRequest,
  statStaticFile,
} from '../server/static_files';

const BUILD = 'index-abc123.t2k9x0';
const GLB = 'model/gltf-binary';

const map = (over: Partial<StaticFile> = {}): StaticFile => ({
  entry: false,
  size: 14_102_380,
  mtimeMs: 1_000_000,
  gzip: { size: 9_265_933, mtimeMs: 1_000_500 },
  ...over,
});

const ask = (over: Partial<StaticRequest> = {}): StaticRequest => ({
  pathname: '/map/star-orchard/map-light.glb',
  search: `?v=${BUILD}`,
  acceptEncoding: 'gzip, deflate, br, zstd',
  ...over,
});

describe('the cache rule', () => {
  it('keeps an address stamped with this build for good', () => {
    expect(carriesStamp(`?v=${BUILD}`, BUILD)).toBe(true);
    expect(carriesStamp(`?x=1&v=${BUILD}`, BUILD)).toBe(true);
    expect(cacheControlFor(ask(), false, BUILD)).toBe(IMMUTABLE);
  });

  it('revalidates an address without the stamp, or with another build', () => {
    expect(cacheControlFor(ask({ search: '' }), false, BUILD)).toBe(REVALIDATE);
    // A tab from before the deployment asks with its own stamp: the file
    // it gets now is not the one that stamp named.
    expect(cacheControlFor(ask({ search: '?v=index-abc123.old' }), false, BUILD)).toBe(REVALIDATE);
    expect(cacheControlFor(ask({ search: '?w=1' }), false, BUILD)).toBe(REVALIDATE);
  });

  it('never keeps anything for good without a build, which is development', () => {
    expect(cacheControlFor(ask(), false, null)).toBe(REVALIDATE);
  });

  it('always revalidates the entry document, stamp or not', () => {
    expect(cacheControlFor(ask({ pathname: '/' }), true, BUILD)).toBe(REVALIDATE);
    // A stamped address that does not exist falls back to the page.
    expect(cacheControlFor(ask({ pathname: '/models/gone.glb' }), true, BUILD)).toBe(REVALIDATE);
  });

  it("keeps Vite's fingerprinted bundles for good", () => {
    expect(
      cacheControlFor(ask({ pathname: '/assets/index-abc.js', search: '' }), false, null),
    ).toBe(IMMUTABLE);
  });
});

describe("the cache rule on a file's own stamp", () => {
  // The build's table (scripts/public_stamps.ts), as this server read it.
  const FILES = {
    '/map/star-orchard/map-light.glb': 'c93138c36c',
    '/models/champions/vesk.glb': '0a1b2c3d4e',
  };
  const light = (search: string) => ask({ search });

  it('keeps an address stamped with its content for good, whatever the build', () => {
    expect(carriesFileStamp('/map/star-orchard/map-light.glb', '?v=c93138c36c', FILES)).toBe(true);
    expect(cacheControlFor(light('?v=c93138c36c'), false, BUILD, FILES)).toBe(IMMUTABLE);
    // Another deployment, the same map: still the same address, still kept.
    expect(cacheControlFor(light('?v=c93138c36c'), false, 'index-def456.t2m0a1', FILES)).toBe(
      IMMUTABLE,
    );
    expect(planStatic(light('?v=c93138c36c'), map(), 'index-def456.t2m0a1', GLB, FILES)).toEqual(
      expect.objectContaining({ headers: expect.objectContaining({ 'cache-control': IMMUTABLE }) }),
    );
  });

  it('revalidates a stamp that is not the content on disk', () => {
    // A tab from before the map changed asks with the old stamp.
    expect(carriesFileStamp('/map/star-orchard/map-light.glb', '?v=0000000000', FILES)).toBe(false);
    expect(cacheControlFor(light('?v=0000000000'), false, BUILD, FILES)).toBe(REVALIDATE);
    // Another file's stamp names another content.
    expect(cacheControlFor(light('?v=0a1b2c3d4e'), false, BUILD, FILES)).toBe(REVALIDATE);
    // A file the table does not name has no stamp of its own to match.
    expect(carriesFileStamp('/models/gone.glb', '?v=c93138c36c', FILES)).toBe(false);
    expect(carriesFileStamp('/map/star-orchard/map-light.glb', '', FILES)).toBe(false);
  });

  it('still keeps the build id for what the table does not name', () => {
    const other = ask({ pathname: '/models/champions/new.glb', search: `?v=${BUILD}` });
    expect(cacheControlFor(other, false, BUILD, FILES)).toBe(IMMUTABLE);
  });

  it('never keeps the entry document, whatever it carries', () => {
    expect(cacheControlFor(light('?v=c93138c36c'), true, BUILD, FILES)).toBe(REVALIDATE);
  });
});

describe("the build's table off the disk", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const dist = (stamps: string | null): string => {
    const d = mkdtempSync(path.join(tmpdir(), 'loc-stamps-dist-'));
    dirs.push(d);
    if (stamps !== null) writeFileSync(path.join(d, 'stamps.json'), stamps);
    return d;
  };

  it('is the copy the build wrote beside the client', () => {
    const table = { '/logo.webp': '095f521343' };
    expect(readFileStamps(dist(JSON.stringify(table)))).toEqual(table);
  });

  it('is empty without a copy, or with one that is not a table', () => {
    expect(readFileStamps(dist(null))).toEqual({});
    expect(readFileStamps(dist('{"/logo.webp":'))).toEqual({});
    expect(readFileStamps(dist('{"/logo.webp":"not a stamp"}'))).toEqual({});
    expect(readFileStamps(dist('["/logo.webp"]'))).toEqual({});
  });
});

describe('the gzip twin', () => {
  it('goes out to a browser that takes gzip, with its own length', () => {
    const plan = planStatic(ask(), map(), BUILD, GLB);
    expect(plan.status).toBe(200);
    expect(plan.gzip).toBe(true);
    expect(plan.headers).toMatchObject({
      'content-type': GLB,
      'content-encoding': 'gzip',
      'content-length': '9265933',
      vary: 'Accept-Encoding',
      'cache-control': IMMUTABLE,
    });
  });

  it('stays home for a browser that does not take gzip', () => {
    for (const acceptEncoding of [undefined, '', 'identity', 'br', 'gzip;q=0', '*;q=0']) {
      const plan = planStatic(ask({ acceptEncoding }), map(), BUILD, GLB);
      expect(plan.gzip).toBe(false);
      expect(plan.headers['content-encoding']).toBeUndefined();
      expect(plan.headers['content-length']).toBe('14102380');
      // The answer still depends on the header, and says so.
      expect(plan.headers.vary).toBe('Accept-Encoding');
    }
  });

  it('is ignored when it is older than its file', () => {
    const plan = planStatic(ask(), map({ gzip: { size: 10, mtimeMs: 999_999 } }), BUILD, GLB);
    expect(plan.gzip).toBe(false);
    expect(plan.headers['content-length']).toBe('14102380');
    expect(plan.headers.vary).toBeUndefined();
  });

  it('is never sent in place of the entry document', () => {
    const entry: StaticFile = { entry: true, size: 2048, mtimeMs: 0, gzip: null };
    const plan = planStatic(ask({ pathname: '/', search: '' }), entry, BUILD, 'text/html');
    expect(plan).toEqual({
      status: 200,
      gzip: false,
      headers: {
        'content-type': 'text/html',
        'cache-control': REVALIDATE,
        'content-length': '2048',
      },
    });
  });

  it('reads what the browser accepts, weights included', () => {
    expect(acceptsGzip('gzip')).toBe(true);
    expect(acceptsGzip('br, gzip;q=0.5')).toBe(true);
    expect(acceptsGzip('x-gzip')).toBe(true);
    expect(acceptsGzip('*')).toBe(true);
    expect(acceptsGzip('gzip;q=0, *')).toBe(false);
    expect(acceptsGzip('deflate, br')).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });
});

describe('the validator', () => {
  it('differs between the file and its twin', () => {
    expect(etagFor(10, 5, false)).not.toBe(etagFor(10, 5, true));
    const raw = planStatic(ask({ acceptEncoding: undefined }), map(), BUILD, GLB);
    const packed = planStatic(ask(), map(), BUILD, GLB);
    expect(raw.headers.etag).not.toBe(packed.headers.etag);
  });

  it('answers a revalidation that still holds with 304 and no body', () => {
    const first = planStatic(ask({ search: '' }), map(), BUILD, GLB);
    const tag = first.headers.etag ?? '';
    const again = planStatic(ask({ search: '', ifNoneMatch: tag }), map(), BUILD, GLB);
    expect(again.status).toBe(304);
    expect(again.headers['content-length']).toBeUndefined();
    expect(again.headers['cache-control']).toBe(REVALIDATE);
    // A rebuilt file is a new tag.
    const rebuilt = map({ mtimeMs: 2_000_000, gzip: { size: 1, mtimeMs: 2_000_001 } });
    expect(planStatic(ask({ search: '', ifNoneMatch: tag }), rebuilt, BUILD, GLB).status).toBe(200);
  });

  it('compares weakly, in a list', () => {
    expect(etagMatches('"a", W/"x-1"', 'W/"x-1"')).toBe(true);
    expect(etagMatches('"x-1"', 'W/"x-1"')).toBe(true);
    expect(etagMatches('*', 'W/"x-1"')).toBe(true);
    expect(etagMatches('W/"x-2"', 'W/"x-1"')).toBe(false);
    expect(etagMatches(undefined, 'W/"x-1"')).toBe(false);
  });
});

describe('the facts off the disk', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'loc-static-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('finds the twin beside the file, and does without one', async () => {
    const glb = path.join(dir, 'a.glb');
    writeFileSync(glb, Buffer.alloc(4000));
    writeFileSync(`${glb}.gz`, Buffer.alloc(40));
    utimesSync(glb, 100, 100);
    utimesSync(`${glb}.gz`, 200, 200);
    const found = await statStaticFile(glb);
    expect(found).toMatchObject({ entry: false, size: 4000, gzip: { size: 40 } });
    expect(planStatic(ask(), found, BUILD, GLB).gzip).toBe(true);

    const plain = path.join(dir, 'b.webp');
    writeFileSync(plain, Buffer.alloc(500));
    expect((await statStaticFile(plain)).gzip).toBeNull();
    await expect(statStaticFile(path.join(dir, 'missing.glb'))).rejects.toThrow();
  });
});
