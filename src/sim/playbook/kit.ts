// The kit resolved and walked (docs/design/bots.md, ADR 0014): which build
// and skill order are in force this slot, and the next step toward the
// build from the bag in hand, the gold in the bank and the shop's recipes.
// One generic recipe walker for owner builds and the role defaults alike;
// pure over data, reading only the item catalog and the champion roles.

import { CHAMPIONS, type ChampionRole } from '../content/champions';
import { effectiveItemCost, ITEMS } from '../content/items';
import type { SlotContext } from './micro';
import { holds } from './triggers';
import type { KitDef, SkillKey } from './types';

// The bag and the sell rule, mirrors of the sim's (INVENTORY_SLOTS and
// sellItem in sim.ts; tests/kit.test.ts pins both).
export const BAG_SLOTS = 6;
export const SELL_REFUND = 0.7;
export const DEFAULT_SKILLS: readonly SkillKey[] = ['Q', 'W', 'E'];
export const MAX_BUILD = 12;

// The builds the engine shipped with, as lists: the three hand-written
// plans of the scripted Laner (damage, magic, the defensive shell), long
// enough that a fed bot keeps spending. A kit that names no build gets the
// one for its champion's role.
export const DAMAGE_BUILD: readonly string[] = [
  'warbrand',
  'sunder_axe',
  'windrazor',
  'heart_gem',
  'doombrand',
  'skyshear',
  'rendfang',
  'colossus_heart',
  'swift_treads',
];
export const MAGIC_BUILD: readonly string[] = [
  'storm_staff',
  'void_crystal',
  'archmind',
  'heart_gem',
  'tempest_core',
  'null_engine',
  'colossus_heart',
  'spirit_ward',
  'swift_treads',
];
export const SHELL_BUILD: readonly string[] = [
  'colossus_heart',
  'stone_bulwark',
  'spirit_ward',
  'worldheart',
  'titan_cleaver',
  'swiftplate',
  'swift_treads',
];

const BUILD_BY_ROLE: Readonly<Record<ChampionRole, readonly string[]>> = {
  Marksman: DAMAGE_BUILD,
  Assassin: DAMAGE_BUILD,
  Skirmisher: DAMAGE_BUILD,
  Mage: MAGIC_BUILD,
  Battlemage: MAGIC_BUILD,
  Tank: SHELL_BUILD,
  Fighter: SHELL_BUILD,
  Support: SHELL_BUILD,
};

export function roleBuild(championId: string | null): readonly string[] {
  const role = championId ? CHAMPIONS[championId]?.role : undefined;
  return role ? BUILD_BY_ROLE[role] : SHELL_BUILD;
}

// The kit in force: the first variant whose trigger holds, over the
// defaults, over the engine's own (the role build, Q then W then E).
export interface ActiveKit {
  build: readonly string[];
  skills: readonly SkillKey[];
  // Index of the variant in force, null when the defaults are.
  variant: number | null;
}

export function resolveKit(
  kit: KitDef | undefined,
  championId: string | null,
  ctx: SlotContext,
): ActiveKit {
  let build = kit?.build;
  let skills = kit?.skills;
  let variant: number | null = null;
  const variants = kit?.variants ?? [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!;
    if (!holds(v.when, ctx)) continue;
    if (v.build) build = v.build;
    if (v.skills) skills = v.skills;
    variant = i;
    break;
  }
  return {
    build: build && build.length > 0 ? build : roleBuild(championId),
    skills: skills && skills.length === 3 ? skills : DEFAULT_SKILLS,
    variant,
  };
}

// --- the walker ------------------------------------------------------------

// Everything an item is made of, itself included, as a multiset: a
// Colossus Heart is one Colossus Heart and two Heart Gems.
function closure(id: string, into: Map<string, number> = new Map()): Map<string, number> {
  into.set(id, (into.get(id) ?? 0) + 1);
  for (const c of ITEMS[id]?.buildsFrom ?? []) closure(c, into);
  return into;
}

// A target counts as owned when the bag holds it or an item built from it:
// the Warbrand that became a Doombrand is still on the bot.
export function ownsTarget(bag: readonly string[], target: string): boolean {
  return bag.some((b) => b === target || closure(b).has(target));
}

// The next thing to buy toward `target`: the target itself when every
// component it can consume is in the bag (or it has none), else the first
// missing component, recursively; `direct` buys the target outright,
// consuming whatever components are there (the sim allows it at the
// combined price). `consumes` counts the bag items the purchase uses up.
function stepToward(
  target: string,
  bag: readonly string[],
  direct: boolean,
): { id: string; consumes: number } {
  const used: number[] = [];
  for (const c of ITEMS[target]?.buildsFrom ?? []) {
    const idx = bag.findIndex((b, i) => b === c && !used.includes(i));
    if (idx !== -1) {
      used.push(idx);
      continue;
    }
    if (!direct) return stepToward(c, bag, false);
  }
  return { id: target, consumes: used.length };
}

