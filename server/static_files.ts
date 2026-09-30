// How the server answers for a file of the built client (dist/): which
// cache rule it goes out under, which validator it carries, and whether
// the gzip twin the build wrote beside it (scripts/precompress.ts) goes
// out in its place. Pure over the request's facts and the file's, so the
// tests pin every choice; server/main.ts only stats the files and streams
// the one chosen.
//
// The cache rule keeps the deployment reaching every open tab (CONTEXT.md):
// the entry document, and any address without this deployment's stamp, is
// revalidated on every use, while an address that carries the stamp the
// page was served under (src/game/asset_version.ts) can never mean another
// file, since the stamp moves with every deployment and every restart
// (server/build_info.ts). So a returning visitor's second match, or a
// reload, costs nothing for the map and the models.

import { stat } from 'node:fs/promises';
import { VERSION_PARAM } from '../src/game/asset_version';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'no-cache';

export interface StaticRequest {
  // The address's path and its query string ('' or '?...').
  pathname: string;
  search: string;
  acceptEncoding?: string | undefined;
  ifNoneMatch?: string | undefined;
}

export interface StaticFile {
  // The entry document: rewritten for every request (the build tag, the
  // counter's tag, the visit id), so never precompressed, never given a
  // validator, always revalidated.
  entry: boolean;
  size: number;
  mtimeMs: number;
  // The gzip twin on disk, when the build wrote one.
  gzip: { size: number; mtimeMs: number } | null;
}

export interface StaticPlan {
  status: 200 | 304;
  // Send the twin rather than the file.
  gzip: boolean;
  headers: Record<string, string>;
}

// Whether the address carries the stamp of the build this server serves.
export function carriesStamp(search: string, buildId: string | null): boolean {
  if (buildId === null || search === '') return false;
  return new URLSearchParams(search).get(VERSION_PARAM) === buildId;
}

export function cacheControlFor(
  req: Pick<StaticRequest, 'pathname' | 'search'>,
  entry: boolean,
  buildId: string | null,
): string {
  if (entry) return REVALIDATE;
  // Vite fingerprints everything under /assets/ by its content.
  if (req.pathname.startsWith('/assets/')) return IMMUTABLE;
  return carriesStamp(req.search, buildId) ? IMMUTABLE : REVALIDATE;
}

// Whether the browser takes gzip: named, or covered by '*', with a
// weight above zero.
export function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false;
  let named: number | null = null;
  let any: number | null = null;
  for (const part of header.split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    const name = (rawName ?? '').trim().toLowerCase();
    let q = 1;
    for (const p of params) {
      const [k, v] = p.trim().split('=');
      if (k?.trim().toLowerCase() === 'q') q = Number(v);
    }
    if (!Number.isFinite(q)) q = 0;
    if (name === 'gzip' || name === 'x-gzip') named = Math.max(named ?? 0, q);
    else if (name === '*') any = q;
  }
  if (named !== null) return named > 0;
  return any !== null && any > 0;
}

// A weak validator from the file's size and time, one per encoding: the
// two bodies differ, so they must not share a tag.
export function etagFor(size: number, mtimeMs: number, gzip: boolean): string {
  const tag = `${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}`;
  return `W/"${tag}${gzip ? '-gz' : ''}"`;
}

// If-None-Match under the weak comparison it is defined with.
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const opaque = (t: string): string => t.trim().replace(/^W\//, '');
  const own = opaque(etag);
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || opaque(t) === own);
}

export function planStatic(
  req: StaticRequest,
  file: StaticFile,
  buildId: string | null,
  contentType: string,
): StaticPlan {
  const headers: Record<string, string> = {
    'content-type': contentType,
    'cache-control': cacheControlFor(req, file.entry, buildId),
  };
  if (file.entry) {
    headers['content-length'] = String(file.size);
    return { status: 200, gzip: false, headers };
  }
  // A twin older than its file was not written from it: the file wins.
  const twin = file.gzip !== null && file.gzip.mtimeMs >= file.mtimeMs ? file.gzip : null;
  const gzip = twin !== null && acceptsGzip(req.acceptEncoding);
  // Both answers name the header they depend on, so a cache between here
  // and the browser keeps them apart.
  if (twin !== null) headers.vary = 'Accept-Encoding';
  headers.etag = etagFor(file.size, file.mtimeMs, gzip);
  if (etagMatches(req.ifNoneMatch, headers.etag)) return { status: 304, gzip, headers };
  if (gzip && twin !== null) {
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = String(twin.size);
  } else {
    headers['content-length'] = String(file.size);
  }
  return { status: 200, gzip, headers };
}

// The facts planStatic reads, off the disk: the file and its twin. The
// twin is looked up on every request rather than remembered, since a
// local build rewrites dist/ under a running server.
export async function statStaticFile(filePath: string): Promise<StaticFile> {
  const s = await stat(filePath);
  let gzip: StaticFile['gzip'] = null;
  try {
    const g = await stat(`${filePath}.gz`);
    if (g.isFile()) gzip = { size: g.size, mtimeMs: g.mtimeMs };
  } catch {
    // No twin: the file goes out as it is.
  }
  return { entry: false, size: s.size, mtimeMs: s.mtimeMs, gzip };
}
