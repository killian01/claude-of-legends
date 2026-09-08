// Where the replay bar sits (src/ui/replay_bar_place.ts): the default is
// measured against the HUD rather than guessed, a moved bar always comes
// back inside the window, and a broken preference never costs the viewer
// their controls.

import { describe, expect, it } from 'vitest';
import {
  clampToView,
  DOCK_GAP,
  dockedBottom,
  EDGE_MARGIN,
  readPrefs,
  writePrefs,
} from '../src/ui/replay_bar_place';

describe('dockedBottom', () => {
  it('clears the HUD it was measured against', () => {
    // The fixed 112px it replaced landed on the champion's health and
    // gold whenever the HUD was taller than the guess.
    expect(dockedBottom(150)).toBe(150 + DOCK_GAP);
    expect(dockedBottom(210)).toBeGreaterThan(210);
  });

  it('answers for a screen with no HUD at all', () => {
    expect(dockedBottom(0)).toBe(DOCK_GAP);
    expect(dockedBottom(-40)).toBe(DOCK_GAP);
  });
});

describe('clampToView', () => {
  const bar = { w: 760, h: 90 };
  const view = { w: 1600, h: 900 };

  it('leaves a position that already fits', () => {
    expect(clampToView({ x: 400, y: 300 }, bar, view)).toEqual({ x: 400, y: 300 });
  });

  it('pulls a bar back from every edge', () => {
    expect(clampToView({ x: -500, y: -80 }, bar, view)).toEqual({
      x: EDGE_MARGIN,
      y: EDGE_MARGIN,
    });
    // Dragged off the far corner, or left there by a window that shrank.
    expect(clampToView({ x: 5000, y: 5000 }, bar, view)).toEqual({
      x: view.w - bar.w - EDGE_MARGIN,
      y: view.h - bar.h - EDGE_MARGIN,
    });
  });

  it('keeps a bar wider than the window reachable by its left edge', () => {
    // A phone in portrait: the handle must stay where a thumb can find
    // it rather than being pushed off to the left.
    expect(clampToView({ x: 300, y: 40 }, { w: 900, h: 90 }, { w: 420, h: 800 })).toEqual({
      x: EDGE_MARGIN,
      y: 40,
    });
  });
});

describe('the remembered choice', () => {
  it('survives a round trip', () => {
    const prefs = { at: { x: 12, y: 34 }, collapsed: true };
    expect(readPrefs(writePrefs(prefs))).toEqual(prefs);
  });

  it('reads nothing at all out of anything malformed', () => {
    expect(readPrefs(null)).toEqual({});
    expect(readPrefs('')).toEqual({});
    expect(readPrefs('not json')).toEqual({});
    expect(readPrefs('[1,2]')).toEqual({});
    expect(readPrefs('{"at":{"x":"left","y":2}}')).toEqual({});
    expect(readPrefs('{"collapsed":"yes"}')).toEqual({});
    // The halves are independent: one broken does not lose the other.
    expect(readPrefs('{"at":null,"collapsed":true}')).toEqual({ collapsed: true });
  });
});
