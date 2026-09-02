// The burst cap (CONTEXT.md, ADR 0013): what one cast may deal to a
// single target at rank 1, against a reference target fresh out of the
// fountain. The power budget prices damage per second of availability
// (budget.ts), so a nuke on a long cooldown is cheap; this is the one
// rule that looks at the size of a single hit. Pure arithmetic on the
// def: same input, same number, in every host.

import type { AbilityDef, CastSpec } from '../combat/casting';
import type { EffectSpec } from '../combat/effects';
import type { AbilityKey } from '../types';
import type { ForgedChampionDef } from './forged_def';

// The reference target and the measuring stick: the roster's lowest
// level-1 health; the attack rail, so every real champion measures under
// it; no AP, pinned at zero at level 1 for everyone (AP comes from
// items); and ticked damage counted for the two seconds a slow or a root
// pins a target, because a zone's full duration is the victim's choice.
export const BURST_REF = { hp: 540, ad: 80, ap: 0, tickWindow: 2 } as const;

// Fractions of BURST_REF.hp, just above the roster measured the same way
// (fenn's W at 48 percent, ashvyn's R at 75, fenn's three basics at 85),
// so every roster twin validates and the roster stays the definition of
// "fits" (tests/forge.test.ts).
export const BURST_CAPS = { basic: 0.5, ult: 0.75, basics: 0.9 } as const;

export const BASIC_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E'];

// The cap in health points for one spell key.
export function burstCapOf(key: AbilityKey): number {
  return BURST_REF.hp * (key === 'R' ? BURST_CAPS.ult : BURST_CAPS.basic);
}

export const BASICS_BURST_CAP = BURST_REF.hp * BURST_CAPS.basics;

function ticksIn(duration: number, tickEvery: number | undefined): number {
  // The sim's first tick lands one interval in (casting.ts), so a window
  // holds floor(window / interval) of them.
  return Math.floor(Math.min(duration, BURST_REF.tickWindow) / (tickEvery ?? 0.5));
}

function burstOfEffects(list: readonly EffectSpec[] | undefined): number {
  if (!list) return 0;
  let total = 0;
  for (const e of list) total += burstOfEffect(e);
  return total;
}

// Damage to one target from one effect. Heals, shields and crowd control
// are the budget's business, not the cap's.
function burstOfEffect(e: EffectSpec): number {
  switch (e.kind) {
    case 'damage':
      return (
        e.base +
        (e.adRatio ?? 0) * BURST_REF.ad +
        (e.apRatio ?? 0) * BURST_REF.ap +
        (e.maxHpPct ?? 0) * BURST_REF.hp
      );
    case 'dot':
      return e.perSecond * Math.min(e.duration, BURST_REF.tickWindow);
    case 'conditional':
      return Math.max(burstOfEffects(e.effects), burstOfEffects(e.otherwise));
    case 'mark':
      // The stacks may already be there: one cast can be the trigger.
      return burstOfEffects(e.onTrigger);
    case 'empower':
      // The splash lands around the victim, never on it twice.
      return burstOfEffects(e.bonus);
    case 'shield':
      return e.burst
        ? Math.max(burstOfEffects(e.burst.onBreak), burstOfEffects(e.burst.onExpire))
        : 0;
    default:
      return 0;
  }
}

// The most one target can take from one cast of this spec: every list
// the same unit can be in, ticks counted inside the two seconds; a chain
// jumps to ANOTHER enemy and is left out, an aftershock erupts along the
// line the bolt traveled and can land on the same victim.
export function burstOfSpec(spec: CastSpec): number {
  switch (spec.kind) {
    case 'skillshot':
      return burstOfEffects(spec.onHit) + burstOfEffects(spec.aftershock?.effects);
    case 'zone': {
      let total = burstOfEffects(spec.onEnter);
      total += burstOfEffects(spec.onTick) * ticksIn(spec.duration, spec.tickEvery);
      total += burstOfEffects(spec.onDetonate);
      total += burstOfEffects(spec.boundary?.effects);
      if (spec.leaveZone) {
        total +=
          burstOfEffects(spec.leaveZone.onTick) *
          ticksIn(spec.leaveZone.duration, spec.leaveZone.tickEvery);
      }
      return total;
    }
    case 'self_or_ally':
      return burstOfEffects(spec.effects);
    case 'enemy_target':
      return burstOfEffects(spec.effects);
    case 'cone':
      return burstOfEffects(spec.onHit);
    case 'burst':
      return burstOfEffects(spec.effects);
    case 'dash':
      return burstOfEffects(spec.onLand) + burstOfEffects(spec.passThrough);
    case 'wall':
      return 0;
  }
}

// The spell's burst: its base spec or any rank override, whichever hits
// hardest (an override may not smuggle a bigger nuke in at rank 3).
export function burstOfAbility(def: AbilityDef): number {
  let most = burstOfSpec(def.spec);
  for (const o of def.atRank ?? []) most = Math.max(most, burstOfSpec(o.spec));
  return most;
}

export interface BurstReport {
  abilities: Record<AbilityKey, number>;
  // The three basics together: what a level-3 all-in lands.
  basics: number;
  refHp: number;
}

export function burstOf(def: ForgedChampionDef): BurstReport {
  const abilities = {
    Q: burstOfAbility(def.abilities.Q),
    W: burstOfAbility(def.abilities.W),
    E: burstOfAbility(def.abilities.E),
    R: burstOfAbility(def.abilities.R),
  };
  return {
    abilities,
    basics: abilities.Q + abilities.W + abilities.E,
    refHp: BURST_REF.hp,
  };
}

// Whether every cap holds, per spell and for the three basics together.
export interface BurstVerdict {
  abilities: Record<AbilityKey, boolean>;
  basics: boolean;
  ok: boolean;
}

export function burstVerdict(def: ForgedChampionDef): BurstVerdict {
  const report = burstOf(def);
  const abilities = {
    Q: report.abilities.Q <= burstCapOf('Q'),
    W: report.abilities.W <= burstCapOf('W'),
    E: report.abilities.E <= burstCapOf('E'),
    R: report.abilities.R <= burstCapOf('R'),
  };
  const basics = report.basics <= BASICS_BURST_CAP;
  return {
    abilities,
    basics,
    ok: basics && abilities.Q && abilities.W && abilities.E && abilities.R,
  };
}

// Every cap over its line, as readable strings: one per spell, then the
// three basics together.
export function burstErrors(def: ForgedChampionDef): string[] {
  const report = burstOf(def);
  const errors: string[] = [];
  for (const key of ['Q', 'W', 'E', 'R'] as const) {
    const cap = burstCapOf(key);
    const hit = report.abilities[key];
    if (hit > cap) {
      const share = key === 'R' ? BURST_CAPS.ult : BURST_CAPS.basic;
      errors.push(
        `burst cap: ${key} deals ${hit.toFixed(0)} to one target at rank 1, ` +
          `${key === 'R' ? 'an ultimate' : 'a basic spell'} may deal ${cap.toFixed(0)} ` +
          `(${Math.round(100 * share)} percent of ${BURST_REF.hp} health)`,
      );
    }
  }
  if (report.basics > BASICS_BURST_CAP) {
    errors.push(
      `burst cap: Q, W and E together deal ${report.basics.toFixed(0)} to one target at ` +
        `rank 1, the three basics may deal ${BASICS_BURST_CAP.toFixed(0)} ` +
        `(${Math.round(100 * BURST_CAPS.basics)} percent of ${BURST_REF.hp} health)`,
    );
  }
  return errors;
}
