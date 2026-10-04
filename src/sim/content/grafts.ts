// The Grafts (CONTEXT.md: Graft; ADR 0032): the battle royale's in-match
// choices, as data. Fourteen entries in three grades: a Sprout raises a raw
// stat and stacks twice, a Bough changes a rule, a Heartwood changes the
// kit and shows on the champion for everyone. Code-bearing content on the
// item passives' hook shapes (content/item_passives.ts) plus onDamaged,
// onTakedown and onCast, dispatched from src/sim/passives.ts and only for a
// champion holding Grafts: everywhere else (the 5v5) nothing here runs.
// Deterministic like every passive: sim state and ctx only.
//
// Beside the table: when each variant offers which grade (the triggers),
// the queue's and the pick's clocks, and what a champion's role weighs a
// card by. The rules that read them live in src/sim/royale/grafts.ts.

import { dealDamage } from '../combat/damage';
import { addStatus } from '../combat/status';
import { outOfCombat } from '../favors';
import { dist2 } from '../geo';
import type { DamageVia } from '../passive_types';
import { DAMAGE_BUILD, MAGIC_BUILD, roleBuild } from '../playbook/kit';
import type { GraftGrade, RoyaleVariant } from '../royale/types';
import type { CombatCtx } from '../sim_context';
import type { DamageType } from '../types';
import { hostile, type Unit } from '../unit';

// Seconds a seat has to pick the open offer's card before card 0 is taken.
export const GRAFT_PICK_S = 10;
// The drop's offer closes this long after the landing instead.
export const GRAFT_DROP_LAND_S = 3;
// Offers a seat queues at most, the open one included.
export const GRAFT_QUEUE_MAX = 3;
// Stacks a Sprout reaches at most.
export const SPROUT_STACKS = 2;
// A card whose role tag matches the champion's weighs this much in the
// draw; every other weighs 1.
export const GRAFT_ROLE_WEIGHT = 2;
// Rootbound's per-target memory, at most this many targets.
export const GRAFT_ROOT_MEMORY = 8;

// A champion's role as the Grafts read it: the house build its role walks
// (playbook/kit.ts), the damage line, the magic line or the shell.
export type GraftRole = 'damage' | 'magic' | 'shell';

export function graftRoleOf(championId: string | null): GraftRole {
  const build = roleBuild(championId);
  return build === DAMAGE_BUILD ? 'damage' : build === MAGIC_BUILD ? 'magic' : 'shell';
}

// What a card's offer rule reads: the variant, the Dusk's phase and the
// champions still in.
export interface GraftOfferCtx {
  variant: RoyaleVariant;
  phase: number;
  alive: number;
}

export interface GraftDef {
  id: string;
  name: string;
  grade: GraftGrade;
  // The roles it is drawn twice as often for.
  roles: readonly GraftRole[];
  // The card's line: short and concrete.
  text: string;
  // A Heartwood's aura and icon color on the planet.
  color?: number;
  // A Sprout's share per stack, multiplied into the totals (stats.ts).
  stat?: { ad?: number; ap?: number; attackSpeed?: number; hp?: number };
  // False when the card is not drawn now.
  offerIf?(ctx: GraftOfferCtx): boolean;
  // After an auto-attack of `self` lands on `target`.
  onAttackHit?(ctx: CombatCtx, self: Unit, target: Unit): void;
  // Before mitigation of damage dealt BY `self`; returns the new amount.
  modifyDamage?(
    ctx: CombatCtx,
    self: Unit,
    target: Unit,
    amount: number,
    dtype: DamageType,
    via: DamageVia,
  ): number;
  // Every 5th tick (4 Hz), staggered by unit id.
  onTick?(ctx: CombatCtx, self: Unit): void;
  // After `self` lost `amount` health to a hit and still stands.
  onDamaged?(
    ctx: CombatCtx,
    self: Unit,
    source: Unit | undefined,
    amount: number,
    via: DamageVia,
  ): void;
  // After `self` earned a takedown (kill or assist) on an enemy champion.
  onTakedown?(ctx: CombatCtx, self: Unit, victim: Unit): void;
  // After `self` paid for a cast, its cooldown set.
  onCast?(ctx: CombatCtx, self: Unit, key: 'Q' | 'W' | 'E' | 'R'): void;
}

