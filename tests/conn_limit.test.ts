// The per-address socket cap: it has to hold a flood back without ever
// counting two different players against each other, and it must not leak an
// entry for every address that ever connected.

import { describe, expect, it } from 'vitest';
import { ConnectionLimiter, MAX_CONN_PER_IP } from '../server/conn_limit';

describe('connection limiter', () => {
  it('lets an address hold up to the cap and refuses the next one', () => {
    const limiter = new ConnectionLimiter(3);
    expect(limiter.acquire('a')).toBe(true);
    expect(limiter.acquire('a')).toBe(true);
    expect(limiter.acquire('a')).toBe(true);
    expect(limiter.acquire('a')).toBe(false);
    expect(limiter.held('a')).toBe(3);
  });

  it('keeps addresses independent, so one flood cannot lock anyone else out', () => {
    const limiter = new ConnectionLimiter(2);
    limiter.acquire('flooder');
    limiter.acquire('flooder');
    expect(limiter.acquire('flooder')).toBe(false);
    expect(limiter.acquire('someone-else')).toBe(true);
  });

  it('frees a slot on release', () => {
    const limiter = new ConnectionLimiter(1);
    expect(limiter.acquire('a')).toBe(true);
    expect(limiter.acquire('a')).toBe(false);
    limiter.release('a');
    expect(limiter.acquire('a')).toBe(true);
  });

  it('forgets an address once its last socket closes', () => {
    const limiter = new ConnectionLimiter(2);
    limiter.acquire('a');
    limiter.acquire('a');
    limiter.release('a');
    expect(limiter.trackedAddresses).toBe(1);
    limiter.release('a');
    expect(limiter.trackedAddresses).toBe(0);
  });

  it('survives a release for an address it never saw', () => {
    const limiter = new ConnectionLimiter(2);
    expect(() => limiter.release('ghost')).not.toThrow();
    expect(limiter.trackedAddresses).toBe(0);
    expect(limiter.acquire('ghost')).toBe(true);
  });

  it('defaults to a cap that fits a shared connection, not a single player', () => {
    expect(MAX_CONN_PER_IP).toBe(32);
    const limiter = new ConnectionLimiter();
    for (let i = 0; i < MAX_CONN_PER_IP; i++) expect(limiter.acquire('shared')).toBe(true);
    expect(limiter.acquire('shared')).toBe(false);
  });
});
