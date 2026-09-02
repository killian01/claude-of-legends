// The kit (ADR 0014): the role builds as data, the recipe walker from a bag
// to the next purchase, the three selling rules without churn, the
// variants on triggers, the skill order, the fight's stance and target,
// the validator's door, the patch operation, and a whole sparring on an
// owner build that ends on that build with nothing rotting in the bag.

import { describe, expect, it } from 'vitest';
import { sparringPicks } from '../src/game/sparring_core';
import { buildMatchSim } from '../src/net/replay';
import { dispatchAction } from '../src/sim/action_dispatch';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import { effectiveItemCost, ITEMS } from '../src/sim/content/items';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';
import { buildObservation } from '../src/sim/observe';
import {
  applyPatchOp,
  type KitDef,
  type PlaybookDef,
  playbookPolicy,
  validatePlaybook,
} from '../src/sim/playbook';
import { runBehavior } from '../src/sim/playbook/behaviors';
import {
  BAG_SLOTS,
  DAMAGE_BUILD,
  nextKitStep,
  ownsTarget,
  remainingCost,
  roleBuild,
  SELL_REFUND,
  SHELL_BUILD,
  unwantedSlots,
} from '../src/sim/playbook/kit';
import { buildSlotContext, type SlotContext } from '../src/sim/playbook/micro';
import type { Action } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { INVENTORY_SLOTS, Sim } from '../src/sim/sim';

// A bag and a bank stepped by the walker's own answers, mirroring the
// sim's buy (components consumed, combined price) and sell (seventy
// percent) rules, with an income per step so a match's worth of gold
// flows through.
function walk(
  build: readonly string[],
  bag0: readonly string[],
  gold0: number,
  income: number,
  steps: number,
): { bag: string[]; gold: number; bought: string[]; sold: string[] } {
  const bag = [...bag0];
  let gold = gold0;
  const bought: string[] = [];
  const sold: string[] = [];
  for (let i = 0; i < steps; i++) {
    const step = nextKitStep(build, bag, gold);
    if (!step) {
      gold += income;
      continue;
    }
    if (step.kind === 'buy') {
      const cost = effectiveItemCost(step.itemId, bag);
      expect(gold).toBeGreaterThanOrEqual(cost);
      const used: number[] = [];
      for (const c of ITEMS[step.itemId]?.buildsFrom ?? []) {
        const idx = bag.findIndex((b, j) => b === c && !used.includes(j));
        if (idx !== -1) used.push(idx);
      }
      expect(bag.length - used.length).toBeLessThan(BAG_SLOTS);
      for (const idx of [...used].sort((a, b) => b - a)) bag.splice(idx, 1);
      bag.push(step.itemId);
      gold -= cost;
      bought.push(step.itemId);
    } else {
      const id = bag[step.slot]!;
      gold += Math.floor((ITEMS[id]?.cost ?? 0) * SELL_REFUND);
      bag.splice(step.slot, 1);
      sold.push(id);
    }
  }
  return { bag, gold, bought, sold };
}

function ctxOf(sim: Sim, unitId: number, kit?: KitDef, patch?: Record<string, unknown>) {
  const obs = buildObservation(sim, unitId);
  if (!obs) throw new Error('no observation');
  return buildSlotContext({ ...obs, ...patch }, new Rng(1), kit);
}

describe('the role builds', () => {
  it('mirror the sim: the bag size and the refund', () => {
    expect(BAG_SLOTS).toBe(INVENTORY_SLOTS);
    const sim = new Sim(1);
    const me = sim.addChampion(0);
    me.gold = 1000;
    sim.tick();
    expect(sim.buyItem(me.id, 'iron_blade')).toBe(true);
    const before = me.gold;
    expect(sim.sellItem(me.id, 0)).toBe(true);
    expect(me.gold - before).toBe(Math.floor(350 * SELL_REFUND));
  });

  it('give every champion a build of known finished items, and the shell to nobody', () => {
    for (const c of CHAMPION_LIST) {
      const build = roleBuild(c.id);
      expect(build.length).toBeGreaterThanOrEqual(6);
      expect(new Set(build).size).toBe(build.length);
      for (const id of build) expect(ITEMS[id], id).toBeDefined();
    }
    expect(roleBuild(null)).toBe(SHELL_BUILD);
    expect(roleBuild('vesk')).toBe(DAMAGE_BUILD);
  });
});

