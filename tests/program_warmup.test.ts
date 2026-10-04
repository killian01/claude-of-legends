// The planet's programs linked before its first frame
// (src/render/program_warmup.ts): the draw is held while the programs
// link, let go once they all report linked (or are gone), and never held
// past the bound or by a warm-up that failed.

import { describe, expect, it } from 'vitest';
import { ProgramWarmup, whenLinked } from '../src/render/program_warmup';

// A program whose parallel link finishes after `polls` checks.
function linkingAfter(polls: number): { isReady: () => boolean; checks: number } {
  const p = {
    checks: 0,
    isReady: () => {
      p.checks++;
      return p.checks > polls;
    },
  };
  return p;
}

// A clock the test moves by hand: `later` waits until the test steps.
function manualLater(): { later: (ms: number) => Promise<void>; step: () => Promise<void> } {
  let waiting: (() => void)[] = [];
  return {
    later: () =>
      new Promise((done) => {
        waiting.push(done);
      }),
    step: async () => {
      const now = waiting;
      waiting = [];
      for (const done of now) done();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

describe('waiting for the links', () => {
  it('resolves once every program reports linked', async () => {
    const a = linkingAfter(0);
    const b = linkingAfter(2);
    const clock = manualLater();
    let done = false;
    void whenLinked([a, b], () => [a, b], clock.later).then(() => {
      done = true;
    });
    await clock.step();
    expect(done).toBe(false);
    await clock.step();
    expect(done).toBe(true);
    // A program linked is not asked again.
    expect(a.checks).toBe(1);
  });

  it('lets go of a program the renderer no longer holds', async () => {
    const stuck = linkingAfter(1_000);
    const clock = manualLater();
    let live = [stuck];
    let done = false;
    void whenLinked([stuck], () => live, clock.later).then(() => {
      done = true;
    });
    await clock.step();
    expect(done).toBe(false);
    live = [];
    await clock.step();
    expect(done).toBe(true);
  });

  it('counts a program with no way to ask as linked', async () => {
    await expect(
      whenLinked(
        [{}],
        () => [],
        () => Promise.resolve(),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('the hold over the draw', () => {
  it('holds while the work runs and lets go when it is done', async () => {
    let finish = (): void => undefined;
    const work = new Promise<void>((done) => {
      finish = done;
    });
    const warm = new ProgramWarmup(() => work, 0);
    expect(warm.holds(10)).toBe(true);
    finish();
    await work;
    await Promise.resolve();
    expect(warm.holds(20)).toBe(false);
  });

  it('never holds past its bound', () => {
    const warm = new ProgramWarmup(() => new Promise(() => undefined), 1000, 2500);
    expect(warm.holds(3499)).toBe(true);
    expect(warm.holds(3500)).toBe(false);
    // Once let go, it stays let go.
    expect(warm.holds(3501)).toBe(false);
  });

  it('holds nothing when the warm-up fails', async () => {
    const thrown = new ProgramWarmup(() => {
      throw new Error('no context');
    }, 0);
    expect(thrown.holds(1)).toBe(false);
    const failing = Promise.reject(new Error('lost'));
    const rejected = new ProgramWarmup(() => failing, 0);
    await failing.catch(() => undefined);
    await Promise.resolve();
    expect(rejected.holds(1)).toBe(false);
  });
});
