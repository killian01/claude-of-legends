// The Grafts (CONTEXT.md: Graft; ADR 0032; src/sim/royale/grafts.ts and
// src/sim/content/grafts.ts): the draw (the same seed, the same cards; the
// role's weight; the offer rules; the grade's fill and the piece), the
// queue (three deep, the lowest grade dropped, the next head's clock), the
// pick and its deadline (card 0 at the deadline, the drop's three seconds
// after the landing, while dead, the elimination), the triggers, every
// Graft's effect, the bot's pick, and a match with picks replayed to the
// same checksum trail.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import type { RoyalePerson } from '../server/royale_seats';
import { applyReplayEvent, buildRoyaleSim, loadRoyaleReplay } from '../src/net/replay';
import { dealDamage } from '../src/sim/combat/damage';
import {
  BLOODSAP_HEAL,
  GRAFT_LIST,
  GRAFTS,
  type GraftOfferCtx,
  graftRoleOf,
  graftShares,
  heartwoodOf,
  LAST_RUSH_EVERY_S,
  OVERGROWTH_CUT,
  ROOTBOUND_EVERY_S,
  STONEBLOOD_EVERY_S,
  STONEBLOOD_SHARE,
  THORNBURST_EVERY_S,
} from '../src/sim/content/grafts';
import { outOfCombat } from '../src/sim/favors';
import type { Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import {
  applyItemDamageModifiers,
  runGraftCast,
  runGraftTakedown,
  runItemAttackHits,
} from '../src/sim/passives';
import type { Observation } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { graftPick } from '../src/sim/royale/bot/graft_pick';
import {
  drawCards,
  offerGraft,
  offerOnLevels,
  offerOnTrigger,
  pickGraft,
  trimQueue,
} from '../src/sim/royale/grafts';
import { along, randomHeading } from '../src/sim/royale/layout';
import { streakShare } from '../src/sim/royale/loot';
import {
  DROP_S,
  type GraftOffer,
  OUT_OF_COMBAT_HEAL,
  RESPAWN_S,
  TAKEDOWN_HEAL,
} from '../src/sim/royale/types';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { levelTo, recalcChampion } from '../src/sim/stats';
import { DT } from '../src/sim/types';
import { landed, picks } from './royale_contract_fixture';
import { loadPlanet } from './royale_planet';

const CTX: GraftOfferCtx = { variant: 'one_life', phase: 0, alive: 50 };

function ctxOf(sim: Sim): CombatCtx {
  return (sim as unknown as { ctx(): CombatCtx }).ctx();
}

function offer(grade: GraftOffer['grade'], at: number, cards = ['a', 'b', 'c']): GraftOffer {
  return { grade, cards, offeredAt: at };
}

// Two champions on the plane, a few meters apart (the hooks run wherever a
// champion holds a Graft).
function duo(a = 'vesk', b = 'elowen') {
  const sim = new Sim(5);
  const u = sim.addChampion(0, { x: 75, z: 75 }, a);
  const v = sim.addChampion(1, { x: 77, z: 75 }, b);
  return { sim, u, v, ctx: ctxOf(sim) };
}

describe('the draw', () => {
  it('draws the same three cards from the same seed', () => {
    const a = drawCards(new Rng(7), 'dain', 'bough', [], [], CTX);
    const b = drawCards(new Rng(7), 'dain', 'bough', [], [], CTX);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    for (const id of a) expect(GRAFTS[id]!.grade).toBe('bough');
    const x = landed('one_life');
    const y = landed('one_life');
    expect(y.sim.royale!.offers).toEqual(x.sim.royale!.offers);
  });

  it('weighs the cards of the champion role twice, within 2% over 10,000 draws', () => {
    // A marksman walks the damage line: Last Rush and Bloodsap weigh 2.
    expect(graftRoleOf('vesk')).toBe('damage');
    const rng = new Rng(3);
    const seen = new Map<string, number>();
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      const first = drawCards(rng, 'vesk', 'bough', [], [], CTX)[0]!;
      seen.set(first, (seen.get(first) ?? 0) + 1);
    }
    const boughs = GRAFT_LIST.filter((g) => g.grade === 'bough');
    const total = boughs.reduce((s, g) => s + (g.roles.includes('damage') ? 2 : 1), 0);
    for (const g of boughs) {
      const expected = (g.roles.includes('damage') ? 2 : 1) / total;
      expect(Math.abs((seen.get(g.id) ?? 0) / n - expected)).toBeLessThan(0.02);
    }
  });

  it('never offers Second Breath in Respawn last light or with five left in One life', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 300; i++) {
      expect(
        drawCards(rng, 'dain', 'bough', [], [], { ...CTX, variant: 'respawn', phase: 5 }),
      ).not.toContain('second_breath');
      expect(drawCards(rng, 'dain', 'bough', [], [], { ...CTX, alive: 5 })).not.toContain(
        'second_breath',
      );
    }
    let offered = 0;
    for (let i = 0; i < 300; i++) {
      if (drawCards(rng, 'dain', 'bough', [], [], { ...CTX, alive: 6 }).includes('second_breath')) {
        offered++;
      }
    }
    expect(offered).toBeGreaterThan(0);
  });

  it('leaves out what is held or queued, a Sprout at two stacks', () => {
    const rng = new Rng(2);
    const queued = [offer('bough', 1, ['stoneblood', 'thornhide', 'bloodsap'])];
    for (let i = 0; i < 200; i++) {
      const cards = drawCards(rng, 'dain', 'bough', ['hunters_eye'], queued, CTX);
      for (const id of ['hunters_eye', 'stoneblood', 'thornhide', 'bloodsap']) {
        expect(cards).not.toContain(id);
      }
      const sprouts = drawCards(rng, 'dain', 'sprout', ['keen_edge', 'keen_edge'], [], CTX);
      expect(sprouts).not.toContain('keen_edge');
    }
  });

  it('fills a short grade from the grade below', () => {
    const held = ['reaping_graft', 'chainsap', 'overgrowth'];
    const cards = drawCards(new Rng(4), 'dain', 'heartwood', held, [], CTX);
    expect(cards).toHaveLength(3);
    expect(cards.filter((id) => GRAFTS[id]!.grade === 'heartwood').sort()).toEqual([
      'rootbound',
      'thornburst',
    ]);
    expect(GRAFTS[cards[2]!]!.grade).toBe('bough');
  });

  it('pays one piece instead when the draw comes short of three', () => {
    const { sim, unitIds } = landed('one_life');
    const u = sim.units.get(unitIds[0]!)!;
    const all = GRAFT_LIST.flatMap((g) => (g.grade === 'sprout' ? [g.id, g.id] : [g.id]));
    sim.royale!.grafts.set(u.id, all.slice(1));
    sim.royale!.offers.delete(u.id);
    const items = u.items.length;
    expect(offerGraft(sim.royaleMode!, sim, u.id, 'sprout')).toBe(false);
    expect(u.items.length).toBe(items + 1);
    expect(sim.royale!.offers.has(u.id)).toBe(false);
  });
});

