// Mauldrum (CONTEXT.md: Mauldrum; docs/design/mauldrum.md), on the real
// Wanderseed through the one construction (src/net/replay.ts buildBoutSim):
// the Thornyard drawn in the Cliffs alone, around the Voidmaul's ring; the
// Voidmaul called before the landing and risen 12 s after it, the only
// body in the bout that is not a seat; the struck count (every point of
// damage on it, 400 for the blow that fells it, a takedown taking a fifth
// of the fallen's); the maul errand to it; a bot beside the Voidmaul still
// fights an enemy beside it; one closing as phase 5 and the light held to
// 110 s; eight house bots played to its clock at 100 s, the Voidmaul felled
// in it, the ranking total and by the count; no Seedfall, camp, Warden,
// other ring, pad, mark, Burr, Last light, Upstart or Graft; a replay that
// plays the bout it recorded.

import { describe, expect, it } from 'vitest';
import { loadRoyaleReplay, royaleReplayPlayable } from '../src/net/replay';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { MAULDRUM } from '../src/sim/content/bouts/mauldrum';
import type { BoutView } from '../src/sim/content/bouts/types';
import { dist, heading, type Vec3 } from '../src/sim/geo';
import type { ObsRising, ObsUnit } from '../src/sim/policy';
import { Rng } from '../src/sim/rng';
import { maulCall } from '../src/sim/royale/bot/bout_calls';
import type { Sense } from '../src/sim/royale/bot/sense';
import { boutResult } from '../src/sim/royale/bouts/end';
import { boutSeed, drawBouts } from '../src/sim/royale/bouts/ledger';
import { boutPlan, thornyardOf } from '../src/sim/royale/bouts/plan';
import {
  MAUL_FELL_BONUS,
  MAUL_STEAL_SHARE,
  mauldrumScorer,
} from '../src/sim/royale/bouts/score_mauldrum';
import { DARK_PHASE, drawDusk, duskAt } from '../src/sim/royale/dusk';
import { along } from '../src/sim/royale/layout';
import { royaleGround } from '../src/sim/royale/mode';
import { royaleLayoutOf } from '../src/sim/royale/planet_map';
import { DROP_S } from '../src/sim/royale/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import type { Unit } from '../src/sim/unit';
import { loadPlanet } from './royale_planet';
import { type BoutArgs, boutReplay, buildBout, land, playOut } from './thornfray_fixture';

const planet = loadPlanet();
const layout = royaleLayoutOf(planet.layout);
const ground = royaleGround(planet.ground());

function firstBout(seed: number): BoutArgs {
  const region = drawBouts(seed, [MAULDRUM])[0]!.region;
  return { kind: MAULDRUM, matchSeed: seed, seed: boutSeed(seed, 0), index: 0, region };
}

function idle(sim: Sim, unitIds: readonly number[]): void {
  for (const id of unitIds) sim.policies.delete(id);
}

function standAt(u: Unit, p: Vec3): void {
  u.pos = { ...p };
  u.path = [];
}

function voidmaulOf(sim: Sim): Unit | undefined {
  return [...sim.units.values()].find((u) => u.creatureId === 'voidmaul' && !u.dead);
}

describe('the Mauldrum Thornyard and Dusk', () => {
  it('stands in the Cliffs alone, around the Voidmaul ring', () => {
    expect(MAULDRUM.thornyard.regions).toEqual(['cliffs']);
    for (let seed = 1; seed <= 12; seed++) {
      for (const b of drawBouts(seed, [MAULDRUM])) expect(b.region).toBe('cliffs');
    }
    const yard = thornyardOf(layout, 'cliffs', MAULDRUM.thornyard.radius);
    expect(dist(yard.center, layout.voidmaul)).toBeLessThan(MAULDRUM.thornyard.radius / 4);
  });

  it('lights the Thornyard to 60 s, closes once to 30 m as phase 5 and holds the light to 110 s', () => {
    const plan = boutPlan(MAULDRUM, thornyardOf(layout, 'cliffs', MAULDRUM.thornyard.radius));
    expect(plan.dusk.lightOutS).toBe(110);
    expect(plan.playS).toBe(100);
    for (let seed = 1; seed <= 5; seed++) {
      const s = drawDusk(new Rng(seed), layout, ground, DROP_S, plan.dusk);
      expect(s.caps.map((c) => c.radius)).toEqual([40, 30]);
      const at = (t: number) => duskAt(s, DROP_S + t);
      expect(at(0)).toMatchObject({ phase: 0, burn: 0.04, now: s.caps[0] });
      expect(at(59.9).phase).toBe(0);
      expect(at(60)).toMatchObject({ phase: 5, shrinking: true, burn: 0.06 });
      expect(at(75).now.radius).toBe(30);
      expect(at(109.9).phase).toBe(5);
      expect(at(110).phase).toBe(DARK_PHASE);
    }
  });
});

