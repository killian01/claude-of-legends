// The page's frame rate for the seat report (src/game/frame_rate.ts): the
// frames a second painted between two probe echoes, over the time they
// were painted in, nothing on the first call, nothing while the tab is
// hidden, and a tab hidden for most of the window not read as slow. And
// the screen's refresh for the quality ladder, read off the frames the
// page paints from its start, the menus' light ones included.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let painters: ((at: number) => void)[] = [];
let hidden = false;
let clock = 0;

beforeEach(() => {
  painters = [];
  hidden = false;
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (at: number) => void) => {
    painters.push(cb);
    return painters.length;
  });
  vi.stubGlobal('document', {
    get hidden() {
      return hidden;
    },
  });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// `n` frames painted `every` ms apart.
function paint(n: number, every: number): void {
  for (let i = 0; i < n; i++) {
    clock += every;
    const cb = painters.shift();
    cb?.(clock);
  }
}

describe("the page's frame rate", () => {
  it('counts the frames painted between two reads, in frames a second', async () => {
    const { frameRate } = await import('../src/game/frame_rate');
    expect(frameRate(clock)).toBeNull();
    paint(30, 1000 / 30);
    expect(frameRate(clock)).toBe(30);
    paint(120, 1000 / 60);
    expect(frameRate(clock)).toBe(60);
  });

  it('says nothing while the tab is hidden, nor after under half a second', async () => {
    const { frameRate } = await import('../src/game/frame_rate');
    frameRate(clock);
    paint(10, 20);
    expect(frameRate(clock)).toBeNull();
    paint(20, 50);
    hidden = true;
    expect(frameRate(clock)).toBeNull();
    hidden = false;
    paint(45, 1000 / 45);
    expect(frameRate(clock)).toBe(45);
  });

  it('reads a tab hidden for most of the window at the rate it drew', async () => {
    const { frameRate } = await import('../src/game/frame_rate');
    frameRate(clock);
    paint(60, 1000 / 60);
    // Four seconds behind another tab: no frame, then the first one back.
    clock += 4000;
    paint(1, 1000 / 60);
    expect(frameRate(clock)).toBe(60);
  });
});

describe("the screen's refresh", () => {
  it('is read off the frames painted from the start, and never lowered', async () => {
    const { screenRefresh, watchFrames } = await import('../src/game/frame_rate');
    expect(screenRefresh()).toBeNull();
    watchFrames();
    watchFrames();
    // The menus, light: every refresh of a 60 Hz screen painted.
    paint(40, 1000 / 60);
    expect(screenRefresh()).toBeCloseTo(60, 0);
    // A match on a weak GPU, every frame two refreshes: a 30 Hz screen's
    // cadence, which does not take the 60 back.
    paint(300, 2000 / 60);
    expect(screenRefresh()).toBeCloseTo(60, 0);
    // One loop, however often it was asked for.
    expect(painters.length).toBe(1);
  });

  it('is nothing until enough frames were painted', async () => {
    const { frameRate, screenRefresh } = await import('../src/game/frame_rate');
    frameRate(clock);
    paint(10, 1000 / 60);
    expect(screenRefresh()).toBeNull();
  });
});
