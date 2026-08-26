// Torv, Stonehorn. Engage support (docs/design/roster.md). Passive Bulwark
// Aura (armor to nearby allies) is deferred with the passive-hook system.
// His W exercises the taunt primitive.

import type { ChampionDef } from './index';

export const TORV: ChampionDef = {
  id: 'torv',
  name: 'Torv, Stonehorn',
  base: {
    hp: 640,
    mana: 340,
    ad: 56,
    ap: 0,
    armor: 30,
    mr: 32,
    attackRange: 1.25,
    attackSpeed: 0.6,
    moveSpeed: 3.45,
    hpRegen: 2.0,
    manaRegen: 1.3,
    radius: 0.72,
  },
  growth: { hp: 105, mana: 35, ad: 3.2, armor: 5, mr: 2 },
  abilities: {
    Q: {
      name: 'Horn Charge',
      manaCost: 50,
      cooldown: 10,
      castRange: 5.5,
      spec: {
        kind: 'dash',
        range: 5.5,
        landRadius: 2,
        onLand: [
          { kind: 'damage', base: 80, adRatio: 0.5, dtype: 'physical' },
          { kind: 'knockback', distance: 2 },
        ],
      },
    },
    W: {
      name: 'Challenge',
      manaCost: 60,
      cooldown: 14,
      castRange: 0,
      spec: {
        kind: 'burst',
        radius: 3,
        effects: [{ kind: 'taunt', duration: 1.2 }],
      },
    },
    E: {
      name: 'Tremor Stomp',
      manaCost: 45,
      cooldown: 8,
      castRange: 0,
      spec: {
        kind: 'burst',
        radius: 3.2,
        effects: [
          { kind: 'damage', base: 60, adRatio: 0.4, dtype: 'magic' },
          { kind: 'slow', pct: 0.3, duration: 1.5 },
        ],
      },
    },
    R: {
      name: 'Faultline',
      manaCost: 100,
      cooldown: 90,
      castRange: 9,
      spec: {
        kind: 'skillshot',
        speed: 18,
        radius: 1.2,
        range: 9,
        pierce: true,
        onHit: [
          { kind: 'damage', base: 150, adRatio: 0.6, dtype: 'magic' },
          { kind: 'stun', duration: 1.2 },
        ],
      },
    },
  },
};
