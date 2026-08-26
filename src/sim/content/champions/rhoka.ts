// Rhoka, Wildclaw. Skirmisher (docs/design/roster.md). Passive Rend
// (stacking bleed on attacks) and W's per-stack bonus are deferred with the
// passive-hook system; R approximates sustained lifesteal with a burst heal.

import type { ChampionDef } from './index';

export const RHOKA: ChampionDef = {
  id: 'rhoka',
  name: 'Rhoka, Wildclaw',
  base: {
    hp: 600,
    mana: 320,
    ad: 60,
    ap: 0,
    armor: 27,
    mr: 30,
    attackRange: 1.25,
    attackSpeed: 0.72,
    moveSpeed: 3.55,
    hpRegen: 1.9,
    manaRegen: 1.2,
    radius: 0.66,
  },
  growth: { hp: 98, mana: 32, ad: 3.8, armor: 4.2, mr: 1.6 },
  abilities: {
    Q: {
      name: 'Pounce',
      manaCost: 45,
      cooldown: 7,
      castRange: 5,
      spec: {
        kind: 'dash',
        range: 5,
        landRadius: 2,
        onLand: [{ kind: 'damage', base: 75, adRatio: 0.6, dtype: 'physical' }],
      },
    },
    W: {
      name: 'Savage Sweep',
      manaCost: 50,
      cooldown: 8,
      castRange: 0,
      spec: {
        kind: 'burst',
        radius: 2.4,
        effects: [{ kind: 'damage', base: 90, adRatio: 0.7, dtype: 'physical' }],
      },
    },
    E: {
      name: 'Primal Howl',
      manaCost: 45,
      cooldown: 11,
      castRange: 0,
      spec: {
        kind: 'burst',
        radius: 3,
        effects: [{ kind: 'slow', pct: 0.3, duration: 1.5 }],
        selfEffects: [{ kind: 'buff', duration: 3, asPct: 0.45 }],
      },
    },
    R: {
      name: 'Apex Frenzy',
      manaCost: 100,
      cooldown: 80,
      castRange: 0,
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [
          { kind: 'heal', base: 180 },
          { kind: 'buff', duration: 5, asPct: 0.6, msPct: 0.2 },
        ],
      },
    },
  },
};
