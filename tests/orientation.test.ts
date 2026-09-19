// The phone turning itself for a match (src/game/orientation.ts): what
// the browser is asked, what happens when it refuses, and when the line
// asking for a turn is still needed.

import { describe, expect, it, vi } from 'vitest';
import { lockLandscape, needsTurnPrompt, unlockOrientation } from '../src/game/orientation';

function fakeWindow(orientation?: unknown): Window {
  return { screen: { orientation } } as unknown as Window;
}

describe('locking the screen to landscape', () => {
  it('asks the browser for landscape and reports that it took', async () => {
    const lock = vi.fn(() => Promise.resolve());
    expect(await lockLandscape(fakeWindow({ lock }))).toBe(true);
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  it('reports a refusal rather than throwing', async () => {
    const lock = vi.fn(() => Promise.reject(new Error('not fullscreen')));
    expect(await lockLandscape(fakeWindow({ lock }))).toBe(false);
  });

  it('reports false where there is no lock to be had, iOS and the desktop alike', async () => {
    expect(await lockLandscape(fakeWindow(undefined))).toBe(false);
    expect(await lockLandscape(fakeWindow({ type: 'portrait-primary' }))).toBe(false);
    expect(await lockLandscape({} as unknown as Window)).toBe(false);
  });

  it('gives the screen back, and minds a browser that has none', () => {
    const unlock = vi.fn();
    unlockOrientation(fakeWindow({ unlock }));
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(() => unlockOrientation(fakeWindow(undefined))).not.toThrow();
    expect(() =>
      unlockOrientation(
        fakeWindow({
          unlock: () => {
            throw new Error('denied');
          },
        }),
      ),
    ).not.toThrow();
  });
});

describe('the line asking for a turn', () => {
  it('is for a touchscreen the browser would not turn itself', () => {
    expect(needsTurnPrompt(true, false)).toBe(true);
  });

  it('is gone once the browser holds the screen in landscape', () => {
    expect(needsTurnPrompt(true, true)).toBe(false);
  });

  it('never shows on a mouse', () => {
    expect(needsTurnPrompt(false, false)).toBe(false);
    expect(needsTurnPrompt(false, true)).toBe(false);
  });
});