// The numbers, named.
export const KEEN_EDGE_PCT = 0.15;
export const QUICK_SAP_PCT = 0.18;
export const DEEP_ROOTS_PCT = 0.15;
export const SECOND_BREATH_AFTER_S = 3;
export const SECOND_BREATH_HEAL = 0.06;
export const SECOND_BREATH_LATE_ALIVE = 5;
export const STONEBLOOD_SHARE = 0.12;
export const STONEBLOOD_EVERY_S = 12;
export const STONEBLOOD_LASTS_S = 4;
export const HUNTERS_EYE_ABOVE = 0.7;
export const HUNTERS_EYE_BONUS = 0.12;
export const LAST_RUSH_UNDER = 0.3;
export const LAST_RUSH_SPEED = 0.4;
export const LAST_RUSH_LASTS_S = 3;
export const LAST_RUSH_EVERY_S = 30;
export const BLOODSAP_HEAL = 0.45;
export const THORNHIDE_SHARE = 0.15;
export const CHAINSAP_EVERY = 3;
export const CHAINSAP_REACH_M = 5;
export const CHAINSAP_SHARE = 0.6;
export const OVERGROWTH_CUT = 0.4;
export const ROOTBOUND_UNDER = 0.4;
export const ROOTBOUND_S = 0.6;
export const ROOTBOUND_EVERY_S = 8;
export const THORNBURST_UNDER = 0.5;
export const THORNBURST_REACH_M = 4;
export const THORNBURST_SHARE = 0.1;
export const THORNBURST_EVERY_S = 15;

const frac = (u: Unit): number => (u.maxHp > 0 ? u.hp / u.maxHp : 0);

const SPROUTS: GraftDef[] = [
  {
    id: 'keen_edge',
    name: 'Keen Edge',
    grade: 'sprout',
    roles: ['damage', 'magic'],
    text: '+15% attack damage and ability power',
    stat: { ad: KEEN_EDGE_PCT, ap: KEEN_EDGE_PCT },
  },
  {
    id: 'quick_sap',
    name: 'Quick Sap',
    grade: 'sprout',
    roles: ['damage'],
    text: '+18% attack speed',
    stat: { attackSpeed: QUICK_SAP_PCT },
  },
  {
    id: 'deep_roots',
    name: 'Deep Roots',
    grade: 'sprout',
    roles: ['shell'],
    text: '+15% maximum health',
    stat: { hp: DEEP_ROOTS_PCT },
  },
];

const BOUGHS: GraftDef[] = [
  {
    // Read by the mode's recovery (royale/mode.ts stepRecovery): the out of
    // combat speed keeps its OUT_OF_COMBAT_S.
    id: 'second_breath',
    name: 'Second Breath',
    grade: 'bough',
    roles: ['shell'],
    text: 'Out of a fight, heal after 3 s at 6% a second',
    offerIf: (c) => (c.variant === 'respawn' ? c.phase < 5 : c.alive > SECOND_BREATH_LATE_ALIVE),
  },
  {
    id: 'stoneblood',
    name: 'Stoneblood',
    grade: 'bough',
    roles: ['shell'],
    text: 'In a fight, a 12% health shield every 12 s',
    onTick(ctx, self) {
      if (ctx.time < self.graftShieldAt || outOfCombat(self, ctx.time)) return;
      self.graftShieldAt = ctx.time + STONEBLOOD_EVERY_S;
      addStatus(self, {
        kind: 'shield',
        until: ctx.time + STONEBLOOD_LASTS_S,
        remaining: self.maxHp * STONEBLOOD_SHARE,
      });
    },
  },
  {
    id: 'hunters_eye',
    name: "Hunter's Eye",
    grade: 'bough',
    roles: ['magic'],
    text: '+12% damage to champions above 70% health',
    modifyDamage(_ctx, _self, target, amount) {
      if (target.kind !== 'champion' || frac(target) <= HUNTERS_EYE_ABOVE) return amount;
      return amount * (1 + HUNTERS_EYE_BONUS);
    },
  },
  {
    id: 'last_rush',
    name: 'Last Rush',
    grade: 'bough',
    roles: ['damage'],
    text: 'Dropping under 30% health: +40% speed for 3 s',
    onDamaged(ctx, self, _source, amount) {
      if (ctx.time < self.graftRushAt) return;
      const line = self.maxHp * LAST_RUSH_UNDER;
      if (self.hp >= line || self.hp + amount < line) return;
      self.graftRushAt = ctx.time + LAST_RUSH_EVERY_S;
      addStatus(self, {
        kind: 'buff',
        until: ctx.time + LAST_RUSH_LASTS_S,
        msPct: LAST_RUSH_SPEED,
        asPct: 0,
        armor: 0,
        mr: 0,
      });
    },
  },
  {
    // Read by the mode's takedown (royale/mode.ts onDeath, takedownHeal).
    id: 'bloodsap',
    name: 'Bloodsap',
    grade: 'bough',
    roles: ['damage'],
    text: 'A takedown heals 45% of your health, not 30%',
  },
  {
    id: 'thornhide',
    name: 'Thornhide',
    grade: 'bough',
    roles: ['shell'],
    text: 'Return 15% of attack damage taken as magic',
    onDamaged(ctx, self, source, amount, via) {
      if (via !== 'attack' || !source || source.dead || ctx.dead.has(source.id)) return;
      if (!hostile(self, source)) return;
      dealDamage(ctx, self.id, source, amount * THORNHIDE_SHARE, 'magic', 'other');
    },
  },
];

