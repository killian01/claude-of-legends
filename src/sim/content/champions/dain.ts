// Dain, Emberfist. Fighter (docs/design/kits-v2.md): a momentum brawler who
// banks Heat and spends it in beats. Q is a pass-through punch whose refund
// loop rewards clean hits; W punishes shield-popping; E ignites his fists.

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
      'Attacks build Heat (up to 4); Ember Flurry adds one. At full Heat, the next ability ' +
      'deals 25 percent bonus damage.',
    onAttackHit(_ctx, self) {
      self.passiveStacks = Math.min(HEAT_MAX, self.passiveStacks + 1);
    },
    onCast(_ctx, self, key) {
      if (key === 'E') self.passiveStacks = Math.min(HEAT_MAX, self.passiveStacks + 1);
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
      // A traveling punch through the line: hitting a champion refunds half
      // the cooldown, the weave that keeps his trades alive.
      spec: {
        kind: 'dash',
        range: 3.5,
        speed: 18,
        passThrough: [
          { kind: 'damage', base: 95, adRatio: 0.7, dtype: 'physical' },
          {
            kind: 'conditional',
            when: { kind: 'targetIsChampion' },
            effects: [{ kind: 'cooldownRefund', key: 'Q', pctOfRemaining: 0.5 }],
          },
        ],
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
        // Breaking the guard early detonates it: attackers choose between
        // popping the shield and eating the blast, or waiting it out.
        selfEffects: [
          {
            kind: 'shield',
            base: 90,
            duration: 3,
            burst: {
              radius: 2.5,
              onBreak: [
                { kind: 'damage', base: 70, apRatio: 0.3, dtype: 'magic' },
                { kind: 'slow', pct: 0.2, duration: 1 },
              ],
            },
          },
        ],
      },
    },
    E: {
      name: 'Ember Flurry',
      manaCost: 30,
      cooldown: 7,
      castRange: 0,
      // Ignited fists: the next auto hits harder, splashes behind the
      // victim, and banks an extra Heat stack (passive onCast).
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [
          {
            kind: 'empower',
            duration: 3,
            bonus: [{ kind: 'damage', base: 60, adRatio: 0.4, dtype: 'magic' }],
            splashRadius: 2,
            splash: [{ kind: 'damage', base: 45, adRatio: 0.3, dtype: 'magic' }],
          },
        ],
      },
    },
    R: {
      name: 'Emberfall',
      manaCost: 75,
      cooldown: 60,
      castRange: 6,
      // A called-down comet: the zone telegraphs for just over a second
      // (real counterplay, you can walk out). Only the epicenter stuns; the
      // rim burns and slows, so the aim is the skill.
      spec: {
        kind: 'zone',
        radius: 3,
        duration: 1.1,
        detonateDelay: 1.05,
        onDetonate: [
          {
            kind: 'conditional',
            when: { kind: 'withinCenter', radius: 1.4 },
            effects: [
              { kind: 'damage', base: 250, adRatio: 0.8, dtype: 'magic' },
              { kind: 'stun', duration: 1.2 },
              { kind: 'dot', duration: 2, perSecond: 30, dtype: 'magic' },
            ],
            otherwise: [
              { kind: 'damage', base: 150, adRatio: 0.5, dtype: 'magic' },
              { kind: 'slow', pct: 0.4, duration: 1.5 },
            ],
          },
        ],
      },
    },
  },
};
