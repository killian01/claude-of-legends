// Which address the abuse caps key on, direct and behind a proxy. Getting
// this wrong either caps the whole player base at one shared proxy address
// or lets a client pick its own key by forging a forwarding header.

import { describe, expect, it } from 'vitest';
import { resolveClientIp } from '../server/client_ip';

describe('client address resolution', () => {
  it('uses the socket address when the proxy is not trusted', () => {
    expect(resolveClientIp({}, '203.0.113.7', false)).toBe('203.0.113.7');
  });

  it('ignores forwarding headers when the proxy is not trusted', () => {
    const headers = { 'x-forwarded-for': '198.51.100.9', 'x-real-ip': '198.51.100.9' };
    expect(resolveClientIp(headers, '203.0.113.7', false)).toBe('203.0.113.7');
  });

  it('takes the leftmost entry of the forwarded chain when trusted', () => {
    const headers = { 'x-forwarded-for': '198.51.100.9, 203.0.113.7, 192.0.2.1' };
    expect(resolveClientIp(headers, '203.0.113.7', true)).toBe('198.51.100.9');
  });

  it('trims whitespace around the forwarded entry', () => {
    expect(resolveClientIp({ 'x-forwarded-for': '  198.51.100.9  ' }, '10.0.0.1', true)).toBe(
      '198.51.100.9',
    );
  });

  it('falls back to the peer address header when no chain was set', () => {
    const headers = { 'x-forwarded-for': '', 'x-real-ip': '198.51.100.9' };
    expect(resolveClientIp(headers, '10.0.0.1', true)).toBe('198.51.100.9');
  });

  it('falls back to the socket when the proxy set no forwarding header', () => {
    expect(resolveClientIp({}, '10.0.0.1', true)).toBe('10.0.0.1');
  });

  it('reads the first value when a header arrives repeated', () => {
    const headers = { 'x-forwarded-for': ['198.51.100.9', '192.0.2.1'] };
    expect(resolveClientIp(headers, '10.0.0.1', true)).toBe('198.51.100.9');
  });

  it('reports an unknown address rather than throwing on a closed socket', () => {
    expect(resolveClientIp({}, undefined, false)).toBe('unknown');
    expect(resolveClientIp({}, undefined, true)).toBe('unknown');
  });
});