// The gold still needed to finish `target` from the bag: its price less
// the components already held, recursively (a tier 2 item's price is the
// combined price of its parts, so the two roads cost the same).
export function remainingCost(target: string, bag: readonly string[]): number {
  const held: number[] = [];
  const owned = (id: string): number => {
    let value = 0;
    for (const c of ITEMS[id]?.buildsFrom ?? []) {
      const idx = bag.findIndex((b, i) => b === c && !held.includes(i));
      if (idx !== -1) {
        held.push(idx);
        value += ITEMS[c]?.cost ?? 0;
      } else value += owned(c);
    }
    return value;
  };
  return Math.max(0, (ITEMS[target]?.cost ?? 0) - owned(target));
}

// The bag slots the build has no use for: neither a target (or something
// built from one) nor a component still needed by an unfinished target,
// copies beyond the count needed included. Sold first when the bag is
// full (the two Iron Blades that rotted in the old plan).
export function unwantedSlots(build: readonly string[], bag: readonly string[]): number[] {
  // What the unfinished targets still need: each missing component with
  // everything it is made of (a held component is consumed, its own parts
  // are not needed twice).
  const need = new Map<string, number>();
  const held: number[] = [];
  for (const t of build) {
    if (ownsTarget(bag, t)) continue;
    for (const c of ITEMS[t]?.buildsFrom ?? []) {
      const idx = bag.findIndex((b, i) => b === c && !held.includes(i));
      if (idx !== -1) {
        held.push(idx);
        continue;
      }
      for (const [id, n] of closure(c)) need.set(id, (need.get(id) ?? 0) + n);
    }
  }
  const out: number[] = [];
  bag.forEach((b, i) => {
    // A component an unfinished target will consume is spoken for.
    if (held.includes(i)) return;
    const bClosure = closure(b);
    if (build.some((t) => bClosure.has(t))) return;
    const n = need.get(b) ?? 0;
    if (n > 0) {
      need.set(b, n - 1);
      return;
    }
    out.push(i);
  });
  return out;
}

export type KitStep = { kind: 'buy'; itemId: string } | { kind: 'sell'; slot: number };

function cheapestSlot(bag: readonly string[], among: readonly number[]): number {
  let best = among[0]!;
  for (const i of among) {
    if ((ITEMS[bag[i]!]?.cost ?? 0) < (ITEMS[bag[best]!]?.cost ?? 0)) best = i;
  }
  return best;
}

// The next step of the build from this bag and bank, or null when there is
// nothing to do yet (saving for the next item is a null: the bot never
// buys a filler it did not ask for). Targets are pursued in order, with
// two exceptions that keep the bag from churning: on the last free slot,
// or with none, the costliest target affordable right now goes first, so a
// big item never waits behind a cheap one and a sale is never undone by
// rebuying what was sold; and with the bag full, finished items are bought
// outright rather than component by component.
export function nextKitStep(
  build: readonly string[],
  bag: readonly string[],
  gold: number,
): KitStep | null {
  const unsat = build.filter((t) => ITEMS[t] !== undefined && !ownsTarget(bag, t));
  if (unsat.length === 0) return null;
  const free = BAG_SLOTS - bag.length;
  let target = unsat[0]!;
  if (free <= 1) {
    let best: string | null = null;
    for (const t of unsat) {
      if (remainingCost(t, bag) > gold) continue;
      if (best === null || (ITEMS[t]?.cost ?? 0) > (ITEMS[best]?.cost ?? 0)) best = t;
    }
    if (best !== null) target = best;
  }
  const step = stepToward(target, bag, free <= 0);
  const needsSlot = step.consumes === 0;
  if (!needsSlot || free > 0) {
    return gold >= effectiveItemCost(step.id, bag) ? { kind: 'buy', itemId: step.id } : null;
  }
  // The bag is full and the purchase needs a slot.
  const unwanted = unwantedSlots(build, bag);
  if (unwanted.length > 0) return { kind: 'sell', slot: cheapestSlot(bag, unwanted) };
  const cheapest = cheapestSlot(
    bag,
    bag.map((_, i) => i),
  );
  const cheapestCost = ITEMS[bag[cheapest]!]?.cost ?? 0;
  if (
    (ITEMS[target]?.cost ?? 0) > cheapestCost &&
    gold + Math.floor(cheapestCost * SELL_REFUND) >= remainingCost(target, bag)
  ) {
    return { kind: 'sell', slot: cheapest };
  }
  return null;
}
