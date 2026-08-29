// What this process may believe about a socket that arrived through a proxy.
// Production terminates TLS in front of the server (README), which changes
// two things a directly exposed process gets for free: every connection then
// carries the proxy's address, so MAX_CONN_PER_IP would cap the whole server
// at eight sockets instead of capping one machine, and the page that opened
// the WebSocket is worth checking, since a socket is a seat.
//
// Both answers need an operator statement, never a guess: X-Forwarded-For is
// client-written text until someone says how deep the real chain is.

import type { IncomingHttpHeaders } from 'node:http';

// A socket whose address we cannot read at all: still counted, as one bucket.
const UNKNOWN = 'unknown';
// Nobody runs ten proxies; the clamp keeps a typo in TRUST_PROXY from
// swallowing a whole forwarded chain as trusted.
const MAX_HOPS = 10;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:]{2,45}$/;

export interface EdgeConfig {
  // How many proxies sit between the internet and this process. 0 trusts
  // nothing forwarded, which is the right default for a direct port.
  hops: number;
  // Origins allowed on top of the one we serve ourselves. ['*'] is the
  // escape hatch: it turns the origin check off.
  origins: readonly string[];
}

export function edgeConfig(env: Record<string, string | undefined>): EdgeConfig {
  return { hops: trustedHops(env.TRUST_PROXY), origins: parseOrigins(env.ALLOWED_ORIGINS) };
}

// The address to count sockets against: the client's own, as far back down
// the forwarded chain as the operator says is trustworthy.
export function clientAddress(
  headers: IncomingHttpHeaders,
  socketAddress: string | undefined,
  cfg: EdgeConfig,
): string {
  const socket = normalizeIp(socketAddress) ?? UNKNOWN;
  if (cfg.hops <= 0) return socket;
  const raw = headers['x-forwarded-for'];
  const forwarded = (Array.isArray(raw) ? raw.join(',') : (raw ?? ''))
    .split(',')
    .map((entry) => normalizeIp(entry))
    .reverse();
  // Hop 0 is the socket itself, hop 1 what the nearest proxy saw, hop 2 what
  // the one before it saw. A client that writes its own X-Forwarded-For only
  // ever lands deeper than its real address, so the honest hop wins.
  const chain: readonly (string | null)[] = [socket, ...forwarded];
  // A hop past the end of the chain, or one holding junk, walks back toward
  // the socket: an unreadable entry must never become its own bucket.
  for (let i = Math.min(cfg.hops, chain.length - 1); i > 0; i--) {
    const hop = chain[i];
    if (hop) return hop;
  }
  return socket;
}

// Whether the page that opened this WebSocket may have a seat.
export function originAllowed(headers: IncomingHttpHeaders, cfg: EdgeConfig): boolean {
  const origin = first(headers.origin);
  // No Origin header is not a browser: a trained bot joins as a normal
  // client (ADR 0002), and a non-browser caller has no ambient session to
  // ride, which is the only thing this check defends.
  if (origin === undefined || origin.trim() === '') return true;
  if (cfg.origins.includes('*')) return true;
  const from = normalizeOrigin(origin);
  // "null" is what a sandboxed iframe or a file:// page sends: a browser
  // context that cannot be attributed to a host, so it gets no seat.
  if (from === null) return false;
  if (cfg.origins.includes(from)) return true;
  // Our own page is always welcome: one process, one port, so the client was
  // served from the very host this request names.
  const host = expectedHost(headers, cfg);
  return host !== null && from.slice(from.indexOf('://') + 3) === host;
}

// The public name of this server as the request states it. Behind a proxy
// that name may only survive in X-Forwarded-Host, and trusting that takes
// the same operator statement as the address chain does.
function expectedHost(headers: IncomingHttpHeaders, cfg: EdgeConfig): string | null {
  const forwarded = cfg.hops > 0 ? first(headers['x-forwarded-host']) : undefined;
  const host = (forwarded ?? first(headers.host) ?? '').split(',')[0]?.trim().toLowerCase();
  return host !== undefined && host.length > 0 ? host : null;
}

function trustedHops(raw: string | undefined): number {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === '' || s === 'false' || s === 'no') return 0;
  if (s === 'true' || s === 'yes') return 1;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), MAX_HOPS);
}

function parseOrigins(raw: string | undefined): readonly string[] {
  const out: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const s = part.trim();
    if (s === '') continue;
    if (s === '*') return ['*'];
    const o = normalizeOrigin(s);
    if (o !== null) out.push(o);
  }
  return out;
}

// "https://Play.Example.com/" to "https://play.example.com". Anything that is
// not scheme://host, the literal "null" included, comes back null.
function normalizeOrigin(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\/+$/, '');
  const sep = s.indexOf('://');
  if (sep <= 0 || sep + 3 >= s.length) return null;
  return s.slice(sep + 3).includes('/') ? null : s;
}

function normalizeIp(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  let s = raw.trim().toLowerCase();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) return null;
    s = s.slice(1, end);
  } else if ((s.match(/:/g)?.length ?? 0) === 1) {
    // "1.2.3.4:5678": some proxies forward the source port. An IPv6 address
    // never has exactly one colon, so this only ever strips a port.
    s = s.slice(0, s.indexOf(':'));
  }
  // An IPv4 client reaching a dual-stack listener arrives as ::ffff:1.2.3.4;
  // it is the same machine as the plain form and must share its bucket.
  if (s.startsWith('::ffff:') && IPV4.test(s.slice(7))) s = s.slice(7);
  const v4 = IPV4.exec(s);
  if (v4) return v4.slice(1).every((n) => Number(n) <= 255) ? s : null;
  return s.includes(':') && IPV6.test(s) ? s : null;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
