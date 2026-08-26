// Vesk, the Longshot. Artillery marksman (docs/design/roster.md). Passive
// Deadstill (bonus vs slowed/immobilized) is deferred with the passive-hook
// system.

import { isRooted, slowPct } from '../../combat/status';
import type { ChampionDef } from './index';

const DEADSTILL_BONUS = 1.15;

export const VESK: ChampionDef = {
  id: 'vesk',
  name: 'Vesk, the Longshot',
  role: 'Marksman',
  blurb: 'Artillery range, immobile and terrifying: punishes anything held still.',
  passive: {
    name: 'Deadstill',
    description: 'Attacks deal 15 percent bonus damage to slowed or immobilized targets.',
    modifyDamage(ctx, _self, target, amount, _dtype, via) {
      if (via !== 'attack') return amount;
      if (slowPct(target, ctx.time) <= 0 && !isRooted(target, ctx.time)) return amount;
      return amount * DEADSTILL_BONUS;
    },
  },
  base: {
    hp: 540,
    mana: 300,
    ad: 60,
    ap: 0,
    armor: 22,
    mr: 30,
    attackRange: 6.2,
    attackSpeed: 0.66,
    moveSpeed: 3.3,
    hpRegen: 1.3,
    manaRegen: 1.4,
    radius: 0.6,
  },
  growth: { hp: 88, mana: 32, ad: 4.2, armor: 3.6, mr: 1.3 },
  abilities: {
    Q: {
      name: 'Piercing Round',
      manaCost: 50,
      cooldown: 8,
      castRange: 14,
      spec: {
        kind: 'skillshot',
        speed: 30,
        radius: 0.5,
        range: 14,
        pierce: true,
        onHit: [{ kind: 'damage', base: 90, adRatio: 0.9, dtype: 'physical' }],
      },
    },
    W: {
      name: 'Caltrops',
      manaCost: 60,
      cooldown: 12,
      castRange: 8,
      spec: {
        kind: 'zone',
        radius: 3,
        duration: 3,
        tickEvery: 0.5,
        onTick: [
          { kind: 'slow', pct: 0.35, duration: 1 },
          { kind: 'damage', base: 10, adRatio: 0.1, dtype: 'physical' },
        ],
      },
    },
    E: {
      name: 'Backstep',
      manaCost: 40,
      cooldown: 10,
      castRange: 3,
      spec: {
        kind: 'dash',
        range: 3,
        selfEffects: [{ kind: 'buff', duration: 3, asPct: 0.5 }],
      },
    },
    R: {
      name: 'Horizon Shot',
      manaCost: 100,
      cooldown: 90,
      castRange: 40,
      spec: {
        kind: 'skillshot',
        speed: 34,
        radius: 0.9,
        range: 40,
        onHit: [
          { kind: 'damage', base: 250, adRatio: 1.0, dtype: 'physical' },
          { kind: 'slow', pct: 0.5, duration: 2 },
        ],
      },
    },
  },
};
