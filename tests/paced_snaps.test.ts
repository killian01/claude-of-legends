import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type PaceClock, pacedSnaps } from '../src/net/paced_snaps';

// A clock and timer a test moves by hand.
function fakeClock(): PaceClock & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimeout(run, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let first: [number, { at: number; run: () => void }] | null = null;
        for (const t of timers)
          if (t[1].at <= until && (!first || t[1].at < first[1].at)) first = t;
        if (!first) break;
        timers.delete(first[0]);
        now = Math.max(now, first[1].at);
        first[1].run();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

describe('pacedSnaps', () => {
  // Ticks 0..19 arrive steadily, then 20 and 21 land together a tick late:
  // the pair is played out one tick apart on the timer, not at once.
  function paired() {
    const clock = fakeClock();
    const out: { tick: number; at: number }[] = [];
    const paced = pacedSnaps<number>((tick) => out.push({ tick, at: clock.now() }), clock);
    for (let t = 0; t < 20; t++) {
      paced.snap(t, t * 0.05);
      clock.advance(50);
    }
    clock.advance(50);
    paced.snap(20, 1.0);
    paced.snap(21, 1.05);
    return { clock, out, paced };
  }

  it('plays out a pair that arrived together one tick apart, on its timer', () => {
    const { clock, out } = paired();
    clock.advance(200);
    const at20 = out.find((o) => o.tick === 20)?.at ?? 0;
    const at21 = out.find((o) => o.tick === 21)?.at ?? 0;
    expect(out.map((o) => o.tick)).toEqual(Array.from({ length: 22 }, (_, t) => t));
    expect(at21 - at20).toBeGreaterThanOrEqual(45);
    expect(clock.pending()).toBe(0);
  });

  it('lets the held snapshots out before a message that must follow them', () => {
    const { out, paced } = paired();
    expect(paced.held).toBeGreaterThan(0);
    paced.before('score');
    expect(paced.held).toBeGreaterThan(0);
    paced.before('royale_result');
    expect(paced.held).toBe(0);
    expect(out.at(-1)?.tick).toBe(21);
  });

  it('drops what is held and its timer once stopped', () => {
    const { clock, out, paced } = paired();
    const before = out.length;
    paced.stop();
    clock.advance(500);
    paced.snap(22, 1.1);
    paced.before('match_end');
    expect(out.length).toBe(before);
    expect(clock.pending()).toBe(0);
  });

  it('starts over at a new bout whose clock begins again', () => {
    const { clock, out, paced } = paired();
    paced.before('match_start');
    // The last bout's held snapshots go out before the next bout begins.
    expect(paced.held).toBe(0);
    expect(out.at(-1)?.tick).toBe(21);
    paced.snap(100, 0);
    expect(out.at(-1)?.tick).toBe(100);
    clock.advance(50);
    paced.snap(101, 0.05);
    expect(out.at(-1)?.tick).toBe(101);
  });
});

// Every online match screen holds its snapshots in a pacer instead of
// applying them on arrival.
describe('the match screens pace their snapshots', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const bodyOf = (name: string): string => {
    const start = src.indexOf(`async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf('\nasync function ', start + 10));
  };
  for (const name of ['runOnline', 'runSpectate', 'runRoyale', 'runThornfray']) {
    it(name, () => {
      const body = bodyOf(name);
      expect(body).toMatch(/pacedSnaps</);
      expect(body).toMatch(/case 'snap':\s*paced\.snap\(msg, msg\.time\)/);
      expect(body).toMatch(/paced\.before\(/);
      expect(body).toMatch(/paced\.stop\(\)/);
      expect(body).not.toMatch(/case 'snap': \{\s*const changed = world\.applyServer/);
    });
  }
  // The result is not a ServerMsg: the flush comes before it is read.
  for (const [name, result] of [
    ['runRoyale', 'isRoyaleResult(raw)'],
    ['runThornfray', 'isThornfrayGather(raw)'],
  ] as const) {
    it(`${name} lets the snapshots out before its result, and stops on finish`, () => {
      const body = bodyOf(name);
      const flush = body.indexOf('paced.before(');
      expect(flush).toBeGreaterThan(-1);
      expect(flush).toBeLessThan(body.indexOf(`if (${result})`));
      expect(body).toMatch(/finished = true;\s*paced\.stop\(\);/);
    });
  }
  it('runSpectate stops on finish', () => {
    expect(bodyOf('runSpectate')).toMatch(/finished = true;\s*paced\.stop\(\);/);
  });
});