const HEARTWOODS: GraftDef[] = [
  {
    id: 'reaping_graft',
    name: 'Reaping Graft',
    grade: 'heartwood',
    roles: ['magic', 'damage'],
    text: 'A takedown resets your Q, W and E',
    color: 0xc04a6a,
    onTakedown(_ctx, self) {
      self.cooldowns.Q = 0;
      self.cooldowns.W = 0;
      self.cooldowns.E = 0;
    },
  },
  {
    id: 'chainsap',
    name: 'Chainsap',
    grade: 'heartwood',
    roles: ['damage'],
    text: 'Every 3rd attack arcs to a 2nd enemy for 60%',
    color: 0x5ad0c8,
    onAttackHit(ctx, self, target) {
      self.graftHits += 1;
      if (self.graftHits % CHAINSAP_EVERY !== 0) return;
      const reach2 = CHAINSAP_REACH_M * CHAINSAP_REACH_M;
      let best: Unit | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (const o of ctx.units.values()) {
        if (o.id === target.id || o.dead || ctx.dead.has(o.id) || !hostile(self, o)) continue;
        if (o.kind === 'tower' || o.kind === 'sanctum') continue;
        const d = dist2(o.pos, target.pos);
        if (d > reach2 || d >= bestD) continue;
        best = o;
        bestD = d;
      }
      if (best) dealDamage(ctx, self.id, best, self.stats.ad * CHAINSAP_SHARE, 'physical', 'other');
    },
  },
  {
    id: 'overgrowth',
    name: 'Overgrowth',
    grade: 'heartwood',
    roles: ['magic'],
    text: 'Your R comes back 40% sooner',
    color: 0x7ad04a,
    onCast(ctx, self, key) {
      if (key !== 'R') return;
      const ready = self.cooldowns.R ?? ctx.time;
      self.cooldowns.R = ctx.time + (ready - ctx.time) * (1 - OVERGROWTH_CUT);
    },
  },
  {
    id: 'rootbound',
    name: 'Rootbound',
    grade: 'heartwood',
    roles: ['shell'],
    text: 'Attacks root a champion under 40% health 0.6 s',
    color: 0xb08a4a,
    onAttackHit(ctx, self, target) {
      if (target.kind !== 'champion' || target.dead || ctx.dead.has(target.id)) return;
      if (frac(target) >= ROOTBOUND_UNDER) return;
      const mem = self.graftRootAt.find((m) => m[0] === target.id);
      if (mem && ctx.time < mem[1]) return;
      addStatus(target, { kind: 'root', until: ctx.time + ROOTBOUND_S });
      if (mem) mem[1] = ctx.time + ROOTBOUND_EVERY_S;
      else {
        self.graftRootAt.push([target.id, ctx.time + ROOTBOUND_EVERY_S]);
        if (self.graftRootAt.length > GRAFT_ROOT_MEMORY) self.graftRootAt.shift();
      }
    },
  },
  {
    id: 'thornburst',
    name: 'Thornburst',
    grade: 'heartwood',
    roles: ['shell'],
    text: 'Hit under 50% health: burst 10% of your health at 4 m',
    color: 0xe0703a,
    onDamaged(ctx, self, source) {
      if (!source || ctx.time < self.graftThornAt) return;
      if (frac(self) >= THORNBURST_UNDER) return;
      self.graftThornAt = ctx.time + THORNBURST_EVERY_S;
      const reach2 = THORNBURST_REACH_M * THORNBURST_REACH_M;
      const hit: Unit[] = [];
      for (const o of ctx.units.values()) {
        if (o.dead || ctx.dead.has(o.id) || !hostile(self, o)) continue;
        if (o.kind === 'tower' || o.kind === 'sanctum') continue;
        if (dist2(o.pos, self.pos) <= reach2) hit.push(o);
      }
      for (const o of hit)
        dealDamage(ctx, self.id, o, self.maxHp * THORNBURST_SHARE, 'magic', 'other');
    },
  },
];

