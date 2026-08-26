// Dain, Emberfist. Fighter (docs/design/roster.md). Passive Heat (attack
// stacks empowering the next ability) is deferred with the passive-hook
// system; W approximates "burns while it holds" with one burn pulse.

import type { ChampionDef } from './index';

const HEAT_MAX = 4;
const HEAT_BONUS = 1.25;

export const DAIN: ChampionDef = {
  id: 'dain',
  name: 'Dain, Emberfist',
  role: 'Fighter',
  blurb: 'A brawler who wants long trades: attacks build Heat for empowered abilities.',
  passive: {
    name: 'Heat',
    description:
      'Attacks build Heat (up to 4). At full Heat, the next ability deals 25 percent bonus damage.',
    onAttackHit(_ctx, self) {
      self.passiveStacks = Math.min(HEAT_MAX, self.passiveStacks + 1);
    },
    modifyDamage(_ctx, self, _target, amount, _dtype, via) {
      if (via !== 'ability' || self.passiveStacks < HEAT_MAX) return amount;
      self.passiveStacks = 0;
      return amount * HEAT_BONUS;
    },
  },
  base: {
    hp: 620,
    mana: 300,
    ad: 62,
    ap: 0,
    armor: 28,
    mr: 30,
    attackRange: 1.25,
    attackSpeed: 0.68,
    moveSpeed: 3.75,
    hpRegen: 1.8,
    manaRegen: 1.1,
    radius: 0.68,
  },
  growth: { hp: 100, mana: 30, ad: 3.8, armor: 2.6, mr: 1.8 },
  abilities: {
    Q: {
      name: 'Blazing Jab',
      manaCost: 30,
      cooldown: 4,
      castRange: 3.5,
      spec: {
        kind: 'dash',
        range: 3.5,
        landRadius: 1.6,
        onLand: [{ kind: 'damage', base: 95, adRatio: 0.7, dtype: 'physical' }],
      },
    },
    W: {
      name: 'Cinder Guard',
      manaCost: 45,
      cooldown: 9,
      castRange: 0,
      spec: {
        kind: 'burst',
        radius: 2.5,
        // The roster's burn-while-held: enemies caught in the guard keep
        // burning while the shield holds.
        effects: [
          { kind: 'damage', base: 40, apRatio: 0.2, dtype: 'magic' },
          { kind: 'dot', duration: 3, perSecond: 22, dtype: 'magic' },
        ],
        selfEffects: [{ kind: 'shield', base: 90, duration: 3 }],
      },
    },
    E: {
      name: 'Ember Wave',
      manaCost: 40,
      cooldown: 6,
      castRange: 4,
      spec: {
        kind: 'cone',
        range: 4,
        halfAngle: Math.PI / 4,
        onHit: [
          { kind: 'damage', base: 108, adRatio: 0.5, dtype: 'magic' },
          { kind: 'slow', pct: 0.25, duration: 1 },
        ],
      },
    },
    R: {
      name: 'Molten Grasp',
      manaCost: 75,
      cooldown: 60,
      castRange: 2.2,
      spec: {
        kind: 'enemy_target',
        searchRadius: 2,
        effects: [
          { kind: 'damage', base: 270, adRatio: 0.8, dtype: 'magic' },
          { kind: 'stun', duration: 1.2 },
        ],
      },
    },
  },
};