// A bout as the scorer reads it: seats 0 to 3 are units 10 to 13; any
// other unit is the Voidmaul.
function view(counts: number[]): BoutView {
  return {
    counts,
    seatCount: counts.length,
    seatOf: (id: number) => (id >= 10 && id < 10 + counts.length ? id - 10 : null),
  } as unknown as BoutView;
}

describe('the struck count', () => {
  const dmg = (sourceId: number, targetId: number, amount: number): SimEvent => ({
    type: 'damage',
    sourceId,
    targetId,
    amount,
    dtype: 'physical',
  });

  it('counts every point a seat lands on the Voidmaul, each blow rounded, and none on a champion', () => {
    const b = view([0, 0, 0, 0]);
    mauldrumScorer.onEvents(
      [dmg(10, 99, 40.4), dmg(10, 99, 12.6), dmg(11, 12, 300), dmg(99, 13, 80), dmg(12, 99, 0.3)],
      b,
    );
    expect(b.counts).toEqual([53, 0, 0, 0]);
  });

  it('adds the bonus to the blow that fells it', () => {
    const b = view([100, 0, 0, 0]);
    mauldrumScorer.onEvents([dmg(11, 99, 20), { type: 'death', unitId: 99, killerId: 11 }], b);
    expect(b.counts).toEqual([100, 20 + MAUL_FELL_BONUS, 0, 0]);
  });

  it('moves a fifth of the fallen to its taker on a takedown, none on a fall to the Voidmaul', () => {
    const b = view([503, 10, 0, 0]);
    mauldrumScorer.onEvents([{ type: 'death', unitId: 10, killerId: 11 }], b);
    const moved = Math.floor(503 * MAUL_STEAL_SHARE);
    expect(moved).toBe(100);
    expect(b.counts).toEqual([503 - moved, 10 + moved, 0, 0]);
    mauldrumScorer.onEvents([{ type: 'death', unitId: 11, killerId: 99 }], b);
    expect(b.counts).toEqual([503 - moved, 10 + moved, 0, 0]);
    const own = view([0, 0, 250, 0]);
    mauldrumScorer.onEvents([{ type: 'death', unitId: 12, killerId: 12 }], own);
    expect(own.counts).toEqual([0, 0, 250, 0]);
  });
});

function sense(me: Vec3, risings: ObsRising[], neutrals: Partial<ObsUnit>[], hpFrac = 1): Sense {
  return {
    me,
    s: { hpFrac, dest: null, holding: false },
    r: { risings },
    neutrals,
  } as unknown as Sense;
}

describe('the maul errand', () => {
  const ring = layout.voidmaul;
  const R = dist(ring, { x: 0, y: 0, z: 0 });
  const far = along(ring, heading(ring, 1) as Vec3, 30, R);
  const near = along(ring, heading(ring, 1) as Vec3, 5, R);
  const called: ObsRising = { kind: 'voidmaul', ...ring, risesAt: 50, up: false, hpFrac: 1 };
  const up: ObsRising = { ...called, up: true };
  const body: Partial<ObsUnit> = { id: 77, kind: 'creature', ...ring, hpFrac: 1 };

  it('walks to the ring of a called Voidmaul and waits beside it', () => {
    const out = maulCall(sense(far, [called], []), MAULDRUM.bots)!;
    expect(out.why).toBe('maul-walk');
    expect(out.action).toMatchObject({ kind: 'move', x: ring.x, y: ring.y, z: ring.z });
    expect(maulCall(sense(near, [called], []), MAULDRUM.bots)!.why).toBe('maul-wait');
  });

  it('strikes it once it stands', () => {
    const out = maulCall(sense(far, [up], [body]), MAULDRUM.bots)!;
    expect(out).toEqual({ why: 'maul', action: { kind: 'attack', targetId: 77 } });
  });

  it('asks nothing under its health floor, out of reach, or once it has fallen', () => {
    expect(maulCall(sense(far, [up], [body], 0.3), MAULDRUM.bots)).toBeNull();
    expect(maulCall(sense(far, [up], [body]), { ...MAULDRUM.bots, reach: 10 })).toBeNull();
    expect(maulCall(sense(far, [], []), MAULDRUM.bots)).toBeNull();
  });

  it('a bot beside the Voidmaul still fights an enemy beside it', () => {
    const { sim, unitIds } = buildBout(firstBout(1));
    idle(sim, unitIds.slice(1));
    land(sim);
    while (!voidmaulOf(sim) && sim.time < DROP_S + 30) sim.tick();
    const maul = voidmaulOf(sim)!;
    expect(maul).toBeDefined();
    const yard = sim.royaleMode!.schedule.caps[0]!;
    const R2 = dist(yard.center, { x: 0, y: 0, z: 0 });
    const away = ground.nearestWalkable(
      along(yard.center, heading(yard.center, 0) as Vec3, 32, R2),
    )!;
    for (const id of unitIds.slice(2)) standAt(sim.units.get(id)!, away);
    const by = ground.nearestWalkable(
      along(maul.pos as Vec3, heading(maul.pos as Vec3, 1) as Vec3, 7, R2),
    )!;
    standAt(sim.units.get(unitIds[0]!)!, by);
    standAt(sim.units.get(unitIds[1]!)!, along(by, heading(by, 2) as Vec3, 3, R2));
    let hit = false;
    for (let i = 0; i < Math.round(6 / DT) && !hit; i++) {
      for (const e of sim.tick()) {
        if (e.type === 'damage' && e.sourceId === unitIds[0] && e.targetId === unitIds[1]) {
          hit = true;
        }
      }
    }
    expect(hit).toBe(true);
  });
});