export const GRAFT_LIST: readonly GraftDef[] = [...SPROUTS, ...BOUGHS, ...HEARTWOODS];

export const GRAFTS: Readonly<Record<string, GraftDef>> = Object.fromEntries(
  GRAFT_LIST.map((g) => [g.id, g]),
);

// The grades in order, lowest first; an offer short of cards fills from
// the grade below its own.
export const GRADE_ORDER: readonly GraftGrade[] = ['sprout', 'bough', 'heartwood'];

// What triggers an offer, and of which grade, by variant (ADR 0032).
export type GraftTrigger =
  | 'drop'
  | 'arrival'
  | 'second_cache'
  | 'golden_cache'
  | 'first_camp'
  | 'first_takedown'
  | 'third_takedown'
  | 'seedfall'
  | 'creature';

export const GRAFT_TRIGGERS: Readonly<
  Record<RoyaleVariant, Partial<Record<GraftTrigger, GraftGrade>>>
> = {
  one_life: {
    drop: 'bough',
    second_cache: 'sprout',
    first_camp: 'sprout',
    first_takedown: 'bough',
    third_takedown: 'heartwood',
    seedfall: 'heartwood',
    creature: 'heartwood',
  },
  respawn: {
    drop: 'bough',
    arrival: 'bough',
    golden_cache: 'bough',
    seedfall: 'heartwood',
    creature: 'heartwood',
  },
};

// The levels that offer a Graft, by variant.
export const GRAFT_LEVELS: Readonly<Record<RoyaleVariant, Readonly<Record<number, GraftGrade>>>> = {
  one_life: { 6: 'sprout', 9: 'sprout' },
  respawn: { 5: 'sprout', 7: 'bough', 9: 'sprout', 11: 'heartwood' },
};

// The Heartwood a champion carries, the one Graft everyone sees on it; null
// when none.
export function heartwoodOf(u: { grafts: readonly string[] }): string | null {
  for (const id of u.grafts) if (GRAFTS[id]?.grade === 'heartwood') return id;
  return null;
}

// Stacks of one Graft a champion holds.
export function graftStacks(u: { grafts: readonly string[] }, id: string): number {
  let n = 0;
  for (const g of u.grafts) if (g === id) n++;
  return n;
}

export function holdsGraft(u: { grafts: readonly string[] }, id: string): boolean {
  return u.grafts.includes(id);
}

// A Sprout's multipliers on a champion's totals (stats.ts), 1 for none.
export interface GraftShares {
  ad: number;
  ap: number;
  attackSpeed: number;
  hp: number;
}

export function graftShares(u: { grafts: readonly string[] }): GraftShares {
  const out = { ad: 1, ap: 1, attackSpeed: 1, hp: 1 };
  for (const id of u.grafts) {
    const s = GRAFTS[id]?.stat;
    if (!s) continue;
    out.ad += s.ad ?? 0;
    out.ap += s.ap ?? 0;
    out.attackSpeed += s.attackSpeed ?? 0;
    out.hp += s.hp ?? 0;
  }
  return out;
}

// The out of combat heal a champion's Grafts give it (royale/mode.ts
// stepRecovery): after how long, and how much of the maximum a second.
export function recoveryOf(
  u: { grafts: readonly string[] },
  afterS: number,
  share: number,
): { afterS: number; share: number } {
  if (!holdsGraft(u, 'second_breath')) return { afterS, share };
  return { afterS: SECOND_BREATH_AFTER_S, share: SECOND_BREATH_HEAL };
}

// A takedown's heal, before the streak's falloff (royale/mode.ts onDeath).
export function takedownHealOf(u: { grafts: readonly string[] }, share: number): number {
  return holdsGraft(u, 'bloodsap') ? BLOODSAP_HEAL : share;
}
