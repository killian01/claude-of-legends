// Structural gate: same seed, same world, on every host.

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';

describe('determinism', () => {
  it('same seed produces the same rng stream', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    expect(Array.from({ length: 100 }, () => a.next())).toEqual(
      Array.from({ length: 100 }, () => b.next()),
    );
  });

  it('different seeds diverge', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(Array.from({ length: 10 }, () => a.next())).not.toEqual(
      Array.from({ length: 10 }, () => b.next()),
    );
  });

  it('rng stays in [0, 1) and covers the range', () => {
    const rng = new Rng(7);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
  });

  it('two sims with the same seed stay identical over many ticks', () => {
    const run = () => {
      const sim = new Sim(42);
      const trace: number[] = [];
      for (let i = 0; i < 200; i++) {
        sim.tick();
        trace.push(sim.rng.next());
      }
      return { time: sim.time, tickCount: sim.tickCount, trace };
    };
    expect(run()).toEqual(run());
  });
});
