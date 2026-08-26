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
    moveSpeed: 3.85,
    hpRegen: 1.6,
    manaRegen: 1.3,
    radius: 0.62,
  },
  growth: { hp: 92, mana: 35, ad: 5.5, armor: 2.2, mr: 1.6 },
  abilities: {
    Q: {
      name: 'Lunge',
      manaCost: 35,
      cooldown: 5.5,
      castRange: 5,
      spec: {
        kind: 'dash',
        range: 5,
        landRadius: 1.8,
        onLand: [{ kind: 'damage', base: 79, adRatio: 1.52, dtype: 'physical' }],
      },
    },
    W: {
      name: 'Twin Fangs',
      manaCost: 40,
      cooldown: 6,
      castRange: 8,
      spec: {
        kind: 'skillshot',
        speed: 26,
        radius: 0.5,
        range: 8,
        onHit: [
          { kind: 'damage', base: 40, adRatio: 0.66, dtype: 'physical' },
          { kind: 'damage', base: 40, adRatio: 0.66, dtype: 'physical' },
        ],
      },
    },
    E: {
      name: 'Smoke Veil',
      manaCost: 45,
      cooldown: 10.5,
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
      manaCost: 85,
      cooldown: 56.5,
      castRange: 3,
      spec: {
        kind: 'enemy_target',
        searchRadius: 2,
        effects: [{ kind: 'damage', base: 228, adRatio: 1.9, dtype: 'physical' }],
        // The roster's promised untouchability during the flurry.
        selfEffects: [{ kind: 'untargetable', duration: 1.0 }],
      },
    },
  },
};
