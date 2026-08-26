// Dain, Emberfist. Fighter (docs/design/roster.md). Passive Heat (attack
// stacks empowering the next ability) is deferred with the passive-hook
// system; W approximates "burns while it holds" with one burn pulse.

import type { ChampionDef } from './index';

export const DAIN: ChampionDef = {
  id: 'dain',
  name: 'Dain, Emberfist',
  base: {
    hp: 620,
    mana: 300,
    ad: 62,
    ap: 0,
    armor: 28,
    mr: 30,
    attackRange: 1.25,
    attackSpeed: 0.68,
    moveSpeed: 3.5,
    hpRegen: 1.8,
    manaRegen: 1.1,
    radius: 0.68,
  },
  growth: { hp: 100, mana: 30, ad: 3.8, armor: 4.5, mr: 1.8 },
  abilities: {
    Q: {
      name: 'Blazing Jab',
      manaCost: 35,
      cooldown: 5,
      castRange: 3.5,
      spec: {
        kind: 'dash',
        range: 3.5,
        landRadius: 1.6,
        onLand: [{ kind: 'damage', base: 70, adRatio: 0.7, dtype: 'physical' }],
      },
    },
    W: {
      name: 'Cinder Guard',
      manaCost: 55,
      cooldown: 12,
      castRange: 0,
      spec: {
        kind: 'burst',
        radius: 2.5,
        effects: [{ kind: 'damage', base: 60, apRatio: 0.4, dtype: 'magic' }],
        selfEffects: [{ kind: 'shield', base: 90, duration: 3 }],
      },
    },
    E: {
      name: 'Ember Wave',
      manaCost: 45,
      cooldown: 8,
      castRange: 4,
      spec: {
        kind: 'cone',
        range: 4,
        halfAngle: Math.PI / 4,
        onHit: [
          { kind: 'damage', base: 80, adRatio: 0.5, dtype: 'magic' },
          { kind: 'slow', pct: 0.25, duration: 1 },
        ],
      },
    },
    R: {
      name: 'Molten Grasp',
      manaCost: 90,
      cooldown: 80,
      castRange: 2.2,
      spec: {
        kind: 'enemy_target',
        searchRadius: 2,
        effects: [
          { kind: 'damage', base: 200, adRatio: 0.8, dtype: 'magic' },
          { kind: 'stun', duration: 1.2 },
        ],
      },
    },
  },
};
