// Bot hints (kits-v2): the declarative per-champion layer of the bot brain.
// The generic laner reads each ability's true shape from its CastSpec; what
// a spec cannot say is the INTENT, and that lives here as data: which key
// is the escape, when the ultimate is worth spending, which casts only pay
// off at range. One record per champion; unknown champions get DEFAULTS.

import type { AbilityKey } from '../../types';

// What a key is for, tactically. The generic brain maps each role to one
// deterministic firing rule (see laner.ts).
export type KeyRole =
  | 'poke' // cast at the nearest enemy champion in range
  | 'engage' // like poke, but only when healthy enough to commit
  | 'escape' // held for the retreat: cast toward home while fleeing
  | 'steroid' // self-cast when an enemy champion is in fighting range
  | 'wall' // cast at a fleeing low target to cut the escape
  | 'heal'; // cast on the lowest-health nearby ally

export interface ChampionHints {
  keys: Record<Exclude<AbilityKey, 'R'>, KeyRole>;
  // Distance sweet spots: never cast this key under this range (Vesk's
  // rounds, Ashvyn's pin: point blank is the weak case by design).
  minRange?: Partial<Record<AbilityKey, number>>;
  // The ultimate is spent when EITHER gate opens (both optional).
  ult: { minEnemies?: number; radius?: number; targetHpBelow?: number };
  // ADR 0005: press the armed recast home when own health drops below this.
  recastHomeBelow?: number;
}

export const DEFAULT_HINTS: ChampionHints = {
  keys: { Q: 'poke', W: 'poke', E: 'poke' },
  ult: { minEnemies: 2, radius: 5 },
};

export const BOT_HINTS: Record<string, ChampionHints> = {
  korrath: {
    keys: { Q: 'poke', W: 'wall', E: 'poke' },
    ult: { minEnemies: 2, radius: 4 },
  },
  dain: {
    keys: { Q: 'engage', W: 'steroid', E: 'steroid' },
    ult: { minEnemies: 2, radius: 4, targetHpBelow: 0.45 },
  },
  sylra: {
    keys: { Q: 'poke', W: 'poke', E: 'steroid' },
    ult: { minEnemies: 2, radius: 5 },
  },
  fenn: {
    keys: { Q: 'engage', W: 'poke', E: 'escape' },
    ult: { targetHpBelow: 0.55 },
    recastHomeBelow: 0.4,
  },
  elowen: {
    keys: { Q: 'poke', W: 'poke', E: 'escape' },
    ult: { minEnemies: 2, radius: 6 },
  },
  vesk: {
    keys: { Q: 'poke', W: 'poke', E: 'escape' },
    minRange: { Q: 6, R: 25 },
    ult: { targetHpBelow: 0.5 },
  },
  ashvyn: {
    keys: { Q: 'poke', W: 'steroid', E: 'poke' },
    // Six, which is where Pinning Arrow starts rooting instead of slowing.
    // This number is the champion's own conditional, not a taste: the reach
    // pass moved the arrow to 10 and the threshold with it, and a bot that
    // fired at 5.4 would be spending the pin for a slow.
    minRange: { E: 6 },
    ult: { minEnemies: 2, radius: 5.2 },
  },
  maera: {
    keys: { Q: 'poke', W: 'heal', E: 'poke' },
    ult: { minEnemies: 2, radius: 6 },
  },
  torv: {
    keys: { Q: 'engage', W: 'poke', E: 'poke' },
    ult: { minEnemies: 2, radius: 5 },
  },
  rhoka: {
    keys: { Q: 'engage', W: 'poke', E: 'steroid' },
    ult: { minEnemies: 1, radius: 4 },
  },
};

export function hintsFor(championId: string | null): ChampionHints {
  return (championId && BOT_HINTS[championId]) || DEFAULT_HINTS;
}
