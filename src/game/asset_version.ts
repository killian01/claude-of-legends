// Every address the game loads while it runs, stamped with the build it
// runs under (CONTEXT.md: the rule that a deployment reaches every open
// tab by itself). The bundles are hashed by Vite and change name when
// they change; the files under public/ (models, the map, portraits,
// icons, sounds) keep their names, and the proxy in front hands a
// browser hours of cache on them whatever the server says. So their
// addresses carry the deployment's stamp as a query: a new deployment is
// a new address, and the cache in between has nothing to answer with.
//
// The stamp is the build id the server wrote into the page
// (server/build_tag.ts); under the dev server there is none and every
// address is left alone. Pure over its arguments, so tests can pin it;
// the page's stamp is read once.

import { buildIdFromMeta } from '../net/build_watch';

export const VERSION_PARAM = 'v';

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

let pageStamp: string | null | undefined;

export function currentStamp(): string | null {
  if (pageStamp === undefined) {
    pageStamp = typeof document === 'undefined' ? null : buildIdFromMeta(document);
  }
  return pageStamp;
}

export function versioned(url: string): string {
  return withVersion(url, currentStamp());
}
