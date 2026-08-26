// Fenn, the Quickblade. Assassin (docs/design/roster.md). Passive
// Opportunist (execute bonus) is deferred with the passive-hook system; R's
// untargetability is approximated until an untargetable status exists.

import type { ChampionDef } from './index';

const OPPORTUNIST_THRESHOLD = 0.35;
const OPPORTUNIST_BONUS = 1.15;

export const FENN: ChampionDef = {
  id: 'fenn',
  name: 'Fenn, the Quickblade',
  role: 'Assassin',
  blurb: 'A single-target executioner who commits hard and finishes low targets.',
  passive: {
    name: 'Opportunist',
    description: 'Deals 15 percent bonus damage to enemies below 35 percent health.',
    modifyDamage(_ctx, _self, target, amount) {
      if (target.maxHp <= 0 || target.hp / target.maxHp >= OPPORTUNIST_THRESHOLD) return amount;
      return amount * OPPORTUNIST_BONUS;
    },
  },
  base: {
    hp: 560,
    mana: 320,
    ad: 64,
    ap: 0,
    armor: 24,
    mr: 30,
    attackRange: 1.25,
    attackSpeed: 0.7,
    moveSpeed: 3.6,
    hpRegen: 1.6,
    manaRegen: 1.3,
    radius: 0.62,
  },
  growth: { hp: 92, mana: 35, ad: 4, armor: 3.8, mr: 1.6 },
  abilities: {
    Q: {
      name: 'Lunge',
      manaCost: 40,
      cooldown: 7,
      castRange: 5,
      spec: {
        kind: 'dash',
        range: 5,
        landRadius: 1.8,
        onLand: [{ kind: 'damage', base: 90, adRatio: 0.8, dtype: 'physical' }],
      },
    },
    W: {
      name: 'Twin Fangs',
      manaCost: 45,
      cooldown: 8,
      castRange: 8,
      spec: {
        kind: 'skillshot',
        speed: 26,
        radius: 0.5,
        range: 8,
        onHit: [
          { kind: 'damage', base: 45, adRatio: 0.35, dtype: 'physical' },
          { kind: 'damage', base: 45, adRatio: 0.35, dtype: 'physical' },
        ],
      },
    },
    E: {
      name: 'Smoke Veil',
      manaCost: 50,
      cooldown: 14,
      castRange: 0,
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [
          { kind: 'stealth', duration: 2.5 },
          { kind: 'buff', duration: 2.5, msPct: 0.25 },
        ],
      },
    },
    R: {
      name: 'Shadow Flurry',
      manaCost: 100,
      cooldown: 75,
      castRange: 3,
      spec: {
        kind: 'enemy_target',
        searchRadius: 2,
        effects: [{ kind: 'damage', base: 260, adRatio: 1.0, dtype: 'physical' }],
      },
    },
  },
};
