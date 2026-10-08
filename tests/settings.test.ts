// The settings core: any junk from storage in, a valid settings object out.

import { describe, expect, it, vi } from 'vitest';
import { clampSettings, DEFAULT_SETTINGS } from '../src/game/settings';

describe('player settings', () => {
  it('falls back to defaults on junk', () => {
    expect(clampSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(clampSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(clampSettings({ sfx: 'loud', music: Number.NaN, announcer: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('clamps volumes into 0..1 and keeps valid values', () => {
    expect(clampSettings({ sfx: 2, music: -1, announcer: false })).toEqual({
      sfx: 1,
      music: 0,
      announcer: false,
      uiScale: 'auto',
      touchScheme: 'thumbs',
      practiceBots: 'gentle',
      moveRingMatches: 0,
      rotatedView: true,
      ladderTold: false,
      leftClickMoves: true,
      stepsOff: false,
      stepsDone: [],
      royaleStepsDone: [],
      royalePick: null,
      royaleBest: 0,
      royaleGoal: 0,
    });
    expect(clampSettings({ sfx: 0.35, music: 0.8, announcer: true })).toEqual({
      sfx: 0.35,
      music: 0.8,
      announcer: true,
      uiScale: 'auto',
      touchScheme: 'thumbs',
      practiceBots: 'gentle',
      moveRingMatches: 0,
      rotatedView: true,
      ladderTold: false,
      leftClickMoves: true,
      stepsOff: false,
      stepsDone: [],
      royaleStepsDone: [],
      royalePick: null,
      royaleBest: 0,
      royaleGoal: 0,
    });
  });

  // The Respawn end card's best (ui/royale_result.ts): a whole count of
  // takedowns, 0 before the first match, junk read as nothing.
  it('keeps the best Respawn tally as a whole count, 0 by default', () => {
    expect(DEFAULT_SETTINGS.royaleBest).toBe(0);
    expect(clampSettings({ royaleBest: 7 }).royaleBest).toBe(7);
    expect(clampSettings({ royaleBest: 7.9 }).royaleBest).toBe(7);
    for (const junk of [-3, '7', null, Number.NaN, Number.POSITIVE_INFINITY, { n: 7 }]) {
      expect(clampSettings({ royaleBest: junk }).royaleBest).toBe(0);
    }
  });

  // The Respawn end card's goal (ui/royale_goal.ts): the points this
  // browser's battle royale seats earned, a whole number, far past a
  // count's cap, junk read as nothing.
  it('keeps the battle royale points of the goal as a whole number, 0 by default', () => {
    expect(DEFAULT_SETTINGS.royaleGoal).toBe(0);
    expect(clampSettings({ royaleGoal: 1234.7 }).royaleGoal).toBe(1234);
    expect(clampSettings({ royaleGoal: 5e9 }).royaleGoal).toBe(10_000_000);
    for (const junk of [-3, '70', null, Number.NaN, Number.POSITIVE_INFINITY, { n: 7 }]) {
      expect(clampSettings({ royaleGoal: junk }).royaleGoal).toBe(0);
    }
  });

  // The battle royale's quick pick keeps the champion, the skin and the two
  // sigils last played (ui/royale_pick.ts); junk keeps nothing.
  it('remembers the quick pick of the battle royale, or nothing', () => {
    expect(DEFAULT_SETTINGS.royalePick).toBeNull();
    const kept = { championId: 'torv', skin: 2, sigils: ['zephyr', 'sear'] };
    expect(clampSettings({ royalePick: kept }).royalePick).toEqual(kept);
    expect(clampSettings({ royalePick: { ...kept, skin: -3 } }).royalePick?.skin).toBe(0);
    expect(clampSettings({ royalePick: { ...kept, skin: 1.7 } }).royalePick?.skin).toBe(1);
    for (const junk of [
      'torv',
      { ...kept, championId: '' },
      { ...kept, championId: 7 },
      { ...kept, sigils: ['zephyr'] },
      { ...kept, sigils: ['zephyr', 'zephyr'] },
      { ...kept, sigils: ['zephyr', 3] },
    ]) {
      expect(clampSettings({ royalePick: junk }).royalePick).toBeNull();
    }
  });

  it('keeps the battle royale steps done apart from the 5v5 ones', () => {
    const s = clampSettings({ stepsDone: ['learn'], royaleStepsDone: ['br_cache', 'br_cache', 4] });
    expect(s.stepsDone).toEqual(['learn']);
    expect(s.royaleStepsDone).toEqual(['br_cache']);
  });

  it('knows the two ways a phone plays and defaults to the stick', () => {
    expect(clampSettings({ touchScheme: 'tap' }).touchScheme).toBe('tap');
    expect(clampSettings({ touchScheme: 'wheel' }).touchScheme).toBe('thumbs');
  });

  it('remembers the enemy bots of Practice, Gentle until Normal is chosen', () => {
    expect(DEFAULT_SETTINGS.practiceBots).toBe('gentle');
    expect(clampSettings({ practiceBots: 'normal' }).practiceBots).toBe('normal');
    expect(clampSettings({ practiceBots: 'gentle' }).practiceBots).toBe('gentle');
    expect(clampSettings({ practiceBots: 'brutal' }).practiceBots).toBe('gentle');
    expect(clampSettings({ practiceBots: 1 }).practiceBots).toBe('gentle');
  });

  // Per viewer: what the practice select locked in is there on the next
  // page load, read back from the browser's storage.
  it('keeps the enemy bots chosen across a page load', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    try {
      vi.resetModules();
      const first = await import('../src/game/settings');
      expect(first.getSettings().practiceBots).toBe('gentle');
      first.updateSettings({ practiceBots: 'normal' });
      vi.resetModules();
      const next = await import('../src/game/settings');
      expect(next.getSettings().practiceBots).toBe('normal');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('turns the match for an upright phone unless the wall was chosen', () => {
    expect(DEFAULT_SETTINGS.rotatedView).toBe(true);
    expect(clampSettings({ rotatedView: false }).rotatedView).toBe(false);
    expect(clampSettings({ rotatedView: 'no' }).rotatedView).toBe(true);
  });

  it('remembers only a real yes for the ladder line, told once per viewer', () => {
    expect(clampSettings({ ladderTold: true }).ladderTold).toBe(true);
    expect(clampSettings({ ladderTold: 'yes' }).ladderTold).toBe(false);
    expect(DEFAULT_SETTINGS.ladderTold).toBe(false);
  });

  // A trackpad clicks left: a left click walks and attacks unless the
  // player turned it off (game/boot.ts, the seat report of 2026-10-01).
  it('lets a left click walk by default, and keeps it off once turned off', () => {
    expect(DEFAULT_SETTINGS.leftClickMoves).toBe(true);
    expect(clampSettings({ leftClickMoves: false }).leftClickMoves).toBe(false);
    expect(clampSettings({ leftClickMoves: 'no' }).leftClickMoves).toBe(true);
  });

  it('keeps an interface size in range and falls back to auto', () => {
    expect(clampSettings({ uiScale: 1.5 }).uiScale).toBe(1.5);
    expect(clampSettings({ uiScale: 9 }).uiScale).toBe(2);
    expect(clampSettings({ uiScale: 'huge' }).uiScale).toBe('auto');
  });
});
