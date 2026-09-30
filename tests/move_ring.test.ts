// The Move ring (src/game/move_ring.ts): drawn in a newcomer's first two
// matches with the thumb controls, only for a person on the seat, and where
// a thumb put on it is the stick on every phone held sideways.

import { describe, expect, it } from 'vitest';
import {
  MOVE_RING,
  MOVE_RING_MATCHES,
  moveRingCenter,
  moveRingInStickZone,
  moveRingWanted,
} from '../src/game/move_ring';
import { clampSettings, DEFAULT_SETTINGS } from '../src/game/settings';

// Phones held sideways, a short and a tall one among them, and a tablet.
const SCREENS = [
  { width: 667, height: 375 },
  { width: 740, height: 360 },
  { width: 800, height: 360 },
  { width: 844, height: 340 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
  { width: 1180, height: 820 },
];

describe('the Move ring', () => {
  it('is drawn in the first two matches with the stick, and no more', () => {
    expect(MOVE_RING_MATCHES).toBe(2);
    expect(moveRingWanted(true, true, 0)).toBe(true);
    expect(moveRingWanted(true, true, 1)).toBe(true);
    expect(moveRingWanted(true, true, 2)).toBe(false);
    expect(moveRingWanted(true, true, 7)).toBe(false);
  });

  it('is not drawn without the stick, or for someone watching the seat', () => {
    expect(moveRingWanted(false, true, 0)).toBe(false);
    expect(moveRingWanted(true, false, 0)).toBe(false);
  });

  it('starts every device at no match shown, and keeps the count', () => {
    expect(DEFAULT_SETTINGS.moveRingMatches).toBe(0);
    expect(clampSettings({ moveRingMatches: 1 }).moveRingMatches).toBe(1);
    expect(clampSettings({ moveRingMatches: 1.7 }).moveRingMatches).toBe(1);
    expect(clampSettings({ moveRingMatches: -3 }).moveRingMatches).toBe(0);
    expect(clampSettings({ moveRingMatches: 'twice' }).moveRingMatches).toBe(0);
    expect(clampSettings({ moveRingMatches: Number.NaN }).moveRingMatches).toBe(0);
  });

  it('sits where a thumb put on it is the stick, on every phone held sideways', () => {
    for (const screen of SCREENS) {
      expect(moveRingInStickZone(screen), `${screen.width}x${screen.height}`).toBe(true);
    }
  });

  it('keeps the whole ring on the screen, low on the left', () => {
    for (const screen of SCREENS) {
      const c = moveRingCenter(screen);
      expect(c.x - MOVE_RING.r).toBeGreaterThanOrEqual(0);
      expect(c.y + MOVE_RING.r).toBeLessThanOrEqual(screen.height);
      expect(c.x).toBeLessThan(screen.width / 4);
      expect(c.y).toBeGreaterThan(screen.height / 2);
    }
  });
});
