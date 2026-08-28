// Rhoka, Wildclaw. Skirmisher (docs/design/kits-v2.md): wounds that widen,
// a hunt that rewards staying on the kill. Three live bleeds cut the
// target's healing; Pounce refunds against bleeding prey; Apex Frenzy turns
// autos on bleeding targets into sustain instead of granting a flat heal.

import { addStatus } from '../../combat/status';
import type { ChampionDef } from './index';

const REND_DURATION_S = 2.5;
const REND_BASE_DPS = 3;
const REND_DPS_PER_LEVEL = 0.6;
const REND_ABILITY_BONUS_PER_STACK = 0.15;
const REND_MAX_STACKS = 3;
// Three or more live bleeds fester: grievous wounds while they last.
const REND_GRIEVOUS_FACTOR = 0.25;
const REND_GRIEVOUS_REFRESH_S = 1.0;
// Apex Frenzy: autos against bleeding targets heal this much while active.
const FRENZY_HEAL_BASE = 10;
const FRENZY_HEAL_AD_RATIO = 0.15;
// The R buff's exact stat signature, used to detect an active frenzy.
const FRENZY_AS_PCT = 0.6;
const FRENZY_MS_PCT = 0.2;

export const RHOKA: ChampionDef = {
  id: 'rhoka',
  name: 'Rhoka, Wildclaw',
  role: 'Skirmisher',
  blurb: 'A diving brawler who feeds on extended fights and bleeds targets out.',
  passive: {
    name: 'Rend',
    description:
      'Attacks apply a stacking short bleed. Abilities deal 15 percent more damage per bleed ' +
      'on the target (up to 3); three bleeds fester, cutting healing. During Apex Frenzy her ' +
      'attacks on bleeding targets restore health.',
    onAttackHit(ctx, self, target) {
      if (target.kind === 'tower' || target.kind === 'sanctum') return;
      addStatus(target, {
        kind: 'dot',
        until: ctx.time + REND_DURATION_S,
        perSecond: REND_BASE_DPS + REND_DPS_PER_LEVEL * self.level,
        sourceId: self.id,
        dtype: 'physical',
      });
      const bleeds = target.statuses.filter(
        (s) => s.kind === 'dot' && s.sourceId === self.id && s.until > ctx.time,
      ).length;
      // Festering: at three live bleeds the target's healing is cut for as
      // long as Rhoka keeps the wounds open.
      if (bleeds >= REND_MAX_STACKS) {
        addStatus(target, {
          kind: 'grievous',
          until: ctx.time + REND_GRIEVOUS_REFRESH_S,
          factor: REND_GRIEVOUS_FACTOR,
        });
      }
      // Apex Frenzy sustain: detected by the R buff's exact signature (no
      // other Rhoka buff carries it), earned per strike on bleeding prey.
      const frenzied = self.statuses.some(
        (s) =>
          s.kind === 'buff' &&
          s.asPct === FRENZY_AS_PCT &&
          s.msPct === FRENZY_MS_PCT &&
          s.until > ctx.time,
      );
      if (frenzied && bleeds > 0 && !self.dead) {
        self.hp = Math.min(
          self.maxHp,
          self.hp + FRENZY_HEAL_BASE + FRENZY_HEAL_AD_RATIO * self.stats.ad,
        );
      }
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
      // Seed wounds, then pounce again and again: landing on bleeding prey
      // refunds most of the cooldown.
      spec: {
        kind: 'dash',
        range: 5,
        speed: 18,
        landRadius: 2,
        onLand: [
          { kind: 'damage', base: 66, adRatio: 1.14, dtype: 'physical' },
          {
            kind: 'conditional',
            when: { kind: 'targetHasSourceDot' },
            effects: [{ kind: 'cooldownRefund', key: 'Q', pctOfRemaining: 0.6 }],
          },
        ],
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
      // No flat heal any more: the sustain is earned per strike on bleeding
      // targets while the frenzy lasts (the passive reads this buff).
      spec: {
        kind: 'self_or_ally',
        searchRadius: 0,
        effects: [{ kind: 'buff', duration: 5, asPct: 0.6, msPct: 0.2 }],
      },
    },
  },
};
