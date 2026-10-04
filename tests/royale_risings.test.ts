// The Risings (src/sim/royale/risings.ts, CONTEXT.md: Rising, Wrath): the
// Pyrefang and the Voidmaul at 3:00 and 150 s after each death, the Warden
// once inside the light (4:30 One life, 6:00 Respawn), each called 30 s
// ahead; their bodies scaled for one champion on the planet and unchanged in
// the 5v5; a big creature's last hit paying three pieces (two and a
// Heartwood Graft once Grafts ship), all the health and the slayer shown;
// the Warden's last hit carrying the Wrath, which passes to whoever takes
// its holder down with at least 45 s left and is dropped by a fall nobody
// is credited with.

import { describe, expect, it } from 'vitest';
import { starOrchard } from '../server/star_orchard';
import { buildMatchSim, buildRoyaleSim, type ReplayPick } from '../src/net/replay';
import { dealDamage } from '../src/sim/combat/damage';
import { DEFAULT_BOT_ID } from '../src/sim/content/bots/index';
import { CREATURES } from '../src/sim/content/rings';
import {
  PLANET_NEUTRAL_SCALE,
  RING_RISE_AT_S,
  RISING_PIECES,
  RISING_PIECES_BEFORE_GRAFTS,
  RISING_RETURN_S,
  RISING_WARN_S,
  WARDEN_RISE_AT_S,
  WRATH_PASS_MIN_S,
  WRATH_ROYALE_S,
} from '../src/sim/content/royale_events';
import { dist, type Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { drawDusk, duskAt, insideCap } from '../src/sim/royale/dusk';
import {
  risingReward,
  wardenSite,
  wrathOnDeath,
  wrathPassedUntil,
} from '../src/sim/royale/risings';
import { DROP_S, RESPAWN_S, type RoyaleVariant } from '../src/sim/royale/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import { DT } from '../src/sim/types';
import { createCreature, createWarden, scaleNeutral, type Unit } from '../src/sim/unit';
import { fakeGround, fakeLayout } from './royale_fixture';
import { loadPlanet } from './royale_planet';

function picks(n: number): ReplayPick[] {
  const ids = ['dain', 'vesk', 'sylra', 'korrath', 'maera'];
  return Array.from({ length: n }, (_, i) => ({
    name: `seat${i}`,
    team: i,
    championId: ids[i % ids.length]!,
    sigils: ['riftstep', 'mend'] as [string, string],
  }));
}

function build(n: number, variant: RoyaleVariant = 'respawn', seed = 3) {
  const built = buildRoyaleSim(loadPlanet(), seed, picks(n), variant);
  run(built.sim, DROP_S + DT);
  return built;
}

function run(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

function ctxOf(sim: Sim): CombatCtx {
  return (sim as unknown as { ctx(): CombatCtx }).ctx();
}

function of<T extends SimEvent['type']>(events: SimEvent[], type: T) {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

// The champion stands beside the body and lands the last hit.
function lastHit(sim: Sim, killer: Unit, victim: Unit, source = killer.id): SimEvent[] {
  killer.pos = { ...victim.pos };
  killer.path = [];
  dealDamage(ctxOf(sim), source, victim, victim.maxHp * 10, 'true');
  return sim.tick();
}

function bodyOf(sim: Sim, kind: Unit['kind'], creature?: string): Unit | undefined {
  for (const u of sim.units.values()) {
    if (u.kind === kind && !u.dead && (!creature || u.creatureId === creature)) return u;
  }
  return undefined;
}

// Rises the ring's creature at once.
function riseRing(sim: Sim, creature: 'pyrefang' | 'voidmaul'): Unit {
  const ring = sim.ringStates.find((r) => r.creature === creature)!;
  ring.nextRiseAt = sim.time;
  run(sim, 2 * DT);
  return bodyOf(sim, 'creature', creature)!;
}

// Calls the Warden and rises it.
function riseWarden(sim: Sim): Unit {
  sim.objectives.nextSpawnAt = sim.time + RISING_WARN_S;
  run(sim, RISING_WARN_S + 2 * DT);
  return bodyOf(sim, 'warden')!;
}

describe('the bodies', () => {
  it('leaves the 5v5 unchanged: no scale in its context, and a body rises as written', () => {
    const fives: ReplayPick[] = Array.from({ length: 2 }, (_, i) => ({
      name: `b${i}`,
      team: i as 0 | 1,
      championId: 'dain',
      sigils: ['riftstep', 'mend'],
      bot: DEFAULT_BOT_ID,
    }));
    const { sim } = buildMatchSim(starOrchard(), 1, fives);
    expect(ctxOf(sim).neutralScale).toBeUndefined();
    const a = createCreature(1, CREATURES.pyrefang, { x: 0, z: 0 }, 'might', 240);
    const b = createCreature(1, CREATURES.pyrefang, { x: 0, z: 0 }, 'might', 240);
    scaleNeutral(b, ctxOf(sim).neutralScale?.creature);
    expect(b).toEqual(a);
    const w = createWarden(2, { x: 0, z: 0 }, 720);
    const v = createWarden(2, { x: 0, z: 0 }, 720);
    scaleNeutral(v, undefined);
    expect(v).toEqual(w);
  });

  it('raises a planet Pyrefang at a share of its 5v5 health and strike', () => {
    const { sim } = build(2);
    expect(ctxOf(sim).neutralScale).toBe(PLANET_NEUTRAL_SCALE);
    const ring = sim.ringStates.find((r) => r.creature === 'pyrefang')!;
    expect(ring.nextRiseAt).toBe(DROP_S + RING_RISE_AT_S);
    const body = riseRing(sim, 'pyrefang');
    const whole = createCreature(0, CREATURES.pyrefang, body.pos, body.aspect, ring.roseAt!);
    const s = PLANET_NEUTRAL_SCALE.creature;
    expect(body.maxHp).toBe(Math.round(whole.maxHp * s.hp));
    expect(body.stats.ad).toBe(Math.round(whole.stats.ad * s.ad));
  });

  it('raises the Warden at its share too', () => {
    const { sim } = build(2);
    const w = riseWarden(sim);
    const whole = createWarden(0, w.pos, sim.objectives.roseAt!);
    expect(w.maxHp).toBe(Math.round(whole.maxHp * PLANET_NEUTRAL_SCALE.warden.hp));
  });
});

describe('the clocks', () => {
  it('raises the Warden at 4:30 in One life and 6:00 in Respawn', () => {
    expect(build(2, 'one_life').sim.objectives.nextSpawnAt).toBe(
      DROP_S + WARDEN_RISE_AT_S.one_life,
    );
    expect(build(2, 'respawn').sim.objectives.nextSpawnAt).toBe(DROP_S + WARDEN_RISE_AT_S.respawn);
    expect(WARDEN_RISE_AT_S).toEqual({ one_life: 270, respawn: 360 });
  });

  it('calls a big creature exactly 30 s before it rises, then lists it standing', () => {
    const { sim, unitIds } = build(2);
    const ring = sim.ringStates.find((r) => r.creature === 'voidmaul')!;
    const risesAt = sim.time + 40;
    ring.nextRiseAt = risesAt;
    let calledAt: number | null = null;
    while (calledAt === null && sim.time < risesAt) {
      const t = sim.time;
      const called = of(sim.tick(), 'royale_rising');
      if (called.length > 0) {
        calledAt = t;
        expect(called[0]).toMatchObject({ kind: 'voidmaul', risesAt });
      }
    }
    expect(calledAt).not.toBeNull();
    expect(calledAt!).toBeGreaterThanOrEqual(risesAt - RISING_WARN_S - DT);
    expect(calledAt!).toBeLessThanOrEqual(risesAt - RISING_WARN_S + DT);
    const obs = buildObservation(sim, unitIds[0]!)!.royale!;
    expect(obs.risings).toEqual([
      expect.objectContaining({ kind: 'voidmaul', up: false, risesAt, hpFrac: 1 }),
    ]);
    run(sim, risesAt - sim.time + 2 * DT);
    const body = bodyOf(sim, 'creature', 'voidmaul')!;
    body.hp = body.maxHp / 2;
    const later = buildObservation(sim, unitIds[0]!)!.royale!.risings!;
    expect(later[0]).toMatchObject({ kind: 'voidmaul', up: true });
    expect(later[0]!.hpFrac).toBeCloseTo(0.5, 2);
  });

  it('brings a big creature back 150 s after its death', () => {
    const { sim, unitIds } = build(2);
    const body = riseRing(sim, 'pyrefang');
    const killer = sim.units.get(unitIds[0]!)!;
    const at = sim.time;
    lastHit(sim, killer, body);
    const ring = sim.ringStates.find((r) => r.creature === 'pyrefang')!;
    expect(ring.unitId).toBeNull();
    expect(ring.nextRiseAt).toBeCloseTo(at + RISING_RETURN_S, 6);
    expect(sim.royale!.risings.some((r) => r.kind === 'pyrefang')).toBe(false);
  });

  it('raises the Warden inside the light, and never a second one', () => {
    const { sim, unitIds } = build(2, 'respawn');
    const risesAt = sim.time + RISING_WARN_S;
    sim.objectives.nextSpawnAt = risesAt;
    const events = sim.tick();
    expect(of(events, 'royale_rising')).toEqual([
      expect.objectContaining({ kind: 'warden', risesAt }),
    ]);
    const site = sim.objectives.site!;
    expect(site).not.toBeNull();
    expect(sim.ground.isWalkableAt(site)).toBe(true);
    run(sim, RISING_WARN_S + 2 * DT);
    const w = bodyOf(sim, 'warden')!;
    expect(dist(w.pos as Vec3, site)).toBeLessThan(1e-6);
    expect(insideCap(sim.royale!.dusk.now, w.pos as Vec3)).toBe(true);
    lastHit(sim, sim.units.get(unitIds[0]!)!, w);
    run(sim, 200);
    expect(bodyOf(sim, 'warden')).toBeUndefined();
    expect(sim.objectives.nextSpawnAt).toBe(Number.POSITIVE_INFINITY);
    expect(sim.royale!.risings.some((r) => r.kind === 'warden')).toBe(false);
  });

  it('draws the Warden site walkable and inside the light, whatever the Hastening', () => {
    const layout = fakeLayout();
    for (let seed = 1; seed <= 50; seed++) {
      const schedule = drawDusk(new Rng(seed), layout, fakeGround, DROP_S);
      for (const variant of ['one_life', 'respawn'] as const) {
        const risesAt = DROP_S + WARDEN_RISE_AT_S[variant];
        for (const offset of [0, 30, 60]) {
          const site = wardenSite(schedule, risesAt, offset, fakeGround);
          expect(fakeGround.walkable(site)).toBe(true);
          expect(insideCap(duskAt(schedule, risesAt + offset).now, site)).toBe(true);
        }
      }
    }
  });
});

describe('a big creature last hit', () => {
  it('pays three pieces until Grafts, all the health and the mana, and shows the slayer', () => {
    const { sim, unitIds } = build(2);
    const body = riseRing(sim, 'pyrefang');
    const killer = sim.units.get(unitIds[0]!)!;
    killer.hp = killer.maxHp * 0.3;
    killer.mana = 0;
    const events = lastHit(sim, killer, body);
    expect(of(events, 'royale_loot').filter((e) => e.unitId === killer.id)).toHaveLength(
      RISING_PIECES_BEFORE_GRAFTS,
    );
    expect(killer.hp).toBeCloseTo(killer.maxHp, 0);
    expect(killer.mana).toBeCloseTo(killer.maxMana, 0);
    expect(of(events, 'royale_mark')).toEqual([
      { type: 'royale_mark', unitId: killer.id, kind: 'slayer' },
    ]);
    const marks = buildObservation(sim, unitIds[1]!)!.royale!.marks!;
    expect(marks).toEqual([expect.objectContaining({ id: killer.id, kind: 'slayer' })]);
    expect(sim.royaleMode!.tally.creaturesTaken).toBe(1);
    // The slayer is shown once, for MARK_SHOWN_S.
    run(sim, 5);
    expect(sim.royale!.marks.some((m) => m.kind === 'slayer')).toBe(false);
  });

  it('pays two pieces and the Heartwood Graft once Grafts offer one', () => {
    expect(risingReward(true).pieces).toBe(RISING_PIECES);
    expect(risingReward(false).pieces).toBe(RISING_PIECES_BEFORE_GRAFTS);
    const { sim, unitIds } = build(2);
    const offered: number[] = [];
    sim.royaleMode!.offerHeartwood = (_s, u) => {
      offered.push(u.id);
      return true;
    };
    const body = riseRing(sim, 'voidmaul');
    const killer = sim.units.get(unitIds[1]!)!;
    const events = lastHit(sim, killer, body);
    expect(offered).toEqual([killer.id]);
    expect(of(events, 'royale_loot').filter((e) => e.unitId === killer.id)).toHaveLength(
      RISING_PIECES,
    );
  });
});

describe('the Wrath on the planet', () => {
  for (const variant of ['one_life', 'respawn'] as const) {
    it(`goes with the Warden's last hit for ${WRATH_ROYALE_S[variant]} s in ${variant}`, () => {
      const { sim, unitIds } = build(3, variant);
      const w = riseWarden(sim);
      const killer = sim.units.get(unitIds[0]!)!;
      const at = sim.time;
      const events = lastHit(sim, killer, w);
      expect(sim.teamWrath(killer.team)).toBeCloseTo(at + WRATH_ROYALE_S[variant], 6);
      expect(sim.teamBuffs.boon(killer.team, sim.time)).toBeNull();
      expect(sim.royale!.wrathHolder).toEqual({
        unitId: killer.id,
        until: expect.closeTo(at + WRATH_ROYALE_S[variant], 6),
      });
      expect(of(events, 'royale_mark')).toEqual([
        { type: 'royale_mark', unitId: killer.id, kind: 'wrath' },
      ]);
      expect(sim.royaleMode!.tally.wardensTaken).toBe(1);
    });
  }

  it('passes to whoever takes the holder down, with at least 45 s left', () => {
    expect(wrathPassedUntil(110, 100)).toBe(100 + WRATH_PASS_MIN_S);
    expect(wrathPassedUntil(200, 100)).toBe(200);
    expect(wrathPassedUntil(100, 100)).toBeNull();
    const { sim, unitIds } = build(3, 'one_life');
    const [a, b] = unitIds.map((id) => sim.units.get(id)!) as [Unit, Unit];
    sim.royaleMode!.grantWrath(sim, a);
    sim.tick();
    sim.royale!.wrathHolder!.until = sim.time + 10;
    sim.teamBuffs.setWrath(a.team, sim.time + 10);
    a.hp = 5;
    const at = sim.time;
    const events = lastHit(sim, b, a);
    expect(of(events, 'royale_wrath_passed')).toEqual([
      { type: 'royale_wrath_passed', from: a.id, to: b.id },
    ]);
    expect(sim.royale!.wrathHolder).toEqual({
      unitId: b.id,
      until: expect.closeTo(at + WRATH_PASS_MIN_S, 6),
    });
    expect(sim.teamWrath(b.team)).toBeCloseTo(at + WRATH_PASS_MIN_S, 6);
    expect(sim.teamWrath(a.team)).toBeNull();
    // A passing tells itself (royale_wrath_passed), not as a new mark.
    expect(of(events, 'royale_mark')).toEqual([]);
    expect(sim.royale!.marks.filter((m) => m.kind === 'wrath').map((m) => m.unitId)).toEqual([
      b.id,
    ]);
  });

  it('is dropped by a fall nobody is credited with (the Dusk, a Seedfall)', () => {
    const { sim, unitIds } = build(3, 'one_life');
    const a = sim.units.get(unitIds[0]!)!;
    sim.royaleMode!.grantWrath(sim, a);
    const events = lastHit(sim, a, a, 0);
    expect(of(events, 'royale_wrath_passed')).toEqual([
      { type: 'royale_wrath_passed', from: a.id, to: null },
    ]);
    expect(sim.royale!.wrathHolder).toBeNull();
    expect(sim.teamWrath(a.team)).toBeNull();
  });

  it('is dropped by the Dusk even with a champion credited for the fall', () => {
    const { sim, unitIds } = build(3, 'one_life');
    const [a, b] = unitIds.map((id) => sim.units.get(id)!) as [Unit, Unit];
    sim.royaleMode!.grantWrath(sim, a);
    sim.tick();
    // b struck a, then the burn finished it: b takes the credit, not the Wrath.
    dealDamage(ctxOf(sim), b.id, a, 1, 'true');
    a.hp = 0.01;
    a.lastDamagedAt = sim.time;
    const dark = { ...sim.royale!.dusk.now };
    sim.royaleMode!.stepDusk = (ctx) => {
      sim.royaleMode!.state.dusk = { ...sim.royaleMode!.state.dusk, now: dark, burn: 1 };
      dealDamage(ctx, 0, a, a.maxHp, 'true');
      (sim.royaleMode as unknown as { duskHit: Set<number> }).duskHit.add(a.id);
    };
    const events = sim.tick();
    expect(of(events, 'death').find((e) => e.unitId === a.id)?.killerId).toBe(b.id);
    expect(of(events, 'royale_wrath_passed')).toEqual([
      { type: 'royale_wrath_passed', from: a.id, to: null },
    ]);
    expect(sim.teamWrath(b.team)).toBeNull();
  });

  it('is dropped by a Seedfall impact even with a champion credited', () => {
    const { sim, unitIds } = build(3, 'one_life');
    const [a, b] = unitIds.map((id) => sim.units.get(id)!) as [Unit, Unit];
    sim.royaleMode!.grantWrath(sim, a);
    sim.tick();
    dealDamage(ctxOf(sim), b.id, a, 1, 'true');
    a.hp = 0.01;
    sim.royale!.seedfalls.push({
      id: 99,
      pos: { ...(a.pos as Vec3) },
      announcedAt: sim.time - 30,
      landsAt: sim.time,
      landed: false,
      cacheId: null,
    });
    const events = sim.tick();
    expect(of(events, 'death').find((e) => e.unitId === a.id)?.killerId).toBe(b.id);
    expect(of(events, 'royale_wrath_passed')).toEqual([
      { type: 'royale_wrath_passed', from: a.id, to: null },
    ]);
  });

  it('leaves a Respawn holder who fell and came back without it', () => {
    const { sim, unitIds } = build(3, 'respawn');
    const a = sim.units.get(unitIds[0]!)!;
    sim.royaleMode!.grantWrath(sim, a);
    lastHit(sim, a, a, 0);
    run(sim, RESPAWN_S + 0.5);
    expect(a.dead).toBe(false);
    expect(sim.teamWrath(a.team)).toBeNull();
    expect(sim.royale!.wrathHolder).toBeNull();
  });

  it('runs out on its own clock, and its mark with it', () => {
    const { sim, unitIds } = build(2, 'one_life');
    const a = sim.units.get(unitIds[0]!)!;
    sim.royaleMode!.grantWrath(sim, a);
    run(sim, WRATH_ROYALE_S.one_life + 0.2);
    expect(sim.royale!.wrathHolder).toBeNull();
    expect(sim.teamWrath(a.team)).toBeNull();
    expect(sim.royale!.marks.some((m) => m.kind === 'wrath')).toBe(false);
  });

  it('ignores a fall that was not the holder', () => {
    const { sim, unitIds } = build(3, 'one_life');
    const [a, b] = unitIds.map((id) => sim.units.get(id)!) as [Unit, Unit];
    sim.royaleMode!.grantWrath(sim, a);
    const before = structuredClone(sim.royale!.wrathHolder);
    wrathOnDeath(sim.royaleMode!, sim, b, a);
    expect(sim.royale!.wrathHolder).toEqual(before);
  });
});
