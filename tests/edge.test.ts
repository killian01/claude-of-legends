// The proxy edge: who the client really is once TLS is terminated in front
// of us, and which pages may open a socket. Both are launch blockers, in
// opposite directions: read the forwarded chain when nobody forwards and one
// spoofed header owns every bucket; ignore it behind a proxy and
// MAX_CONN_PER_IP caps the whole server at eight players.

import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { clientAddress, type EdgeConfig, edgeConfig, originAllowed } from '../server/edge';

const DIRECT: EdgeConfig = { hops: 0, origins: [] };
const ONE_PROXY: EdgeConfig = { hops: 1, origins: [] };
const PROXY = '10.0.0.7';

function headers(h: IncomingHttpHeaders): IncomingHttpHeaders {
  return h;
}

describe('edge config', () => {
  it('trusts nothing by default', () => {
    expect(edgeConfig({})).toEqual({ hops: 0, origins: [] });
  });

  it('reads a hop count, a boolean, or neither', () => {
    expect(edgeConfig({ TRUST_PROXY: '2' }).hops).toBe(2);
    expect(edgeConfig({ TRUST_PROXY: 'true' }).hops).toBe(1);
    expect(edgeConfig({ TRUST_PROXY: 'false' }).hops).toBe(0);
    expect(edgeConfig({ TRUST_PROXY: 'yes please' }).hops).toBe(0);
    expect(edgeConfig({ TRUST_PROXY: '-1' }).hops).toBe(0);
    // A typo must not turn the whole forwarded chain into trusted ground.
    expect(edgeConfig({ TRUST_PROXY: '99' }).hops).toBe(10);
  });

  it('normalizes the origin allowlist and keeps the escape hatch', () => {
    expect(edgeConfig({ ALLOWED_ORIGINS: 'https://Play.Example.com/, ,junk' }).origins).toEqual([
      'https://play.example.com',
    ]);
    expect(edgeConfig({ ALLOWED_ORIGINS: 'https://a.example, *' }).origins).toEqual(['*']);
  });
});

describe('client address', () => {
  it('ignores a forwarded header nobody vouched for', () => {
    const h = headers({ 'x-forwarded-for': '1.2.3.4' });
    expect(clientAddress(h, '203.0.113.9', DIRECT)).toBe('203.0.113.9');
  });

  it('reads the client through one trusted proxy', () => {
    const h = headers({ 'x-forwarded-for': '1.2.3.4' });
    expect(clientAddress(h, PROXY, ONE_PROXY)).toBe('1.2.3.4');
  });

  it('ignores what the client wrote into the chain itself', () => {
    // The proxy appends the real address, so a self-written entry sits
    // deeper than the honest one and hop 1 never reaches it.
    const h = headers({ 'x-forwarded-for': '9.9.9.9, 1.2.3.4' });
    expect(clientAddress(h, PROXY, ONE_PROXY)).toBe('1.2.3.4');
  });

  it('counts hops back through two proxies', () => {
    const h = headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.5' });
    expect(clientAddress(h, PROXY, { hops: 2, origins: [] })).toBe('1.2.3.4');
  });

  it('joins repeated forwarded headers into one chain', () => {
    const h = headers({ 'x-forwarded-for': ['1.2.3.4', '198.51.100.5'] });
    expect(clientAddress(h, PROXY, { hops: 2, origins: [] })).toBe('1.2.3.4');
  });

  it('falls back toward the socket past the end of the chain', () => {
    const h = headers({ 'x-forwarded-for': '1.2.3.4' });
    expect(clientAddress(h, PROXY, { hops: 3, origins: [] })).toBe('1.2.3.4');
    expect(clientAddress(headers({}), PROXY, ONE_PROXY)).toBe(PROXY);
  });

  it('never lets junk become its own bucket', () => {
    const h = headers({ 'x-forwarded-for': 'not-an-ip' });
    expect(clientAddress(h, PROXY, ONE_PROXY)).toBe(PROXY);
    expect(clientAddress(headers({}), undefined, DIRECT)).toBe('unknown');
  });

  it('gives one machine one bucket whatever shape its address arrives in', () => {
    expect(clientAddress(headers({}), '::ffff:1.2.3.4', DIRECT)).toBe('1.2.3.4');
    expect(clientAddress(headers({}), '[2001:db8::1]', DIRECT)).toBe('2001:db8::1');
    // Some proxies forward the source port; the port is not the machine.
    expect(clientAddress(headers({ 'x-forwarded-for': '1.2.3.4:5678' }), PROXY, ONE_PROXY)).toBe(
      '1.2.3.4',
    );
  });
});

describe('origin check', () => {
  it('lets our own page in', () => {
    const h = headers({ host: 'play.example.com', origin: 'https://play.example.com' });
    expect(originAllowed(h, DIRECT)).toBe(true);
  });

  it('refuses a page served by somebody else', () => {
    const h = headers({ host: 'play.example.com', origin: 'https://evil.example' });
    expect(originAllowed(h, DIRECT)).toBe(false);
  });

  it('refuses a browser context with no host of its own', () => {
    const h = headers({ host: 'play.example.com', origin: 'null' });
    expect(originAllowed(h, DIRECT)).toBe(false);
  });

  it('lets a non-browser client through', () => {
    // A trained bot joins as a normal client (ADR 0002) and sends no Origin.
    expect(originAllowed(headers({ host: 'play.example.com' }), DIRECT)).toBe(true);
  });

  it('honors the allowlist and the escape hatch', () => {
    const h = headers({ host: 'play.example.com', origin: 'https://beta.example.com' });
    expect(originAllowed(h, { hops: 0, origins: ['https://beta.example.com'] })).toBe(true);
    expect(originAllowed(h, { hops: 0, origins: ['*'] })).toBe(true);
    // The allowlist adds to our own page, it does not replace it.
    const own = headers({ host: 'play.example.com', origin: 'https://play.example.com' });
    expect(originAllowed(own, { hops: 0, origins: ['https://beta.example.com'] })).toBe(true);
  });

  it('reads the public name from the proxy only when a proxy is declared', () => {
    // The proxy rewrote Host to the container name and kept the real one in
    // X-Forwarded-Host: without this, TLS termination refuses every browser.
    const h = headers({
      host: 'loc-server:8787',
      'x-forwarded-host': 'play.example.com',
      origin: 'https://play.example.com',
    });
    expect(originAllowed(h, ONE_PROXY)).toBe(true);
    expect(originAllowed(h, DIRECT)).toBe(false);
  });

  it('compares the port too', () => {
    const h = headers({ host: 'localhost:8787', origin: 'http://localhost:8787' });
    expect(originAllowed(h, DIRECT)).toBe(true);
    expect(originAllowed(headers({ ...h, origin: 'http://localhost:5173' }), DIRECT)).toBe(false);
  });
});