describe('the walker', () => {
  it('buys components in recipe order, then the item at the combined price', () => {
    expect(nextKitStep(DAMAGE_BUILD, [], 0)).toBeNull();
    expect(nextKitStep(DAMAGE_BUILD, [], 350)).toEqual({ kind: 'buy', itemId: 'iron_blade' });
    expect(nextKitStep(DAMAGE_BUILD, ['iron_blade'], 350)).toEqual({
      kind: 'buy',
      itemId: 'iron_blade',
    });
    expect(nextKitStep(DAMAGE_BUILD, ['iron_blade', 'iron_blade'], 599)).toBeNull();
    expect(nextKitStep(DAMAGE_BUILD, ['iron_blade', 'iron_blade'], 600)).toEqual({
      kind: 'buy',
      itemId: 'warbrand',
    });
  });

  it('counts an item consumed into a later one as owned', () => {
    const bag = ['warbrand', 'sunder_axe', 'windrazor', 'heart_gem'];
    expect(nextKitStep(DAMAGE_BUILD, bag, 350)).toEqual({ kind: 'buy', itemId: 'iron_blade' });
    const withBlade = [...bag, 'iron_blade'];
    expect(remainingCost('doombrand', withBlade)).toBe(2900 - 1300 - 350);
    expect(nextKitStep(DAMAGE_BUILD, withBlade, 1250)).toEqual({
      kind: 'buy',
      itemId: 'doombrand',
    });
    expect(ownsTarget(['doombrand'], 'warbrand')).toBe(true);
    expect(ownsTarget(['doombrand'], 'iron_blade')).toBe(true);
    expect(ownsTarget(['doombrand'], 'sunder_axe')).toBe(false);
  });

  it('sells a leftover the build no longer wants before anything else', () => {
    // The old plan's ending: two Iron Blades rotting in a full bag. One is
    // still a Rendfang component; the other is for nothing.
    const bag = ['sunder_axe', 'windrazor', 'heart_gem', 'doombrand', 'iron_blade', 'iron_blade'];
    expect(unwantedSlots(DAMAGE_BUILD, bag)).toEqual([5]);
    // Nothing affordable that needs a slot: the walker waits...
    expect(nextKitStep(DAMAGE_BUILD, bag, 300)).toBeNull();
    // ...and sells the leftover the moment a slot is worth having.
    expect(nextKitStep(DAMAGE_BUILD, bag, 900)).toEqual({ kind: 'sell', slot: 5 });
  });

  it('replaces the cheapest item past a full bag, without churn', () => {
    const build = [
      'iron_blade',
      'guard_plate',
      'null_cloak',
      'heart_gem',
      'mind_gem',
      'swift_fang',
      'storm_staff',
    ];
    const bag = build.slice(0, 6);
    expect(unwantedSlots(build, bag)).toEqual([]);
    expect(nextKitStep(build, bag, 1300)).toBeNull();
    expect(nextKitStep(build, bag, 1400)).toEqual({ kind: 'sell', slot: 1 });
    const end = walk(build, bag, 1400, 0, 12);
    expect(end.bag).toContain('storm_staff');
    expect(end.bag).not.toContain('guard_plate');
    expect(end.sold).toEqual(['guard_plate']);
    expect(end.bought).toEqual(['spark_rod', 'storm_staff']);
  });

  it('spends a whole match of gold on the damage build and rots nothing', () => {
    const end = walk(DAMAGE_BUILD, [], 0, 400, 80);
    for (const t of DAMAGE_BUILD) expect(ownsTarget(end.bag, t), t).toBe(true);
    expect(unwantedSlots(DAMAGE_BUILD, end.bag)).toEqual([]);
    expect(end.bag.length).toBeLessThanOrEqual(BAG_SLOTS);
    // Every sale was a leftover, sold once.
    expect(new Set(end.sold).size).toBe(end.sold.length);
    for (const id of end.sold) expect(end.bought.filter((b) => b === id).length).toBeGreaterThan(1);
  });
});