describe('the queue', () => {
  it('holds three, dropping the lowest grade among the waiting, the newest of equals', () => {
    const q = [offer('sprout', 1), offer('heartwood', 2), offer('sprout', 3), offer('bough', 4)];
    trimQueue(q);
    // The open head stays, whatever its grade.
    expect(q.map((o) => o.offeredAt)).toEqual([1, 2, 4]);
    const r = [offer('bough', 1), offer('bough', 2), offer('heartwood', 3), offer('bough', 4)];
    trimQueue(r);
    expect(r.map((o) => o.offeredAt)).toEqual([1, 2, 3]);
  });

  it('opens the next offer once the open one is picked', () => {
    const { sim, unitIds } = landed('respawn');
    const mode = sim.royaleMode!;
    const id = unitIds[0]!;
    expect(offerGraft(mode, sim, id, 'sprout')).toBe(true);
    const queue = sim.royale!.offers.get(id)!;
    expect(queue).toHaveLength(2);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(queue).toHaveLength(2);
    expect(sim.pickGraft(id, 1)).toBe(true);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.grade).toBe('sprout');
  });
});

describe('the pick', () => {
  it('opens the drop offer the tick after the landing pick, and keeps it open after the landing', () => {
    const { sim, unitIds } = buildRoyaleSim(loadPlanet(), 4, picks(4), 'one_life');
    sim.tick();
    expect(sim.pickDrop(unitIds[0]!, { x: 0, y: 80, z: 0 })).toBe(true);
    expect(sim.royale!.offers.has(unitIds[0]!)).toBe(false);
    sim.tick();
    const head = sim.royale!.offers.get(unitIds[0]!)![0]!;
    expect(head.grade).toBe('bough');
    expect(sim.royale!.offers.has(unitIds[1]!)).toBe(false);
    // The rest get theirs as the drop ends, and all stay open after it.
    while (sim.royale!.stage === 'drop') sim.tick();
    for (let i = 0; i < 200; i++) sim.tick();
    for (const id of unitIds) expect(sim.royale!.offers.get(id)![0]).toBeDefined();
    // A pick during the drop is taken.
    const fresh = buildRoyaleSim(loadPlanet(), 4, picks(4), 'one_life');
    fresh.sim.pickDrop(fresh.unitIds[0]!, { x: 0, y: 80, z: 0 });
    fresh.sim.tick();
    const card = fresh.sim.royale!.offers.get(fresh.unitIds[0]!)![0]!.cards[1]!;
    expect(fresh.sim.pickGraft(fresh.unitIds[0]!, 1)).toBe(true);
    expect(fresh.sim.units.get(fresh.unitIds[0]!)!.grafts).toEqual([card]);
  });

  it('never takes a card for the seat: the offer waits for its pick', () => {
    // The maintainer (2026-10-04): time to read the cards, no time limit.
    const { sim, unitIds } = landed('one_life');
    const id = unitIds[2]!;
    const head = sim.royale!.offers.get(id)![0]!;
    for (let i = 0; i < 20 * 60; i++) sim.tick();
    expect(sim.units.get(id)!.grafts).toEqual([]);
    expect(sim.royale!.offers.get(id)![0]).toBe(head);
    expect(sim.pickGraft(id, 2)).toBe(true);
    expect(sim.units.get(id)!.grafts).toEqual([head.cards[2]]);
    expect(sim.royale!.grafts.get(id)).toEqual([head.cards[2]]);
    expect(sim.royale!.offers.has(id)).toBe(false);
  });

  it('ignores a pick with no open offer or out of range', () => {
    const { sim, unitIds } = landed('respawn');
    const id = unitIds[0]!;
    const mode = sim.royaleMode!;
    expect(pickGraft(mode, sim, id, 3)).toBe(false);
    expect(pickGraft(mode, sim, id, -1)).toBe(false);
    expect(pickGraft(mode, sim, id, 1.5)).toBe(false);
    expect(pickGraft(mode, sim, id, 0)).toBe(true);
    expect(pickGraft(mode, sim, id, 0)).toBe(false);
    expect(sim.units.get(id)!.grafts).toHaveLength(1);
  });

  it('takes a pick while dead in Respawn, the dead staying at no health', () => {
    const { sim, unitIds } = landed('respawn');
    const u = sim.units.get(unitIds[0]!)!;
    sim.royale!.offers.get(u.id)![0]!.cards[0] = 'deep_roots';
    u.dead = true;
    u.hp = 0;
    expect(sim.royaleMode!.wantsDeadDecision(u, sim.time + 1)).toBe(true);
    expect(sim.pickGraft(u.id, 0)).toBe(true);
    expect(u.grafts).toEqual(['deep_roots']);
    expect(u.hp).toBe(0);
  });

  it('clears the queue of a seat out of One life', () => {
    const { sim, unitIds } = landed('one_life');
    const u = sim.units.get(unitIds[3]!)!;
    expect(sim.royale!.offers.has(u.id)).toBe(true);
    dealDamage(ctxOf(sim), unitIds[0]!, u, u.hp * 10, 'true', 'ability');
    sim.tick();
    expect(sim.royale!.eliminated).toContain(u.id);
    expect(sim.royale!.offers.has(u.id)).toBe(false);
    expect(offerGraft(sim.royaleMode!, sim, u.id, 'bough')).toBe(false);
  });
});

