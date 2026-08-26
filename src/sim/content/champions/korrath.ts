// Korrath, the Bulwark. Tank (docs/design/roster.md). Passive Shieldskin
// (shield when unhit for a while) is deferred with the passive-hook system.

import type { ChampionDef } from './index';

export const KORRATH: ChampionDef = {
  id: 'korrath',
  name: 'Korrath, the Bulwark',
  base: {
    hp: 650,
    mana: 320,
    ad: 58,
    ap: 0,
    armor: 32,
    mr: 32,
    attackRange: 1.25,
    attackSpeed: 0.62,
    moveSpeed: 3.4,
    hpRegen: 2.2,
    manaRegen: 1.2,
    radius: 0.75,
  },
  growth: { hp: 110, mana: 35, ad: 3.5, armor: 5, mr: 2 },
  abilities: {
    Q: {
      name: 'Shield Slam',
      manaCost: 40,
      cooldown: 6,
      castRange: 3,
      spec: {
        kind: 'cone',
        range: 3,
        halfAngle: Math.PI / 3.5,
        onHit: [
          { kind: 'damage', base: 70, adRatio: 0.4, dtype: 'physical' },
          { kind: 'slow', pct: 0.3, duration: 1.5 },
        ],
      },
    },
    W: {
      name: 'Iron Wall',
      manaCost: 50,
      cooldown: 14,
      castRange: 0,
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [{ kind: 'buff', duration: 3, armor: 40, mr: 40 }],
      },
    },
    E: {
      name: 'Grip Chain',
      manaCost: 60,
      cooldown: 12,
      castRange: 8,
      spec: {
        kind: 'skillshot',
        speed: 20,
        radius: 0.6,
        range: 8,
        onHit: [
          { kind: 'damage', base: 60, adRatio: 0.3, dtype: 'physical' },
          { kind: 'pull', distance: 6 },
        ],
      },
    },
    R: {
      name: 'Earthbreak',
      manaCost: 100,
      cooldown: 90,
      castRange: 6.5,
      spec: {
        kind: 'dash',
        range: 6.5,
        landRadius: 3,
        onLand: [
          { kind: 'damage', base: 150, adRatio: 0.5, dtype: 'magic' },
          { kind: 'stun', duration: 1.0 },
        ],
      },
    },
  },
};