describe('the kit in force', () => {
  it('is the first variant whose trigger holds, over the defaults', () => {
    const sim = new Sim(3);
    const me = sim.addChampion(0, undefined, 'vesk');
    sim.tick();
    const kit: KitDef = {
      build: ['warbrand'],
      variants: [
        { when: { kind: 'time', atLeast: 600 }, build: ['storm_staff'] },
        { when: { kind: 'always' }, skills: ['E', 'Q', 'W'] },
      ],
    };
    const early = ctxOf(sim, me.id, kit).kit();
    expect(early.build).toEqual(['warbrand']);
    expect(early.skills).toEqual(['E', 'Q', 'W']);
    expect(early.variant).toBe(1);
    const late = ctxOf(sim, me.id, kit, { time: 700 }).kit();
    expect(late.build).toEqual(['storm_staff']);
    expect(late.skills).toEqual(['Q', 'W', 'E']);
    expect(late.variant).toBe(0);
    const none = ctxOf(sim, me.id, undefined).kit();
    expect(none.build).toBe(DAMAGE_BUILD);
    expect(none.variant).toBeNull();
  });

  it('drives the skill points through the level reflex', () => {
    const def: PlaybookDef = {
      version: 2,
      plays: [{ id: 'stay', when: { kind: 'always' }, do: { kind: 'hold' } }],
      kit: { skills: ['E', 'Q', 'W'] },
    };
    const sim = new Sim(5);
    const me = sim.addChampion(0, undefined, 'vesk');
    sim.attachPolicy(me.id, playbookPolicy(def));
    for (let i = 0; i < 40; i++) sim.tick();
    const obs = buildObservation(sim, me.id);
    expect(obs?.self.abilityRanks.E).toBe(1);
    expect(obs?.self.abilityRanks.Q).toBe(0);
  });
});