describe('the triggers', () => {
  it('offers One life a Bough on the first takedown and a Heartwood on the third', () => {
    const { sim, unitIds } = landed('one_life');
    const killer = sim.units.get(unitIds[0]!)!;
    const mode = sim.royaleMode!;
    sim.royale!.offers.clear();
    const grades = (): string[] => (sim.royale!.offers.get(killer.id) ?? []).map((o) => o.grade);
    for (const [i, victimId] of unitIds.slice(1).entries()) {
      const v = sim.units.get(victimId)!;
      mode.onDeath(sim, v, killer.id, false);
      if (i === 0) expect(grades()).toContain('bough');
      if (i === 1) expect(grades().filter((g) => g === 'heartwood')).toHaveLength(0);
    }
    expect(grades()).toContain('heartwood');
  });

  it('offers Respawn a Bough for a golden cache, which then pays one piece', () => {
    const { sim, unitIds } = landed('respawn');
    sim.royale!.offers.clear();
    const u = sim.units.get(unitIds[1]!)!;
    const cache = sim.royale!.caches.find((c) => c.kind === 'golden' && c.present)!;
    expect(cache).toBeDefined();
    u.pos = { ...cache.pos };
    u.path = [];
    const items = u.items.length;
    for (let i = 0; i < 60 && cache.present; i++) sim.tick();
    expect(cache.present).toBe(false);
    expect(u.items.length).toBe(items + 1);
    expect(sim.royale!.offers.get(u.id)![0]!.grade).toBe('bough');
  });

  it('offers the levels of the variant, the creature hook a Heartwood', () => {
    const { sim, unitIds } = landed('respawn');
    sim.royale!.offers.clear();
    const u = sim.units.get(unitIds[0]!)!;
    const mode = sim.royaleMode!;
    // Risen from 3 to 7: past levels 5 and 7.
    levelTo(u, 7);
    offerOnLevels(mode, sim, u, 3);
    expect(sim.royale!.offers.get(u.id)!.map((o) => o.grade)).toEqual(['sprout', 'bough']);
    expect(offerOnTrigger(mode, sim, u.id, 'creature')).toBe(true);
    expect(sim.royale!.offers.get(u.id)!.map((o) => o.grade)).toEqual([
      'sprout',
      'bough',
      'heartwood',
    ]);
  });
});