describe('a Mauldrum bout', () => {
  for (const seed of [1, 2, 3]) {
    it(`ends at its clock, 100 s, the Voidmaul struck, eight house bots on seed ${seed}`, () => {
      const { sim, unitIds } = buildBout(firstBout(seed));
      const seats = new Set(unitIds);
      let fellAt: number | null = null;
      let risenAt: number | null = null;
      let maulId: number | null = null;
      let struck = 0;
      while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 200) {
        for (const e of sim.tick()) {
          // Every blow a seat lands on a body not a seat's lands on the Voidmaul.
          if (e.type === 'damage' && !seats.has(e.targetId) && seats.has(e.sourceId)) {
            expect(e.targetId).toBe(maulId);
            struck += e.amount;
          }
          if (e.type === 'death' && !seats.has(e.unitId)) {
            expect(e.unitId).toBe(maulId);
            fellAt = sim.time - DROP_S;
          }
        }
        if (risenAt === null && voidmaulOf(sim)) {
          risenAt = sim.time - DROP_S;
          maulId = voidmaulOf(sim)!.id;
        }
      }
      expect(sim.royale!.stage).toBe('over');
      expect(sim.time - DROP_S).toBeCloseTo(MAULDRUM.playS + DT, 6);
      expect(risenAt).toBeCloseTo(12, 0);
      // Struck for most of its health on every seed, and felled late in the
      // bout (seed 1's stands to the clock with about a quarter left).
      expect(struck).toBeGreaterThan(2000);
      if (seed !== 1) expect(fellAt).toBeGreaterThan(50);
      const r = boutResult(sim.royaleMode!, sim);
      expect([...r.ranking].sort((a, c) => a - c)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      for (let i = 1; i < r.ranking.length; i++) {
        expect(r.counts[r.ranking[i - 1]!]!).toBeGreaterThanOrEqual(r.counts[r.ranking[i]!]!);
      }
      expect(sim.royale!.winnerId).toBe(unitIds[r.ranking[0]!]);
      expect(r.counts[r.ranking[0]!]).toBeGreaterThan(MAUL_FELL_BONUS);
      expect(sim.royaleMode!.ranking(sim)).toEqual(r.ranking.map((s) => unitIds[s]));
    });
  }

  it('stands only the Voidmaul ring, and no Seedfall, camp, Warden, pad, mark, Burr, Last light, Upstart or Graft', () => {
    const { sim } = buildBout(firstBout(1));
    const mode = sim.royaleMode!;
    expect(mode.seedfallCalls).toHaveLength(0);
    expect(sim.map.camps).toEqual([]);
    expect((sim.map.rings ?? []).map((r) => r.id)).toHaveLength(1);
    expect(sim.ringStates.map((r) => r.creature)).toEqual(['voidmaul']);
    expect(sim.map.wardenPits).toEqual([]);
    for (const system of ['pads', 'burr', 'lastLight', 'marks', 'upstart', 'camps'] as const) {
      expect(mode.runs(system)).toBe(false);
    }
    expect(mode.runs('clamors')).toBe(true);
    const seen = new Set<string>();
    let offers = 0;
    while (sim.royale!.stage !== 'over' && sim.time < DROP_S + 200) {
      for (const e of sim.tick()) seen.add(e.type);
      for (const q of sim.royale!.offers.values()) offers += q.length;
      for (const u of sim.units.values()) {
        expect(u.kind === 'champion' || u.creatureId === 'voidmaul').toBe(true);
      }
    }
    expect(seen.has('royale_rising')).toBe(true);
    for (const type of ['royale_seedfall_land', 'royale_pad', 'royale_mark', 'royale_last_light']) {
      expect(seen.has(type)).toBe(false);
    }
    expect(mode.tally.upstarts).toBe(0);
    expect(offers).toBe(0);
  });

  it('replays the bout it recorded, from the registry', () => {
    const args = firstBout(3);
    const record = boutReplay(args);
    expect(BOUT_KINDS).toContain(MAULDRUM);
    expect(royaleReplayPlayable(record)).toBe(true);
    const live = buildBout(args);
    const again = loadRoyaleReplay(planet, record)!;
    const a = playOut(live.sim);
    const b = playOut(again.sim);
    expect(live.sim.royale!.stage).toBe('over');
    expect(b.checks).toEqual(a.checks);
    const summary = (sim: Sim) => {
      const r = boutResult(sim.royaleMode!, sim);
      return { checksum: sim.checksum(), ticks: sim.tickCount, counts: r.counts };
    };
    expect(summary(again.sim)).toEqual(summary(live.sim));
  });
});
