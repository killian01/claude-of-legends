// The card in front of a match until its first frame is drawn
// (src/game/first_frame.ts): it waits for the renderer's first frame, or
// for its bound when no frame comes, and the battle royale's joining card
// is the card that waits, every match, the next one included.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIRST_FRAME_WAIT_MS, untilDrawn } from '../src/game/first_frame';
import { WARM_HOLD_MS } from '../src/render/program_warmup';

// A timer the test fires by hand.
function manualTimer() {
  const timer = {
    armed: [] as { run: () => void; ms: number; cleared: boolean }[],
    later: (run: () => void, ms: number) => {
      const t = { run, ms, cleared: false };
      timer.armed.push(t);
      return () => {
        t.cleared = true;
      };
    },
    fire: () => {
      for (const t of timer.armed) if (!t.cleared) t.run();
    },
  };
  return timer;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('the wait for the first frame', () => {
  it('ends with the first frame, and clears its bound', async () => {
    let draw = (): void => undefined;
    const drawn = new Promise<void>((done) => {
      draw = done;
    });
    const timer = manualTimer();
    let over = false;
    void untilDrawn(drawn, 4000, timer.later).then(() => {
      over = true;
    });
    await settle();
    expect(over).toBe(false);
    expect(timer.armed[0]?.ms).toBe(4000);
    draw();
    await settle();
    expect(over).toBe(true);
    expect(timer.armed[0]?.cleared).toBe(true);
  });

  it('ends at its bound when no frame comes', async () => {
    const timer = manualTimer();
    let over = false;
    void untilDrawn(new Promise(() => undefined), 4000, timer.later).then(() => {
      over = true;
    });
    await settle();
    expect(over).toBe(false);
    timer.fire();
    await settle();
    expect(over).toBe(true);
  });

  it('ends when the renderer fails', async () => {
    const timer = manualTimer();
    await expect(
      untilDrawn(Promise.reject(new Error('no context')), 4000, timer.later),
    ).resolves.toBeUndefined();
  });

  it("outlasts the planet's hold, with room for the frame after it", () => {
    expect(FIRST_FRAME_WAIT_MS).toBeGreaterThan(WARM_HOLD_MS);
  });
});

describe("the renderer's first frame", () => {
  it('is told only once a frame is drawn, never while the hold keeps it', () => {
    const source = readFileSync('src/render/renderer.ts', 'utf8');
    const start = source.indexOf('  render(alpha: number, frameAt?: number): void {');
    const render = source.slice(start, source.indexOf('\n  }\n', start));
    const held = render.indexOf('if (this.warmup?.holds(now)) {');
    expect(held).toBeGreaterThan(-1);
    // Each branch (the planet, the plane) tells it right after its draw.
    const told = [...render.matchAll(/this\.shown\(\);/g)].map((m) => m.index ?? 0);
    const draws = [...render.matchAll(/this\.gl\.render\(/g)].map((m) => m.index ?? 0);
    expect(told).toHaveLength(2);
    expect(draws).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      expect(draws[i]!).toBeGreaterThan(held);
      expect(told[i]!).toBeGreaterThan(draws[i]!);
    }
  });
});

describe("the battle royale's joining card", () => {
  it('stays over the match until its first frame, at every match start', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    const start = main.indexOf('async function runRoyale(');
    const royale = main.slice(start, main.indexOf('\n}\n', start));
    const open = royale.slice(royale.indexOf('const open = (): void => {'));
    const body = open.slice(0, open.indexOf('\n    };\n'));
    // Raised over the match, not removed before it is built ...
    expect(body.indexOf('joining.overMatch()')).toBeGreaterThan(-1);
    expect(body.indexOf('joining.overMatch()')).toBeLessThan(body.indexOf('startPresentation('));
    expect(body.slice(0, body.indexOf('startPresentation('))).not.toContain('joining.remove()');
    // ... and taken down once the frame is drawn, or the bound passed.
    expect(body).toMatch(
      /untilDrawn\(opening\.drawn, FIRST_FRAME_WAIT_MS,[\s\S]*\.then\(\(\) => joining\.remove\(\)\)/,
    );
    // The next match (Play the next match, the other rule set) runs the
    // same runRoyale anew, its own joining card included.
    const loop = main.slice(main.indexOf('async function royaleLoop('));
    expect(loop.slice(0, loop.indexOf('\n}\n'))).toContain('await runRoyale(');
    expect(royale).toContain('showRoyaleJoining(');
  });
});