describe('the Grafts at work', () => {
  it('leaves recalcChampion as it was with no Graft', () => {
    const { u } = duo('dain');
    levelTo(u, 7);
    const before = structuredClone({ stats: u.stats, maxHp: u.maxHp, hp: u.hp });
    recalcChampion(u);
    expect({ stats: u.stats, maxHp: u.maxHp, hp: u.hp }).toEqual(before);
    u.grafts = ['keen_edge'];
    recalcChampion(u);
    u.grafts = [];
    recalcChampion(u);
    expect({ stats: u.stats, maxHp: u.maxHp }).toEqual({
      stats: before.stats,
      maxHp: before.maxHp,
    });
  });

  it('raises the totals by each Sprout stack', () => {
    const { u } = duo('dain');
    const ad = u.stats.ad;
    const as = u.stats.attackSpeed;
    const hp = u.maxHp;
    u.grafts = ['keen_edge', 'keen_edge', 'quick_sap', 'deep_roots'];
    const shares = graftShares(u);
    expect(shares.ad).toBeCloseTo(1.3, 12);
    expect(shares.ap).toBeCloseTo(1.3, 12);
    expect(shares.attackSpeed).toBeCloseTo(1.18, 12);
    expect(shares.hp).toBeCloseTo(1.15, 12);
    recalcChampion(u);
    expect(u.stats.ad).toBeCloseTo(ad * 1.3, 9);
    expect(u.stats.attackSpeed).toBeCloseTo(as * 1.18, 9);
    expect(u.maxHp).toBeCloseTo(hp * 1.15, 9);
  });

  it('Second Breath heals out of a fight after 3 s at 6% a second, the speed still at 5 s', () => {
    const { sim, unitIds } = landed('respawn');
    const a = sim.units.get(unitIds[0]!)!;
    const b = sim.units.get(unitIds[1]!)!;
    a.grafts = ['second_breath'];
    for (const u of [a, b]) {
      u.hp = u.maxHp * 0.5;
      u.lastDamagedAt = sim.time - 3.2;
      u.lastDealtDamageAt = -999;
    }
    const mode = sim.royaleMode!;
    const ctx = ctxOf(sim);
    mode.stepRecovery(ctx);
    expect(a.hp - a.maxHp * 0.5).toBeCloseTo(a.maxHp * 0.06 * DT, 6);
    expect(b.hp).toBe(b.maxHp * 0.5);
    b.lastDamagedAt = sim.time - 5.2;
    mode.stepRecovery(ctx);
    expect(b.hp - b.maxHp * 0.5).toBeCloseTo(b.maxHp * OUT_OF_COMBAT_HEAL * DT, 6);
    expect(outOfCombat(a, sim.time)).toBe(false);
  });

  it('Stoneblood shields in a fight, once every 12 s', () => {
    const { sim, u, ctx } = duo('dain');
    u.grafts = ['stoneblood'];
    const g = GRAFTS.stoneblood!;
    g.onTick!(ctx, u);
    expect(u.statuses.some((s) => s.kind === 'shield')).toBe(false);
    u.lastDamagedAt = sim.time;
    g.onTick!(ctx, u);
    const shield = u.statuses.find((s) => s.kind === 'shield');
    expect(shield && shield.kind === 'shield' ? shield.remaining : 0).toBeCloseTo(
      u.maxHp * STONEBLOOD_SHARE,
      9,
    );
    expect(u.graftShieldAt).toBe(sim.time + STONEBLOOD_EVERY_S);
    u.statuses = [];
    g.onTick!(ctx, u);
    expect(u.statuses).toEqual([]);
  });

  it("Hunter's Eye adds 12% on champions above 70% health only", () => {
    const { u, v, ctx } = duo();
    u.grafts = ['hunters_eye'];
    v.hp = v.maxHp;
    expect(applyItemDamageModifiers(ctx, u, v, 100, 'physical', 'attack')).toBeCloseTo(112, 9);
    v.hp = v.maxHp * 0.7;
    expect(applyItemDamageModifiers(ctx, u, v, 100, 'physical', 'attack')).toBe(100);
  });

  it('Last Rush hastens on dropping under 30%, once per 30 s', () => {
    const { sim, u, v, ctx } = duo();
    u.grafts = ['last_rush'];
    u.hp = u.maxHp * 0.32;
    dealDamage(ctx, v.id, u, u.maxHp * 0.05, 'true', 'attack');
    const rush = u.statuses.find((s) => s.kind === 'buff');
    expect(rush && rush.kind === 'buff' ? rush.msPct : 0).toBe(0.4);
    expect(u.graftRushAt).toBe(sim.time + LAST_RUSH_EVERY_S);
    u.statuses = [];
    u.hp = u.maxHp * 0.32;
    dealDamage(ctx, v.id, u, u.maxHp * 0.05, 'true', 'attack');
    expect(u.statuses).toEqual([]);
  });

  it('Bloodsap heals 45% for a takedown, the streak still falling off', () => {
    const { sim, unitIds } = landed('respawn');
    const a = sim.units.get(unitIds[0]!)!;
    const b = sim.units.get(unitIds[1]!)!;
    const c = sim.units.get(unitIds[2]!)!;
    a.grafts = ['bloodsap'];
    a.killStreak = 2;
    c.killStreak = 2;
    a.hp = 1;
    c.hp = 1;
    // A level risen on the takedown adds its own health: counted apart.
    const aMax = a.maxHp;
    const cMax = c.maxHp;
    sim.royaleMode!.onDeath(sim, b, a.id, false);
    expect(a.hp - 1 - (a.maxHp - aMax)).toBeCloseTo(a.maxHp * BLOODSAP_HEAL * streakShare(2), 6);
    sim.royaleMode!.onDeath(sim, b, c.id, false);
    expect(c.hp - 1 - (c.maxHp - cMax)).toBeCloseTo(c.maxHp * TAKEDOWN_HEAL * streakShare(2), 6);
  });

  it('Thornhide returns 15% of attack damage as magic, not of a spell', () => {
    const { u, v, ctx } = duo('dain', 'vesk');
    u.grafts = ['thornhide'];
    const hp = v.hp;
    dealDamage(ctx, v.id, u, 100, 'true', 'ability');
    expect(v.hp).toBe(hp);
    dealDamage(ctx, v.id, u, 100, 'true', 'attack');
    const back = ctx.events.find((e) => e.type === 'damage' && e.sourceId === u.id);
    expect(back && back.type === 'damage' ? back.dtype : null).toBe('magic');
    expect(v.hp).toBeLessThan(hp);
    expect(hp - v.hp).toBeLessThanOrEqual(15 + 1e-9);
  });

  it('Reaping Graft resets Q, W and E on a takedown, never R', () => {
    const { sim, u, v, ctx } = duo();
    u.grafts = ['reaping_graft'];
    u.cooldowns = { Q: sim.time + 5, W: sim.time + 5, E: sim.time + 5, R: sim.time + 50 };
    runGraftTakedown(ctx, u, v);
    expect(u.cooldowns).toEqual({ Q: 0, W: 0, E: 0, R: sim.time + 50 });
  });

  it('Chainsap arcs every 3rd attack to the nearest other enemy within 5 m', () => {
    const { sim, u, v, ctx } = duo();
    const w = sim.addChampion(1, { x: 80, z: 75 }, 'dain');
    const far = sim.addChampion(1, { x: 90, z: 75 }, 'dain');
    u.grafts = ['chainsap'];
    const hw = w.hp;
    runItemAttackHits(ctx, u, v);
    runItemAttackHits(ctx, u, v);
    expect(w.hp).toBe(hw);
    runItemAttackHits(ctx, u, v);
    expect(w.hp).toBeLessThan(hw);
    expect(far.hp).toBe(far.maxHp);
    const once = hw - w.hp;
    runItemAttackHits(ctx, u, v);
    expect(hw - w.hp).toBe(once);
  });

  it('Overgrowth cuts the R cooldown by 40%, through the cast', () => {
    const { sim, u, ctx } = duo('korrath');
    u.grafts = ['overgrowth'];
    u.cooldowns.R = sim.time + 100;
    runGraftCast(ctx, u, 'Q');
    expect(u.cooldowns.R).toBe(sim.time + 100);
    runGraftCast(ctx, u, 'R');
    expect(u.cooldowns.R).toBeCloseTo(sim.time + 100 * (1 - OVERGROWTH_CUT), 9);
    // Through the cast itself, for a champion whose R lands on a point.
    for (const id of ['korrath', 'dain', 'sylra', 'elowen', 'maera', 'torv']) {
      const t = duo(id);
      levelTo(t.u, 6);
      t.u.mana = t.u.maxMana;
      t.u.grafts = ['overgrowth'];
      const aim = { x: t.v.pos.x, z: t.v.pos.z };
      if (!t.sim.castAbility(t.u.id, 'R', aim)) continue;
      const plain = duo(id);
      levelTo(plain.u, 6);
      plain.u.mana = plain.u.maxMana;
      expect(plain.sim.castAbility(plain.u.id, 'R', aim)).toBe(true);
      const cut = (t.u.cooldowns.R ?? 0) - t.sim.time;
      const full = (plain.u.cooldowns.R ?? 0) - plain.sim.time;
      expect(cut).toBeCloseTo(full * (1 - OVERGROWTH_CUT), 6);
      return;
    }
    throw new Error('no champion cast its R');
  });

  it('Rootbound roots a champion under 40% for 0.6 s, once per target every 8 s', () => {
    const { sim, u, v, ctx } = duo();
    u.grafts = ['rootbound'];
    v.hp = v.maxHp * 0.45;
    runItemAttackHits(ctx, u, v);
    expect(v.statuses.some((s) => s.kind === 'root')).toBe(false);
    v.hp = v.maxHp * 0.35;
    runItemAttackHits(ctx, u, v);
    const root = v.statuses.find((s) => s.kind === 'root');
    expect(root?.until).toBeCloseTo(sim.time + 0.6, 9);
    v.statuses = [];
    runItemAttackHits(ctx, u, v);
    expect(v.statuses).toEqual([]);
    expect(u.graftRootAt).toEqual([[v.id, sim.time + ROOTBOUND_EVERY_S]]);
  });

  it('Thornburst bursts 10% of the max health at 4 m when hit under 50%, once per 15 s', () => {
    const { sim, u, v, ctx } = duo('dain', 'vesk');
    u.grafts = ['thornburst'];
    u.hp = u.maxHp * 0.6;
    const hp = v.hp;
    dealDamage(ctx, v.id, u, 10, 'true', 'ability');
    expect(v.hp).toBe(hp);
    u.hp = u.maxHp * 0.45;
    dealDamage(ctx, v.id, u, 10, 'true', 'ability');
    expect(v.hp).toBeLessThan(hp);
    expect(hp - v.hp).toBeLessThanOrEqual(u.maxHp * 0.1 + 1e-9);
    expect(u.graftThornAt).toBe(sim.time + THORNBURST_EVERY_S);
    const after = v.hp;
    dealDamage(ctx, v.id, u, 10, 'true', 'ability');
    expect(v.hp).toBe(after);
  });

  it('shows the Heartwood on the champion to whoever sees it', () => {
    const { sim, unitIds } = landed('respawn');
    const a = sim.units.get(unitIds[0]!)!;
    const b = sim.units.get(unitIds[1]!)!;
    const R = sim.royaleMode!.layout.radius;
    b.pos = along(a.pos as Vec3, randomHeading(new Rng(1), a.pos as Vec3), 3, R);
    b.grafts = ['keen_edge', 'thornburst'];
    sim.tick();
    expect(heartwoodOf(b)).toBe('thornburst');
    const row = buildObservation(sim, a.id)!.units.find((r) => r.id === b.id);
    expect(row?.heartwood).toBe('thornburst');
  });
});

