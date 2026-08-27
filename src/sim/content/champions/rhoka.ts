// Rhoka, Wildclaw. Skirmisher (docs/design/roster.md). Passive Rend
// (stacking bleed on attacks) and W's per-stack bonus are deferred with the
// passive-hook system; R approximates sustained lifesteal with a burst heal.

import { addStatus } from '../../combat/status';
import type { ChampionDef } from './index';

const REND_DURATION_S = 2.5;
const REND_BASE_DPS = 3;
const REND_DPS_PER_LEVEL = 0.6;
const REND_ABILITY_BONUS_PER_STACK = 0.15;
const REND_MAX_STACKS = 3;

export const RHOKA: ChampionDef = {
  id: 'rhoka',
  name: 'Rhoka, Wildclaw',
  role: 'Skirmisher',
  blurb: 'A diving brawler who feeds on extended fights and bleeds targets out.',
  passive: {
    name: 'Rend',
    description:
      'Attacks apply a stacking short bleed. Abilities deal 15 percent more ' +
      'damage per bleed on the target (up to 3).',
    onAttackHit(ctx, self, target) {
      if (target.kind === 'tower' || target.kind === 'sanctum') return;
      addStatus(target, {
        kind: 'dot',
        until: ctx.time + REND_DURATION_S,
        perSecond: REND_BASE_DPS + REND_DPS_PER_LEVEL * self.level,
        sourceId: self.id,
        dtype: 'physical',
      });
    },
    // The roster's promised per-stack payoff on ability damage.
    modifyDamage(ctx, self, target, amount, _dtype, via) {
      if (via !== 'ability') return amount;
      const bleeds = target.statuses.filter(
        (s) => s.kind === 'dot' && s.sourceId === self.id && s.until > ctx.time,
      ).length;
      return amount * (1 + REND_ABILITY_BONUS_PER_STACK * Math.min(bleeds, REND_MAX_STACKS));
    },
  },
  base: {
    hp: 600,
    mana: 320,
    ad: 60,
    ap: 0,
    armor: 27,
    mr: 30,
    attackRange: 1.25,
    attackSpeed: 0.72,
    moveSpeed: 3.8,
    hpRegen: 1.9,
    manaRegen: 1.2,
    radius: 0.66,
  },
  growth: { hp: 98, mana: 32, ad: 3.8, armor: 2.4, mr: 1.6 },
  abilities: {
    Q: {
      name: 'Pounce',
      manaCost: 40,
      cooldown: 5.5,
      castRange: 5,
      spec: {
        kind: 'dash',
        range: 5,
        landRadius: 2,
        onLand: [{ kind: 'damage', base: 66, adRatio: 1.14, dtype: 'physical' }],
      },
    },
    W: {
      name: 'Savage Sweep',
      manaCost: 45,
      cooldown: 6,
      castRange: 0,
      // Instant heavy burst: the sweep telegraphs before it lands.
      windup: 0.3,
      spec: {
        kind: 'burst',
        radius: 2.4,
        effects: [{ kind: 'damage', base: 79, adRatio: 1.33, dtype: 'physical' }],
      },
    },
    E: {
      name: 'Primal Howl',
      manaCost: 40,
      cooldown: 8.5,
      castRange: 0,
      spec: {
        kind: 'burst',
        radius: 3,
        effects: [{ kind: 'slow', pct: 0.3, duration: 1.5 }],
        selfEffects: [{ kind: 'buff', duration: 3, asPct: 0.45 }],
      },
    },
    R: {
      name: 'Apex Frenzy',
      manaCost: 85,
      cooldown: 60,
      castRange: 0,
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [
          { kind: 'heal', base: 180 },
          { kind: 'buff', duration: 5, asPct: 0.6, msPct: 0.2 },
        ],
      },
    },
  },
};
