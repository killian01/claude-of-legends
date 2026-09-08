// The passive template set (ADR 0006): every forged passive is one of these
// engine-owned archetypes instantiated with numeric parameters, so player
// intent becomes engine behavior without player code. One template per
// roster passive archetype: if a roster champion's passive works some way,
// a forged champion can have that way too, with its own numbers. Templates
// must stay deterministic: sim state and ctx only, exactly like the roster
// passives they mirror.

import { dealDamage } from '../combat/damage';
import { addStatus, healFactor, isRooted, refreshBuff, slowPct } from '../combat/status';
import { hypot } from '../exact';
import type { ChampionPassive } from '../passive_types';
import type { CombatCtx } from '../sim_context';
import type { Unit } from '../unit';

// The hooks a template instantiates; name and description are added by
// resolve.ts (authored name, derived description).
export type PassiveHooks = Omit<ChampionPassive, 'name' | 'description'>;

export interface TemplateParam {
  key: string;
  min: number;
  max: number;
  integer?: boolean;
  // Budget points per unit of the param's value; negative when a higher
  // value weakens the passive (e.g. more attacks needed per echo). The
  // template's flat price sits in baseCost; the total is clamped at zero.
  costPerUnit: number;
}

export interface PassiveTemplate {
  id: string;
  // What the archetype does, for the Forge's template picker.
  summary: string;
  params: readonly TemplateParam[];
  baseCost: number;
  describe(params: Record<string, number>): string;
  create(params: Record<string, number>): PassiveHooks;
}

// Just over the 4 Hz passive tick, so aura-style buffs never flicker off
// (the same reasoning as Torv's Bulwark Aura).
const AURA_REFRESH_S = 0.4;
// How long a calm-earned shield lingers before it fades unspent.
const CARAPACE_LINGER_S = 6;

function pct(v: number): string {
  return `${Math.round(v * 100)} percent`;
}

