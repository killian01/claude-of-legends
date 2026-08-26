// Maera, Tidecaller. Healing support (docs/design/roster.md). Passive Spring
// Tide (heal splash to a second ally) is deferred with the passive-hook
// system. Her waves exercise ally-affecting piercing projectiles.

import type { ChampionDef } from './index';

export const MAERA: ChampionDef = {
  id: 'maera',
  name: 'Maera, Tidecaller',
  base: {
    hp: 550,
    mana: 500,
    ad: 48,
    ap: 0,
    armor: 24,
    mr: 32,
    attackRange: 5.25,
    attackSpeed: 0.6,
    moveSpeed: 3.4,
    hpRegen: 1.4,
    manaRegen: 1.9,
    radius: 0.62,
  },
  growth: { hp: 85, mana: 50, ad: 2.5, armor: 4, mr: 1.5 },
  abilities: {
    Q: {
      name: 'Tide Surge',
      manaCost: 60,
      cooldown: 9,
      castRange: 9,
      spec: {
        kind: 'skillshot',
        speed: 20,
        radius: 1.0,
        range: 9,
        pierce: true,
        onHit: [{ kind: 'damage', base: 70, apRatio: 0.5, dtype: 'magic' }],
        allyEffects: [{ kind: 'heal', base: 60, apRatio: 0.4 }],
      },
    },
    W: {
      name: 'Rising Spring',
      manaCost: 70,
      cooldown: 13,
      castRange: 8,
      spec: {
        kind: 'zone',
        radius: 3,
        duration: 4,
        tickEvery: 0.5,
        allyOnTick: [{ kind: 'heal', base: 18, apRatio: 0.12 }],
      },
    },
    E: {
      name: 'Undertow',
      manaCost: 50,
      cooldown: 9,
      castRange: 8,
      spec: {
        kind: 'skillshot',
        speed: 18,
        radius: 0.9,
        range: 8,
        pierce: true,
        onHit: [
          { kind: 'damage', base: 50, apRatio: 0.35, dtype: 'magic' },
          { kind: 'slow', pct: 0.35, duration: 1.5 },
        ],
      },
    },
    R: {
      name: 'Great Wave',
      manaCost: 100,
      cooldown: 90,
      castRange: 10,
      spec: {
        kind: 'skillshot',
        speed: 16,
        radius: 1.6,
        range: 10,
        pierce: true,
        onHit: [
          { kind: 'damage', base: 150, apRatio: 0.6, dtype: 'magic' },
          { kind: 'knockback', distance: 2.5 },
        ],
        allyEffects: [{ kind: 'shield', base: 150, apRatio: 0.5, duration: 3 }],
      },
    },
  },
};