describe('the fight', () => {
  function duel(
    enemyAt: number,
    enemyId = 'korrath',
  ): { sim: Sim; ctx: SlotContext; foe: number; me: number } {
    const sim = new Sim(7);
    const me = sim.addChampion(0, { x: 60, z: 60 }, 'vesk');
    const foe = sim.addChampion(1, { x: 60 + enemyAt, z: 60 }, enemyId);
    sim.tick();
    return { sim, ctx: ctxOf(sim, me.id), foe: foe.id, me: me.id };
  }
  // The same duel with the auto-attack clock set by hand.
  const clocked = (d: ReturnType<typeof duel>, patch: Record<string, unknown>): SlotContext =>
    ctxOf(d.sim, d.me, undefined, { self: { ...d.ctx.s, ...patch } });

  it('kites on a ranged champion: strikes on the clock, steps away between strikes', () => {
    // The clock allows a strike and the threat is in reach: strike, even
    // point blank.
    const close = duel(2);
    expect(runBehavior({ kind: 'fight' }, close.ctx)).toEqual({
      kind: 'attack',
      targetId: close.foe,
    });
    // The clock does not: step away from the close threat.
    const between = clocked(close, { attackReadyAt: close.ctx.obs.time + 1 });
    const step = runBehavior({ kind: 'fight' }, between) as Action;
    expect(step.kind).toBe('move');
    if (step.kind === 'move') expect(step.x).toBeLessThan(60);
    // Mid-swing, nothing interrupts it.
    const swinging = clocked(close, { attackSwingUntil: close.ctx.obs.time + 0.3 });
    expect(runBehavior({ kind: 'fight' }, swinging)).toEqual({ kind: 'noop' });
    const edge = duel(5.5);
    expect(runBehavior({ kind: 'fight' }, edge.ctx)).toEqual({
      kind: 'attack',
      targetId: edge.foe,
    });
    // The clock does not and nobody is close: hold the spot, no chase.
    const waiting = clocked(edge, { attackReadyAt: edge.ctx.obs.time + 1 });
    expect(runBehavior({ kind: 'fight' }, waiting)).toEqual({ kind: 'noop' });
    // Front walks in whatever the range.
    expect(runBehavior({ kind: 'fight', stance: 'front' }, close.ctx)).toEqual({
      kind: 'attack',
      targetId: close.foe,
    });
    // Poke without a cast ready and a threat inside range gives ground.
    expect((runBehavior({ kind: 'fight', stance: 'poke' }, edge.ctx) as Action).kind).toBe('move');
  });

  it('picks the lowest or the squishiest target by rule', () => {
    const sim = new Sim(8);
    const me = sim.addChampion(0, { x: 60, z: 60 }, 'vesk');
    const tank = sim.addChampion(1, { x: 63, z: 60 }, 'korrath');
    const carry = sim.addChampion(1, { x: 66, z: 60 }, 'ashvyn');
    tank.hp = tank.maxHp * 0.2;
    sim.tick();
    const ctx = ctxOf(sim, me.id);
    expect(runBehavior({ kind: 'fight', stance: 'front' }, ctx)).toEqual({
      kind: 'attack',
      targetId: tank.id,
    });
    expect(runBehavior({ kind: 'fight', stance: 'front', target: 'lowest' }, ctx)).toEqual({
      kind: 'attack',
      targetId: tank.id,
    });
    expect(runBehavior({ kind: 'fight', stance: 'front', target: 'squishiest' }, ctx)).toEqual({
      kind: 'attack',
      targetId: carry.id,
    });
  });
});

describe('selling', () => {
  it('is a play at the fountain and an action the sim honors', () => {
    const sim = new Sim(2);
    const me = sim.addChampion(0);
    me.gold = 1000;
    sim.tick();
    expect(sim.buyItem(me.id, 'iron_blade')).toBe(true);
    const atHome = ctxOf(sim, me.id);
    expect(runBehavior({ kind: 'sell', item: 'iron_blade' }, atHome)).toEqual({
      kind: 'sell',
      slot: 0,
    });
    expect(runBehavior({ kind: 'sell', item: 'spark_rod' }, atHome)).toBeNull();
    const away = ctxOf(sim, me.id, undefined, { self: { ...atHome.s, x: 100, z: 100 } });
    expect(runBehavior({ kind: 'sell', item: 'iron_blade' }, away)).toBeNull();
    const before = me.gold;
    expect(dispatchAction(sim, me.id, { kind: 'sell', slot: 0 })).toBe(true);
    expect(me.items).toEqual([]);
    expect(me.gold - before).toBe(Math.floor(350 * SELL_REFUND));
    expect(dispatchAction(sim, me.id, { kind: 'sell', slot: -1 })).toBe(false);
  });
});