describe('the bot', () => {
  function obsWith(cards: [string, string, string], championId: string, hpFrac = 1): Observation {
    return {
      self: { championId, hp: 100 * hpFrac, maxHp: 100 },
      royale: { offer: { grade: 'bough', cards, offeredAt: 20 } },
    } as unknown as Observation;
  }

  it('takes the role card, Second Breath when hurt, Thornhide for a shell, the first of equals', () => {
    expect(graftPick(obsWith(['stoneblood', 'bloodsap', 'last_rush'], 'vesk'))).toEqual({
      kind: 'graft',
      pick: 1,
    });
    expect(
      graftPick(obsWith(['bloodsap', 'second_breath', 'hunters_eye'], 'vesk', 0.4))?.kind,
    ).toBe('graft');
    expect(graftPick(obsWith(['hunters_eye', 'second_breath', 'last_rush'], 'sylra', 0.4))).toEqual(
      { kind: 'graft', pick: 0 },
    );
    expect(graftPick(obsWith(['stoneblood', 'thornhide', 'second_breath'], 'dain'))).toEqual({
      kind: 'graft',
      pick: 1,
    });
    expect(graftPick(obsWith(['stoneblood', 'thornhide', 'second_breath'], 'dain', 0.3))).toEqual({
      kind: 'graft',
      pick: 1,
    });
    expect(graftPick({ self: {}, royale: { offer: null } } as unknown as Observation)).toBeNull();
  });

  it('answers every offer of a fifty-bot match within a respawn, dead seats included', () => {
    const ids = GRAFT_LIST.length;
    expect(ids).toBe(14);
    const seats = Array.from({ length: 50 }, (_, i) => ({
      ...picks(5)[i % 5]!,
      name: `bot${i}`,
      team: i,
      bot: 'royale',
    }));
    const { sim } = buildRoyaleSim(loadPlanet(), 9, seats, 'respawn');
    // Every open offer, a dead seat's too once it is back, is answered at
    // the bot's first decision: none waits longer than a respawn.
    let taken = 0;
    let oldest = 0;
    while (sim.time < DROP_S + 90) {
      for (const q of sim.royale!.offers.values()) {
        const head = q[0]!;
        oldest = Math.max(oldest, sim.time - head.offeredAt);
      }
      sim.tick();
    }
    for (const u of sim.units.values()) taken += u.grafts.length;
    expect(oldest).toBeLessThan(RESPAWN_S + 2);
    expect(taken).toBeGreaterThanOrEqual(50);
  }, 120_000);
});

