// The play currency and the wall it holds up (ADR 0018): a price table
// that covers exactly what is for sale, a rotation derived from the week
// with nothing stored, and the floor that keeps blind pick from jamming.

import { describe, expect, it } from 'vitest';
import {
  CHAMPION_PRICES,
  championPrice,
  FIRST_WIN_BONUS,
  MATCH_LAURELS,
  matchLaurels,
  playableAt,
  ROTATION_POOL,
  ROTATION_SIZE,
  rotationAt,
  STARTER_COLLECTION,
  WEEK_MS,
  WIN_LAURELS,
} from '../server/laurels';
import { CHAMPION_LIST, DEFAULT_CHAMPION_ID } from '../src/sim/content/champions';

describe('the laurel price table', () => {
  it('prices every roster champion outside the starter, and none inside it', () => {
    // The structural gate: a champion added to the roster without a price
    // would be unbuyable and invisible in the shop, and a starter with a
    // price would be sold to someone who already has it.
    for (const c of CHAMPION_LIST) {
      const starter = STARTER_COLLECTION.includes(c.id);
      expect(starter ? championPrice(c.id) : typeof championPrice(c.id)).toBe(
        starter ? null : 'number',
      );
    }
    expect(Object.keys(CHAMPION_PRICES).length).toBe(
      CHAMPION_LIST.length - STARTER_COLLECTION.length,
    );
  });

  it('costs about forty matches for the whole roster, and five for the first', () => {
    // The pacing choice the ADR makes, pinned so a rate edit that breaks
    // it is a decision rather than an accident. The first rates put the
    // cheapest champion two matches away, which is what sent these
    // numbers back to the table.
    const total = Object.values(CHAMPION_PRICES).reduce((a, b) => a + b, 0);
    expect(total).toBe(3600);
    const perMatch = (MATCH_LAURELS + WIN_LAURELS) / 2;
    expect(Math.round(total / perMatch)).toBeGreaterThanOrEqual(35);
    expect(Math.round(total / perMatch)).toBeLessThanOrEqual(55);
    // The cheapest champion, from nothing, in a evening rather than in a
    // pair of matches.
    const cheapest = Math.min(...Object.values(CHAMPION_PRICES));
    expect(Math.round(cheapest / perMatch)).toBeGreaterThanOrEqual(5);
  });

  it('pays the win over the match, and the first win of the day over both', () => {
    expect(matchLaurels(false, false, true)).toBe(MATCH_LAURELS);
    expect(matchLaurels(true, false, true)).toBe(WIN_LAURELS);
    expect(matchLaurels(true, true, true)).toBe(WIN_LAURELS + FIRST_WIN_BONUS);
    // A loss is never the day's first win, whatever the caller passes.
    expect(matchLaurels(false, true, true)).toBe(MATCH_LAURELS);
    // The fixed part is the small one: it is what an idle player collects.
    expect(MATCH_LAURELS).toBeLessThan(WIN_LAURELS);
  });

  it('pays an unrated match the fixed part and nothing else', () => {
    // No human on the other side is a stroll against house bots. It still
    // pays, because at this population most matches are bot-filled, but a
    // win in one is worth what a loss in one is.
    expect(matchLaurels(true, true, false)).toBe(MATCH_LAURELS);
    expect(matchLaurels(false, false, false)).toBe(MATCH_LAURELS);
    // And a contested match is worth well over twice a stroll, which is
    // the whole point of the split.
    expect(matchLaurels(true, false, true)).toBeGreaterThan(2 * MATCH_LAURELS);
  });
});

describe('the rotation', () => {
  it('draws three from outside the starter, the same three for everyone', () => {
    const at = Date.UTC(2026, 8, 6);
    const week = rotationAt(at);
    expect(week).toHaveLength(ROTATION_SIZE);
    expect(new Set(week).size).toBe(ROTATION_SIZE);
    for (const id of week) expect(STARTER_COLLECTION).not.toContain(id);
    // Same moment, same answer: no state, no per-account draw.
    expect(rotationAt(at + 1000)).toEqual(week);
  });

  it('turns every week and cycles the whole pool', () => {
    const at = Date.UTC(2026, 8, 6);
    expect(rotationAt(at + WEEK_MS)).not.toEqual(rotationAt(at));
    const seen = new Set<string>();
    for (let w = 0; w < ROTATION_POOL.length; w++) {
      for (const id of rotationAt(at + w * WEEK_MS)) seen.add(id);
    }
    // Every champion for sale is free some week, so nothing is bought
    // blind.
    expect([...seen].sort()).toEqual([...ROTATION_POOL].sort());
  });
});

describe('the playable floor', () => {
  it('never leaves an account with fewer than five champions', () => {
    // Five fresh accounts on one side, no duplicates within a team: the
    // fifth must still have something of its own. Four starters plus
    // three rotating is seven, and four teammates can take at most four.
    const at = Date.UTC(2026, 8, 6);
    for (let w = 0; w < 12; w++) {
      const playable = playableAt(STARTER_COLLECTION, at + w * WEEK_MS);
      expect(playable.length).toBeGreaterThanOrEqual(7);
      expect(new Set(playable).size).toBe(playable.length);
    }
  });

  it('holds the matchmaker default, so the last-resort pick is always owned', () => {
    expect(STARTER_COLLECTION).toContain(DEFAULT_CHAMPION_ID);
  });

  it('adds a recruited champion once, whatever the week gives', () => {
    const at = Date.UTC(2026, 8, 6);
    const owned = [...STARTER_COLLECTION, ...rotationAt(at)];
    const playable = playableAt(owned, at);
    expect(new Set(playable).size).toBe(playable.length);
    expect(playable).toHaveLength(owned.length);
  });
});
