// The world loop's meter (server/tick_meter.ts): one report per window,
// the numbers a load test reads off /healthz.

import { describe, expect, it } from 'vitest';
import { formatTickReport, TickMeter } from '../server/tick_meter';

describe('the tick meter', () => {
  it('says nothing before its window has elapsed', () => {
    const m = new TickMeter(1000, 5000);
    m.tick(1, false);
    expect(m.report(5999, 1, 10)).toBeNull();
    expect(m.last()).toBeNull();
  });

  it('reports the window: ticks, their cost, the late ones, the bytes out', () => {
    const m = new TickMeter(0, 5000);
    for (let i = 0; i < 100; i++) m.tick(i === 50 ? 12 : 1, i % 10 === 9);
    m.sent(400_000);
    m.sent(600_000);
    const r = m.report(5000, 1, 10);
    expect(r).toEqual({
      seconds: 5,
      ticks: 100,
      ticksPerSecond: 20,
      avgMs: 1.11,
      maxMs: 12,
      late: 10,
      bytesOut: 1_000_000,
      bytesPerSecond: 200_000,
      matches: 1,
      clients: 10,
    });
    expect(m.last()).toEqual(r);
  });

  it('starts a fresh window after each report', () => {
    const m = new TickMeter(0, 1000);
    m.tick(3, false);
    m.sent(10);
    expect(m.report(1000, 1, 1)?.ticks).toBe(1);
    expect(m.report(1500, 1, 1)).toBeNull();
    m.tick(2, true);
    m.tick(2, true);
    const r = m.report(2000, 2, 3);
    expect(r?.ticks).toBe(2);
    expect(r?.late).toBe(2);
    expect(r?.bytesOut).toBe(0);
    expect(r?.avgMs).toBe(2);
    expect(r?.matches).toBe(2);
  });

  it('formats one readable line', () => {
    const m = new TickMeter(0, 5000);
    for (let i = 0; i < 100; i++) m.tick(1.5, false);
    m.sent(7_000_000);
    const r = m.report(5000, 1, 10);
    expect(formatTickReport(r!)).toBe(
      'tick: 100 in 5 s (20/s), avg 1.5 ms, max 1.5 ms, late 0, out 1.4 MB/s, matches 1, clients 10',
    );
    const small = new TickMeter(0, 1000);
    small.tick(0.4, false);
    small.sent(12_000);
    expect(formatTickReport(small.report(1000, 0, 0)!)).toContain('out 12 kB/s');
  });
});
