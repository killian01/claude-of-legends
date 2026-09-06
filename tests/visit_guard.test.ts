// The bound on a count the client provides (server/visit_guard.ts). The
// count is the browser's word (src/net/pulse_ping.ts), which is the only
// way to count a person and also a way to lie, so what is pinned here is
// that lying is bounded: how far one network gets, and that IPv6 does not
// hand an abuser a fresh identity per request.

import { describe, expect, it } from 'vitest';
import { network, VisitGuard } from '../server/visit_guard';

const T = (iso: string) => Date.parse(iso);
const DAY_ONE = T('2026-09-06T10:00:00Z');
const guard = (perNetwork = 3, networks = 100) =>
  new VisitGuard({ perNetwork, networks, salt: () => 'fixed-salt' });

describe('the network an address counts against', () => {
  it('is the address itself when it is IPv4', () => {
    // A household is one address; two people behind it are two visitors,
    // which is the honest answer and the one the old counter could not
    // give either.
    expect(network('203.0.113.7')).toBe('203.0.113.7');
    expect(network('203.0.113.7')).not.toBe(network('203.0.113.8'));
  });

  it('is the /64 when it is IPv6, however the address is spelled', () => {
    // The reason this exists at all: a phone renews the tail of its
    // address between reloads and a script can walk the whole /64 for
    // free. The LAN is the smallest thing worth calling one place.
    expect(network('2001:db8:1:2:3:4:5:6')).toBe(network('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(network('2001:db8:1:2::1')).toBe(network('2001:db8:1:2:0:0:0:99'));
    // Compressed, padded and truncated spellings are one bucket, not three.
    expect(network('2001:0db8:0001:0002::1')).toBe(network('2001:db8:1:2::1'));
  });

  it('keeps two different /64s apart', () => {
    expect(network('2001:db8:1:2::1')).not.toBe(network('2001:db8:1:3::1'));
  });

  it('gives anything it cannot read a bucket of its own', () => {
    // Never a shared bucket: a shape we misread must narrow the gate, not
    // widen it for everyone who also misreads.
    expect(network('unknown')).toBe('unknown');
    expect(network('2001:db8::1::2')).toBe('2001:db8::1::2');
  });
});

describe('the guard', () => {
  it('lets a household through and stops a script', () => {
    const g = guard(3);
    expect(g.allow(DAY_ONE, '203.0.113.7')).toBe(true);
    expect(g.allow(DAY_ONE, '203.0.113.7')).toBe(true);
    expect(g.allow(DAY_ONE, '203.0.113.7')).toBe(true);
    expect(g.allow(DAY_ONE, '203.0.113.7')).toBe(false);
    // One address running out says nothing about the next one.
    expect(g.allow(DAY_ONE, '203.0.113.8')).toBe(true);
  });

  it('counts a whole /64 as one caller', () => {
    const g = guard(2);
    expect(g.allow(DAY_ONE, '2001:db8:1:2::1')).toBe(true);
    expect(g.allow(DAY_ONE, '2001:db8:1:2::2')).toBe(true);
    expect(g.allow(DAY_ONE, '2001:db8:1:2::3')).toBe(false);
    expect(g.trackedNetworks).toBe(1);
  });

  it('starts every network over at midnight', () => {
    const g = guard(1);
    expect(g.allow(DAY_ONE, '203.0.113.7')).toBe(true);
    expect(g.allow(DAY_ONE, '203.0.113.7')).toBe(false);
    expect(g.allow(T('2026-09-07T00:00:01Z'), '203.0.113.7')).toBe(true);
    // The day before is forgotten entirely, salt and counts together.
    expect(g.trackedNetworks).toBe(1);
  });

  it('stops admitting new networks once the day is full', () => {
    // The memory bound. A network already counted today keeps its
    // remaining allowance; an unseen one is refused rather than admitted,
    // so the day's visitors stop rising instead of the process growing.
    const g = guard(2, 2);
    expect(g.allow(DAY_ONE, '203.0.113.1')).toBe(true);
    expect(g.allow(DAY_ONE, '203.0.113.2')).toBe(true);
    expect(g.allow(DAY_ONE, '203.0.113.3')).toBe(false);
    expect(g.allow(DAY_ONE, '203.0.113.1')).toBe(true);
    expect(g.trackedNetworks).toBe(2);
  });

  it('keeps no address, only a count', () => {
    // The one promise PRIVACY.md makes about this file. The addresses go
    // in; what stays is a salted hash and a small integer.
    const g = guard();
    g.allow(DAY_ONE, '203.0.113.7');
    expect(JSON.stringify(g)).not.toContain('203.0.113.7');
  });
});