describe('the validator and the patch', () => {
  const plays = [{ id: 'a', when: { kind: 'always' }, do: { kind: 'push' } }];
  const errorsOf = (raw: unknown): string[] => {
    const v = validatePlaybook(raw);
    return v.ok ? [] : v.errors;
  };

  it('accepts a kit and returns only known fields', () => {
    const v = validatePlaybook({
      version: 2,
      plays,
      kit: {
        build: ['warbrand', 'doombrand'],
        skills: ['E', 'Q', 'W'],
        variants: [{ when: { kind: 'time', atLeast: 600 }, build: ['storm_staff'], note: 1 }],
        stray: true,
      },
    });
    expect(v.ok && v.def.kit).toEqual({
      build: ['warbrand', 'doombrand'],
      skills: ['E', 'Q', 'W'],
      variants: [{ when: { kind: 'time', atLeast: 600 }, build: ['storm_staff'] }],
    });
    expect(validatePlaybook({ version: 1, plays }).ok).toBe(true);
    const empty = validatePlaybook({ version: 2, plays, kit: {} });
    expect(empty.ok && empty.def.kit).toBeUndefined();
  });

  it('refuses unknown items, duplicates, bad skill orders, empty variants, bad stances', () => {
    expect(errorsOf({ version: 2, plays, kit: { build: ['excalibur'] } })[0]).toMatch(
      /unknown item/,
    );
    expect(errorsOf({ version: 2, plays, kit: { build: ['warbrand', 'warbrand'] } })[0]).toMatch(
      /twice/,
    );
    expect(errorsOf({ version: 2, plays, kit: { skills: ['Q', 'Q', 'W'] } })[0]).toMatch(/skills/);
    expect(
      errorsOf({ version: 2, plays, kit: { variants: [{ when: { kind: 'always' } }] } })[0],
    ).toMatch(/needs a build or a skill order/);
    expect(
      errorsOf({
        version: 2,
        plays: [{ id: 'a', when: { kind: 'always' }, do: { kind: 'fight', stance: 'yolo' } }],
      })[0],
    ).toMatch(/stance/);
    expect(
      errorsOf({
        version: 2,
        plays: [{ id: 'a', when: { kind: 'always' }, do: { kind: 'sell', item: 'excalibur' } }],
      })[0],
    ).toMatch(/sell/);
  });

  it('changes parts of the kit, clears them with null, and keeps the kit through play edits', () => {
    const base: PlaybookDef = { version: 1, plays: [...LANER_PLAYBOOK.plays] };
    const withBuild = applyPatchOp(base, { op: 'kit', kit: { build: ['warbrand'] } });
    expect(withBuild.ok && withBuild.def.kit).toEqual({ build: ['warbrand'] });
    expect(withBuild.ok && withBuild.def.version).toBe(2);
    if (!withBuild.ok) throw new Error(withBuild.error);
    const added = applyPatchOp(withBuild.def, {
      op: 'add',
      play: { id: 'zz', when: { kind: 'always' }, do: { kind: 'hold' } },
    });
    expect(added.ok && added.def.kit).toEqual({ build: ['warbrand'] });
    const withSkills = applyPatchOp(withBuild.def, { op: 'kit', kit: { skills: ['W', 'Q', 'E'] } });
    expect(withSkills.ok && withSkills.def.kit).toEqual({
      build: ['warbrand'],
      skills: ['W', 'Q', 'E'],
    });
    if (!withSkills.ok) throw new Error(withSkills.error);
    const cleared = applyPatchOp(withSkills.def, { op: 'kit', kit: { build: null } });
    expect(cleared.ok && cleared.def.kit).toEqual({ skills: ['W', 'Q', 'E'] });
    const bad = applyPatchOp(base, { op: 'kit', kit: { build: ['excalibur'] } });
    expect(bad.ok).toBe(false);
  });
});

describe('a sparring on an owner build', () => {
  it('ends on that build, nothing rotting in the bag', () => {
    const build = [
      'warbrand',
      'sunder_axe',
      'windrazor',
      'doombrand',
      'skyshear',
      'rendfang',
      'colossus_heart',
    ];
    const picks = sparringPicks({
      name: 'Nightfall',
      championId: 'vesk',
      sigils: ['riftstep', 'mend'],
      skin: 0,
      playbook: { ...LANER_PLAYBOOK, kit: { build } },
    });
    const { sim, unitIds } = buildMatchSim(11, picks, []);
    const me = sim.units.get(unitIds[0]!)!;
    while (sim.winner === null && sim.tickCount < 20 * 60 * 25) sim.tick();
    for (const id of me.items) {
      expect(
        build.some((t) => t === id || ownsTarget([t], id) || ownsTarget([id], t)),
        `${id} in ${me.items.join(',')}`,
      ).toBe(true);
    }
    expect(unwantedSlots(build, me.items)).toEqual([]);
    expect(me.items.length).toBeGreaterThanOrEqual(3);
  }, 120_000);
});
