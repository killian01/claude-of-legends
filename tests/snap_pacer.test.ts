import { describe, expect, it } from 'vitest';
import { MAX_HOLD_MS, MAX_QUEUED, SnapPacer, waitsForSnaps } from '../src/net/snap_pacer';

// Drives a pacer frame by frame (1 ms steps) over arrivals at given client
// times, and records when each snapshot was let through.
function run(arrivals: { tick: number; at: number }[], until: number): Map<number, number> {
  const out = new Map<number, number>();
  let now = 0;
  const pacer = new SnapPacer<number>((tick) => out.set(tick, now));
  let i = 0;
  for (now = 0; now <= until; now++) {
    while (i < arrivals.length && (arrivals[i] as { at: number }).at <= now) {
      const a = arrivals[i] as { tick: number; at: number };
      pacer.push(a.tick, a.tick * 0.05, now);
      i++;
    }
    pacer.pump(now);
  }
  return out;
}

function gaps(out: Map<number, number>, from: number, to: number): number[] {
  const g: number[] = [];
  for (let t = from + 1; t <= to; t++) g.push((out.get(t) ?? 0) - (out.get(t - 1) ?? 0));
  return g;
}

describe('SnapPacer', () => {
  it('lets a steady connection through at once', () => {
    const arrivals = Array.from({ length: 100 }, (_, t) => ({ tick: t, at: 1000 + t * 50 }));
    const out = run(arrivals, 7000);
    // (Within the 1 ms frame: a tick's match time is not exact in binary.)
    for (const a of arrivals)
      expect(Math.abs((out.get(a.tick) ?? 0) - a.at)).toBeLessThanOrEqual(1);
  });

  it('plays out snapshots that arrive in pairs one tick apart', () => {
    // Every second snapshot is held up a tick on the way and lands beside
    // the next: the uneven delivery of a far connection.
    const arrivals = Array.from({ length: 200 }, (_, t) => ({
      tick: t,
      at: 300 + (t % 2 === 0 ? t * 50 + 50 : t * 50),
    }));
    const out = run(arrivals, 12000);
    // Applied on arrival, the gaps would run 0, 100, 0, 100 ms: a jump and
    // a stall every tick. Paced, once the spread is measured, every gap is
    // the server's own tick.
    for (const g of gaps(out, 10, 199)) expect(Math.abs(g - 50)).toBeLessThanOrEqual(1);
    // And nothing is held longer than the cap.
    for (const a of arrivals)
      expect((out.get(a.tick) ?? 0) - a.at).toBeLessThanOrEqual(MAX_HOLD_MS);
  });

  it('smooths a random jitter of up to 80 ms', () => {
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let last = 0;
    const arrivals = Array.from({ length: 300 }, (_, t) => {
      // A stream keeps its order: a snapshot never lands before the last.
      last = Math.max(last, 200 + t * 50 + Math.floor(rand() * 80));
      return { tick: t, at: last };
    });
    const out = run(arrivals, 20000);
    const g = gaps(out, 80, 299);
    // On arrival the gaps spread from 0 to 130 ms; paced they hold the tick.
    expect(Math.max(...g)).toBeLessThanOrEqual(55);
    expect(Math.min(...g)).toBeGreaterThanOrEqual(45);
  });

  it('never lets snapshots out in a bunch after a lone stall', () => {
    // A steady stream with one 150 ms stall (a long frame, a hiccup on the
    // way): the stalled snapshots arrive together, then the stream goes on.
    const arrivals = Array.from({ length: 200 }, (_, t) => ({
      tick: t,
      at: 300 + (t >= 40 && t < 43 ? 43 : t) * 50,
    }));
    const out = run(arrivals, 12000);
    const g = gaps(out, 44, 199);
    // The stall moved the play-out later; three seconds on, when it leaves
    // the window, the play-out comes back a millisecond a tick, not at once.
    expect(Math.min(...g)).toBeGreaterThanOrEqual(48);
    expect(Math.max(...g)).toBeLessThanOrEqual(52);
    // And it does come back: by the end the stream is played as it lands.
    expect((out.get(199) ?? 0) - (arrivals[199] as { at: number }).at).toBeLessThanOrEqual(1);
  });

  it('lets a backlog through rather than fall behind', () => {
    const released: number[] = [];
    const pacer = new SnapPacer<number>((t) => released.push(t));
    // Twenty snapshots in one instant, each one tick newer than the last:
    // every one would be held a tick or more, and they pile up.
    for (let t = 0; t < 20; t++) pacer.push(t, t * 0.05, 0);
    expect(pacer.held).toBe(MAX_QUEUED);
    expect(released).toEqual(Array.from({ length: 20 - MAX_QUEUED }, (_, t) => t));
  });

  it('starts over when the match clock goes back, and flushes in order', () => {
    const released: number[] = [];
    const pacer = new SnapPacer<number>((t) => released.push(t));
    pacer.push(1, 10, 0);
    pacer.push(2, 10.05, 20);
    pacer.push(3, 10.1, 20);
    expect(released).toEqual([1]);
    expect(pacer.nextDue()).toBe(50);
    pacer.push(4, 0, 30);
    expect(released).toEqual([1, 2, 3, 4]);
    pacer.push(5, 0.05, 40);
    pacer.push(6, 0.1, 40);
    expect(pacer.held).toBe(2);
    pacer.flush();
    expect(released).toEqual([1, 2, 3, 4, 5, 6]);
    pacer.push(7, 0.15, 40);
    expect(pacer.held).toBe(1);
    pacer.clear();
    expect(pacer.held).toBe(0);
  });

  it('lets a message that ends or starts a match follow the snapshots', () => {
    for (const t of ['match_end', 'match_start', 'match_result', 'error', 'select_start']) {
      expect(waitsForSnaps(t)).toBe(true);
    }
    for (const t of ['snap', 'score', 'chat', 'probe', 'ping', 'points']) {
      expect(waitsForSnaps(t)).toBe(false);
    }
  });
});
