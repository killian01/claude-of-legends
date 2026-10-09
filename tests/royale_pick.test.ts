// The battle royale's quick pick (src/ui/royale_pick_rules.ts): it opens on
// the pick last played, kept to what still exists, Random always changes
// the champion, and the sigils toggle the way champion select's do.

import { describe, expect, it } from 'vitest';
import { CHAMPION_LIST, CHAMPIONS, DEFAULT_CHAMPION_ID } from '../src/sim/content/champions';
import { planetTuning } from '../src/sim/content/royale_tuning';
import { SIGIL_LIST } from '../src/sim/content/sigils';
import { SKINS } from '../src/sim/content/skins';
import {
  DEFAULT_SIGILS,
  FIRST_ROYALE_CHAMPION,
  initialPick,
  pickReady,
  randomChampion,
  toggleSigil,
  withChampion,
} from '../src/ui/royale_pick_rules';

const ROSTER = CHAMPION_LIST.map((c) => c.id);
const SIGIL_IDS = SIGIL_LIST.map((s) => s.id);
const skinsOf = (id: string): number => SKINS[id]?.length ?? 1;
const open = (memory: Parameters<typeof initialPick>[0]) =>
  initialPick(memory, ROSTER, skinsOf, SIGIL_IDS, DEFAULT_CHAMPION_ID);

describe('the quick pick', () => {
  it('offers the eleven champions of the roster', () => {
    expect(ROSTER).toHaveLength(11);
  });

  it('opens on the pick last played', () => {
    const last = { championId: 'torv', skin: 2, sigils: ['zephyr', 'sear'] as [string, string] };
    expect(open(last)).toEqual(last);
  });

  it('opens on the house default the first time', () => {
    expect(open(null)).toEqual({
      championId: DEFAULT_CHAMPION_ID,
      skin: 0,
      sigils: DEFAULT_SIGILS,
    });
    expect(DEFAULT_SIGILS.every((id) => SIGIL_IDS.includes(id))).toBe(true);
  });

  it("opens a browser's first battle royale on a sturdier fighter than the Mage", () => {
    const first = initialPick(null, ROSTER, skinsOf, SIGIL_IDS, FIRST_ROYALE_CHAMPION);
    expect(first.championId).toBe('dain');
    expect(ROSTER).toContain(FIRST_ROYALE_CHAMPION);
    const dain = CHAMPIONS[FIRST_ROYALE_CHAMPION]!;
    const sylra = CHAMPIONS[DEFAULT_CHAMPION_ID]!;
    expect(sylra.role).toBe('Mage');
    expect(dain.role).not.toBe('Mage');
    // More health on the planet at every level, the planet's scale with it.
    const hpAt = (c: typeof dain, level: number) =>
      (c.base.hp + c.growth.hp * (level - 1)) * planetTuning(c.id).hp;
    for (const level of [1, 3, 6, 9]) expect(hpAt(dain, level)).toBeGreaterThan(hpAt(sylra, level));
    // A pick remembered still wins over it.
    const last = { championId: 'torv', skin: 0, sigils: DEFAULT_SIGILS };
    expect(initialPick(last, ROSTER, skinsOf, SIGIL_IDS, FIRST_ROYALE_CHAMPION).championId).toBe(
      'torv',
    );
  });

  it('keeps what still exists of a pick and drops the rest', () => {
    expect(open({ championId: 'gone', skin: 1, sigils: ['zephyr', 'sear'] })).toEqual({
      championId: DEFAULT_CHAMPION_ID,
      skin: 0,
      sigils: ['zephyr', 'sear'],
    });
    expect(open({ championId: 'torv', skin: 99, sigils: ['zephyr', 'nope'] })).toEqual({
      championId: 'torv',
      skin: 0,
      sigils: DEFAULT_SIGILS,
    });
  });

  it('changes the champion on Random, whatever the draw', () => {
    for (const roll of [0, 0.25, 0.5, 0.99999]) {
      const next = randomChampion(ROSTER, 'torv', roll);
      expect(next).not.toBe('torv');
      expect(ROSTER).toContain(next);
    }
    const seen = new Set(
      Array.from({ length: 9 }, (_, i) => randomChampion(ROSTER, 'torv', i / 9)),
    );
    expect(seen.size).toBe(9);
    expect(randomChampion(['torv'], 'torv', 0.5)).toBe('torv');
  });

  it('toggles sigils two at a time, the older leaving', () => {
    expect(toggleSigil(['riftstep', 'mend'], 'mend')).toEqual(['riftstep']);
    expect(toggleSigil(['riftstep'], 'sear')).toEqual(['riftstep', 'sear']);
    expect(toggleSigil(['riftstep', 'mend'], 'sear')).toEqual(['mend', 'sear']);
    expect(pickReady(['riftstep'])).toBe(false);
    expect(pickReady(['riftstep', 'mend'])).toBe(true);
  });

  it("starts a new champion on its first skin, since skins are the champion's own", () => {
    const pick = { championId: 'torv', skin: 2, sigils: DEFAULT_SIGILS };
    expect(withChampion(pick, 'vesk')).toEqual({
      championId: 'vesk',
      skin: 0,
      sigils: DEFAULT_SIGILS,
    });
    expect(withChampion(pick, 'torv')).toBe(pick);
  });
});