function nearestOtherAlly(ctx: CombatCtx, self: Unit, around: Unit, range: number): Unit | null {
  let best: Unit | null = null;
  let bestD = range;
  for (const u of ctx.units.values()) {
    if (u.kind !== 'champion' || u.team !== self.team) continue;
    if (u.id === around.id || u.id === self.id || u.dead || ctx.dead.has(u.id)) continue;
    const d = hypot(u.pos.x - around.pos.x, u.pos.z - around.pos.z);
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

const ALL: readonly PassiveTemplate[] = [
  {
    id: 'warding_aura',
    summary: 'Nearby allied champions gain armor and magic resist.',
    params: [
      { key: 'radius', min: 3, max: 8, costPerUnit: 2 },
      { key: 'armor', min: 0, max: 15, costPerUnit: 3 },
      { key: 'mr', min: 0, max: 15, costPerUnit: 3 },
    ],
    baseCost: 10,
    describe: ({ radius = 3, armor = 0, mr = 0 }) =>
      `Allied champions within ${radius} gain ${armor} bonus armor and ${mr} bonus magic resist.`,
    create: ({ radius = 3, armor = 0, mr = 0 }) => ({
      onTick(ctx, self) {
        for (const u of ctx.units.values()) {
          if (u.kind !== 'champion' || u.team !== self.team || u.dead || ctx.dead.has(u.id)) {
            continue;
          }
          if (hypot(u.pos.x - self.pos.x, u.pos.z - self.pos.z) > radius) continue;
          refreshBuff(u, ctx.time, AURA_REFRESH_S, { armor, mr });
        }
      },
    }),
  },
  {
    id: 'serrated_strikes',
    summary: 'Attacks apply a short stacking bleed.',
    params: [
      { key: 'perSecond', min: 1, max: 8, costPerUnit: 4 },
      { key: 'perLevel', min: 0, max: 1.5, costPerUnit: 30 },
      { key: 'duration', min: 1, max: 4, costPerUnit: 4 },
    ],
    baseCost: 10,
    describe: ({ perSecond = 1, perLevel = 0, duration = 1 }) =>
      `Attacks open a ${duration} second bleed dealing ${perSecond} physical damage ` +
      `per second, plus ${perLevel} per level. Bleeds stack.`,
    create: ({ perSecond = 1, perLevel = 0, duration = 1 }) => ({
      onAttackHit(ctx, self, target) {
        if (target.kind === 'tower' || target.kind === 'sanctum') return;
        addStatus(target, {
          kind: 'dot',
          until: ctx.time + duration,
          perSecond: perSecond + perLevel * self.level,
          sourceId: self.id,
          dtype: 'physical',
        });
      },
    }),
  },
  {
    id: 'executioner',
    summary: 'Bonus damage to enemies below a health threshold.',
    params: [
      { key: 'hpThreshold', min: 0.1, max: 0.5, costPerUnit: 40 },
      { key: 'bonusPct', min: 0.05, max: 0.3, costPerUnit: 250 },
    ],
    baseCost: 5,
    describe: ({ hpThreshold = 0.1, bonusPct = 0.05 }) =>
      `Deals ${pct(bonusPct)} bonus damage to enemies below ${pct(hpThreshold)} health.`,
    create: ({ hpThreshold = 0.1, bonusPct = 0.05 }) => ({
      modifyDamage(_ctx, _self, target, amount) {
        if (target.maxHp <= 0 || target.hp / target.maxHp >= hpThreshold) return amount;
        return amount * (1 + bonusPct);
      },
    }),
  },
  {
    id: 'battle_flow',
    summary: 'Dealing ability damage grants a brief burst of move speed.',
    params: [
      { key: 'msPct', min: 0.03, max: 0.15, costPerUnit: 300 },
      { key: 'duration', min: 0.5, max: 2, costPerUnit: 8 },
    ],
    baseCost: 5,
    describe: ({ msPct = 0.03, duration = 0.5 }) =>
      `Dealing ability damage grants ${pct(msPct)} move speed for ${duration} seconds.`,
    create: ({ msPct = 0.03, duration = 0.5 }) => ({
      modifyDamage(ctx, self, _target, amount, _dtype, via) {
        if (via === 'ability' && amount > 0) {
          refreshBuff(self, ctx.time, duration, { msPct });
        }
        return amount;
      },
    }),
  },
  {
    id: 'rhythm_echo',
    summary: 'Every Nth attack strikes a second time.',
    params: [
      { key: 'every', min: 2, max: 5, integer: true, costPerUnit: -10 },
      { key: 'adRatio', min: 0.2, max: 0.8, costPerUnit: 150 },
    ],
    baseCost: 10,
    describe: ({ every = 2, adRatio = 0.2 }) =>
      `Every ${every} attacks, the strike echoes for ${pct(adRatio)} attack damage.`,
    create: ({ every = 2, adRatio = 0.2 }) => ({
      onAttackHit(ctx, self, target) {
        self.passiveStacks += 1;
        if (self.passiveStacks < every) return;
        self.passiveStacks = 0;
        dealDamage(ctx, self.id, target, self.stats.ad * adRatio, 'physical', 'other');
      },
    }),
  },
  {
    id: 'calm_carapace',
    summary: 'Gain a shield after a few seconds without taking damage.',
    params: [
      { key: 'calmSeconds', min: 3, max: 8, costPerUnit: -2 },
      { key: 'shieldBase', min: 10, max: 60, costPerUnit: 0.5 },
      { key: 'shieldPerLevel', min: 0, max: 12, costPerUnit: 4 },
    ],
    baseCost: 5,
    describe: ({ calmSeconds = 3, shieldBase = 10, shieldPerLevel = 0 }) =>
      `After ${calmSeconds} seconds without taking damage, gains a shield of ` +
      `${shieldBase} plus ${shieldPerLevel} per level.`,
    create: ({ calmSeconds = 3, shieldBase = 10, shieldPerLevel = 0 }) => ({
      onTick(ctx, self) {
        if (ctx.time - self.lastDamagedAt < calmSeconds) return;
        if (self.statuses.some((s) => s.kind === 'shield' && s.until > ctx.time)) return;
        addStatus(self, {
          kind: 'shield',
          until: ctx.time + CARAPACE_LINGER_S,
          remaining: shieldBase + shieldPerLevel * self.level,
        });
      },
    }),
  },
  {
    id: 'predators_focus',
    summary: 'Attacks hit harder against slowed or immobilized targets.',
    params: [{ key: 'bonusPct', min: 0.05, max: 0.3, costPerUnit: 250 }],
    baseCost: 5,
    describe: ({ bonusPct = 0.05 }) =>
      `Attacks deal ${pct(bonusPct)} bonus damage to slowed or immobilized targets.`,
    create: ({ bonusPct = 0.05 }) => ({
      modifyDamage(ctx, _self, target, amount, _dtype, via) {
        if (via !== 'attack') return amount;
        if (slowPct(target, ctx.time) <= 0 && !isRooted(target, ctx.time)) return amount;
        return amount * (1 + bonusPct);
      },
    }),
  },
  {
    id: 'mending_ripple',
    summary: 'Heals splash a fraction of the amount onto the nearest other ally.',
    params: [
      { key: 'ratio', min: 0.1, max: 0.5, costPerUnit: 120 },
      { key: 'range', min: 3, max: 8, costPerUnit: 1 },
    ],
    baseCost: 5,
    describe: ({ ratio = 0.1, range = 3 }) =>
      `Heals splash ${pct(ratio)} of the amount onto the nearest other ally ` + `within ${range}.`,
    create: ({ ratio = 0.1, range = 3 }) => ({
      onHealGiven(ctx, self, target, amount) {
        const best = nearestOtherAlly(ctx, self, target, range);
        if (!best) return;
        const splash = amount * ratio * healFactor(best, ctx.time);
        best.hp = Math.min(best.maxHp, best.hp + splash);
      },
    }),
  },
  {
    id: 'stacking_surge',
    summary: 'Attacks build stacks; at full stacks the next ability hits harder.',
    params: [
      { key: 'stacks', min: 3, max: 6, integer: true, costPerUnit: -5 },
      { key: 'bonusPct', min: 0.1, max: 0.4, costPerUnit: 200 },
    ],
    baseCost: 5,
    describe: ({ stacks = 3, bonusPct = 0.1 }) =>
      `Attacks build stacks (up to ${stacks}); at full stacks, the next ability deals ` +
      `${pct(bonusPct)} bonus damage and spends them.`,
    create: ({ stacks = 3, bonusPct = 0.1 }) => ({
      onAttackHit(_ctx, self) {
        self.passiveStacks = Math.min(stacks, self.passiveStacks + 1);
      },
      modifyDamage(_ctx, self, _target, amount, _dtype, via) {
        if (via !== 'ability' || self.passiveStacks < stacks) return amount;
        self.passiveStacks = 0;
        return amount * (1 + bonusPct);
      },
    }),
  },
  {
    id: 'kit_inscribed',
    summary: 'No hook of its own: the kit itself carries the passive.',
    params: [],
    baseCost: 0,
    describe: () => 'The kit carries the passive: its printed spell effects are the whole story.',
    create: () => ({}),
  },
];

export const PASSIVE_TEMPLATES: Readonly<Record<string, PassiveTemplate>> = Object.fromEntries(
  ALL.map((t) => [t.id, t]),
);

export const PASSIVE_TEMPLATE_LIST: readonly PassiveTemplate[] = ALL;