function person(clientId: number): RoyalePerson {
  return {
    clientId,
    owner: clientId,
    name: `p${clientId}`,
    guest: true,
    pick: { championId: 'dain', sigils: ['riftstep', 'mend'], skin: 0 },
  };
}

describe('a match with picks, replayed', () => {
  it('re-simulates to the same checksum trail, and not without the picks', () => {
    const match = new RoyaleMatch(1, 17, 'one_life', [person(1)], royaleFactory(loadPlanet), 12);
    const sim = match.sim as unknown as Sim;
    const self = match.players.get(1)!.unitId;
    const trail: number[] = [];
    match.pickDrop(1, 0, 80, 0);
    let picks = 0;
    while (sim.time < DROP_S + 40) {
      const head = sim.royale!.offers.get(self)?.[0];
      if (head && sim.tickCount % 7 === 0) {
        match.handleCommand(1, { t: 'graft', pick: 2 });
        picks++;
      }
      match.tick();
      trail.push(sim.checksum());
    }
    expect(picks).toBeGreaterThan(0);
    expect(sim.units.get(self)!.grafts.length).toBeGreaterThan(0);
    const live = match.replayRecord()!;
    const record = { ...live, picks: [...live.picks] };
    const replay = (events: typeof record.events) => {
      const r = loadRoyaleReplay(loadPlanet(), record)!;
      const teams = new Map<number, number>();
      for (const u of r.sim.units.values()) teams.set(u.id, u.team);
      const queue = [...events];
      const out: number[] = [];
      while (r.sim.tickCount < record.ticks) {
        while (queue.length > 0 && queue[0]!.k === r.sim.tickCount) {
          applyReplayEvent(r.sim, teams, queue.shift()!);
        }
        r.sim.tick();
        out.push(r.sim.checksum());
      }
      return { out, sim: r.sim };
    };
    const again = replay(record.events);
    expect(again.out.slice(-trail.length)).toEqual(trail.slice(-again.out.length));
    expect(again.sim.units.get(self)!.grafts).toEqual(sim.units.get(self)!.grafts);
    const without = replay(record.events.filter((e) => e.c?.t !== 'graft'));
    expect(without.sim.units.get(self)!.grafts).not.toEqual(sim.units.get(self)!.grafts);
  }, 120_000);
});
