// Ashvyn, Nightbow. Mobile marksman (docs/design/roster.md). Passive
// Twinshot (every third attack strikes twice) and its W reset are deferred
// with the passive-hook system; W keeps the dash and grants attack speed.

import type { ChampionDef } from './index';

export const ASHVYN: ChampionDef = {
  id: 'ashvyn',
  name: 'Ashvyn, Nightbow',
  base: {
    hp: 560,
    mana: 280,
    ad: 58,
    ap: 0,
    armor: 24,
    mr: 30,
    attackRange: 5.5,
    attackSpeed: 0.75,
    moveSpeed: 3.45,
    hpRegen: 1.4,
    manaRegen: 1.3,
    radius: 0.6,
  },
  growth: { hp: 90, mana: 30, ad: 4, armor: 3.8, mr: 1.3 },
  abilities: {
    Q: {
      name: 'Shadow Volley',
      manaCost: 45,
      cooldown: 7,
      castRange: 5.5,
      spec: {
        kind: 'cone',
        range: 5.5,
        halfAngle: Math.PI / 6,
        onHit: [{ kind: 'damage', base: 70, adRatio: 0.7, dtype: 'physical' }],
      },
    },
    W: {
      name: "Hunter's Step",
      manaCost: 40,
      cooldown: 9,
      castRange: 3.5,
      spec: {
        kind: 'dash',
        range: 3.5,
        selfEffects: [{ kind: 'buff', duration: 2.5, asPct: 0.4 }],
      },
    },
    E: {
      name: 'Pinning Arrow',
      manaCost: 55,
      cooldown: 11,
      castRange: 9,
      spec: {
        kind: 'skillshot',
        speed: 26,
        radius: 0.55,
        range: 9,
        onHit: [
          { kind: 'damage', base: 60, adRatio: 0.5, dtype: 'physical' },
          { kind: 'root', duration: 1.0 },
        ],
      },
    },
    R: {
      name: 'Eclipse Rain',
      manaCost: 100,
      cooldown: 85,
      castRange: 9,
      spec: {
        kind: 'zone',
        radius: 4.5,
        duration: 3,
        tickEvery: 0.5,
        onTick: [
          { kind: 'damage', base: 55, adRatio: 0.35, dtype: 'physical' },
          { kind: 'slow', pct: 0.3, duration: 1 },
        ],
      },
    },
  },
};
