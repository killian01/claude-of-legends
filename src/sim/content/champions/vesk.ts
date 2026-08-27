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
    moveSpeed: 3.55,
    hpRegen: 1.3,
    manaRegen: 1.4,
    radius: 0.6,
  },
  growth: { hp: 88, mana: 32, ad: 5.5, armor: 2, mr: 1.3 },
  abilities: {
    Q: {
      name: 'Piercing Round',
      manaCost: 45,
      cooldown: 6,
      castRange: 14,
      // The marksman shoulders his rifle before the shot: a short windup
      // that telegraphs the line and lets the target step off it.
      windup: 0.3,
      spec: {
        kind: 'skillshot',
        speed: 30,
        radius: 0.5,
        range: 14,
        pierce: true,
        onHit: [{ kind: 'damage', base: 79, adRatio: 1.71, dtype: 'physical' }],
      },
    },
    W: {
      name: 'Caltrops',
      manaCost: 50,
      cooldown: 9,
      castRange: 8,
      spec: {
        kind: 'zone',
        radius: 3,
        duration: 3,
        tickEvery: 0.5,
        onTick: [
          { kind: 'slow', pct: 0.35, duration: 1 },
          { kind: 'damage', base: 9, adRatio: 0.19, dtype: 'physical' },
        ],
      },
    },
    E: {
      name: 'Backstep',
      manaCost: 35,
      cooldown: 7.5,
      castRange: 3,
      spec: {
        kind: 'dash',
        range: 3,
        selfEffects: [{ kind: 'buff', duration: 3, asPct: 0.5 }],
      },
    },
    R: {
      name: 'Horizon Shot',
      manaCost: 85,
      cooldown: 67.5,
      // Map-crossing artillery (the map is 150 across): the shot itself is
      // the fantasy, so the range covers anything Vesk can draw a line to.
      castRange: 120,
      windup: 0.6,
      spec: {
        kind: 'skillshot',
        speed: 40,
        radius: 0.9,
        range: 120,
        onHit: [
          { kind: 'damage', base: 220, adRatio: 1.9, dtype: 'physical' },
          { kind: 'slow', pct: 0.5, duration: 2 },
        ],
      },
    },
  },
};
