// The page's frame rate for the seat report (src/game/frame_rate.ts): the
// frames a second painted between two probe echoes, nothing on the first
// call, nothing while the tab is hidden.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let painters: (() => void)[] = [];
let hidden = false;

beforeEach(() => {
  painters = [];
  hidden = false;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
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

function paint(n: number): void {
  for (let i = 0; i < n; i++) {
    const cb = painters.shift();
    cb?.();
  }
}

describe("the page's frame rate", () => {
  it('counts the frames painted between two reads, in frames a second', async () => {
    const { frameRate } = await import('../src/game/frame_rate');
    expect(frameRate(0)).toBeNull();
    paint(30);
    expect(frameRate(1000)).toBe(30);
    paint(120);
    expect(frameRate(3000)).toBe(60);
  });

  it('says nothing while the tab is hidden, nor after under half a second', async () => {
    const { frameRate } = await import('../src/game/frame_rate');
    frameRate(0);
    paint(10);
    expect(frameRate(200)).toBeNull();
    paint(20);
    hidden = true;
    expect(frameRate(1500)).toBeNull();
    hidden = false;
    paint(45);
    expect(frameRate(2500)).toBe(45);
  });
});
