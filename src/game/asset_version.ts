// Every address the game loads while it runs, stamped so that it can only
// ever mean one content (CONTEXT.md: the rule that a deployment reaches
// every open tab by itself). The bundles are hashed by Vite and change
// name when they change; the files under public/ (models, the map,
// portraits, icons, sounds) keep their names, and the proxy in front hands
// a browser hours of cache on them whatever the server says. So their
// addresses carry a stamp as a query: a new content is a new address, and
// the cache in between has nothing to answer with.
//
// The stamp is the file's own: a hash of its bytes, which the build writes
// into a table (scripts/public_stamps.ts) the bundle carries. A deployment
// that leaves a file alone leaves its address alone, so a returning
// visitor keeps the map and the models across deployments and restarts,
// where the deployment's stamp made every one of them download everything
// again. An address the table does not name still takes the build id the
// server wrote into the page (server/build_tag.ts), which moves with every
// deployment; under the dev server there is neither and every address is
// left alone. Pure over its arguments, so tests can pin it; the page's
// stamp is read once.

import { buildIdFromMeta } from '../net/build_watch';

export const VERSION_PARAM = 'v';

// A file's address and the stamp of its content, as the build wrote them:
// '/models/champions/sylra.glb' -> '3f9a0c1d2e'.
export type StampTable = Readonly<Record<string, string>>;

const STAMP = /^[0-9a-f]{6,64}$/;

// A table as the build writes it: site addresses to hex stamps. Anything
// else (a hand-edited or truncated file) is not a table to trust.
export function isStampTable(value: unknown): value is StampTable {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, stamp]) => isSiteAddress(key) && typeof stamp === 'string' && STAMP.test(stamp),
  );
}

// Only addresses on this site: another origin, a blob or a data URL is
// not ours to version.
function isSiteAddress(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

export function withVersion(url: string, stamp: string | null): string {
  if (stamp === null || stamp === '' || !isSiteAddress(url)) return url;
  const hash = url.indexOf('#');
  const base = hash >= 0 ? url.slice(0, hash) : url;
  const tail = hash >= 0 ? url.slice(hash) : '';
  if (/[?&]v=/.test(base)) return url;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${VERSION_PARAM}=${encodeURIComponent(stamp)}${tail}`;
}

// The file an address names: its path, without the query or the fragment.
function pathOf(url: string): string {
  const end = url.search(/[?#]/);
  return end >= 0 ? url.slice(0, end) : url;
}

// The stamp an address goes out with: its file's own when the table names
// it, the deployment's otherwise, so nothing the table misses can outlive
// a deployment in a cache.
export function stampFor(url: string, files: StampTable, build: string | null): string | null {
  const file = pathOf(url);
  return Object.hasOwn(files, file) ? (files[file] ?? build) : build;
}

export function stampedAddress(url: string, files: StampTable, build: string | null): string {
  return withVersion(url, stampFor(url, files, build));
}

// The build's table, written into the bundle as a constant
// (vite.config.ts); the dev server, the tests and the server's own bundle
// run without one and find it empty.
declare global {
  var __LOC_FILE_STAMPS__: StampTable | undefined;
}
const FILES: StampTable = globalThis.__LOC_FILE_STAMPS__ ?? {};

let pageStamp: string | null | undefined;

export function currentStamp(): string | null {
  if (pageStamp === undefined) {
    pageStamp = typeof document === 'undefined' ? null : buildIdFromMeta(document);
  }
  return pageStamp;
}

export function versioned(url: string): string {
  return stampedAddress(url, FILES, currentStamp());
}
