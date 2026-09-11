// The Warden's pits (ADR 0023): the first Warden rises at the map's first
// pit, every later one at a pit drawn from the match's rng among the
// others, never the same twice running; on the Star Orchard the plaza and
// four forest rooms, each open ground away from the camps and the lanes.
// The observation, the wire and the objective line say where once it
// stands and nothing before; a bot guesses the nearest pit like a human.

import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../server/snapshot';
import { starOrchard } from '../server/star_orchard';
import { ClientWorld } from '../src/net/client_world';
import { laneDistance } from '../src/sim/lanes';
import { drawPit, WARDEN_RESPAWN_S } from '../src/sim/objectives';
import { buildObservation } from '../src/sim/observe';
import { playbookPolicy } from '../src/sim/playbook/interpreter';
import type { PlaybookDef } from '../src/sim/playbook/types';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import { TerrainNavGrid } from '../src/sim/terrain_nav';
import type { Unit } from '../src/sim/unit';
import { objectiveLine } from '../src/ui/objective_line';

const TICKS_PER_S = 20;

function orchardSim(seed = 11): Sim {
  const orchard = starOrchard();
  return new Sim(seed, {
    map: orchard.map,
    nav: new TerrainNavGrid(orchard.navigation),
    strictNavigation: true,
  });
}

function findWarden(sim: Sim): Unit | undefined {
  return [...sim.units.values()].find((u) => u.kind === 'warden');
}

function riseNow(sim: Sim): Unit {
  sim.objectives.nextSpawnAt = sim.time;
  for (let i = 0; i < 3 * TICKS_PER_S && !findWarden(sim); i++) sim.tick();
  return findWarden(sim)!;
}

describe("the Warden's pits", () => {
  it('draws the next pit among the others, never the same twice running, every pit in time', () => {
    const rng = new Rng(7);
    let last = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const next = drawPit(rng, 5, last);
      expect(next).not.toBe(last);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(5);
      seen.add(next);
      last = next;
    }
    expect(seen.size).toBe(5);
    // Two pits alternate; one stays.
    expect(drawPit(new Rng(1), 2, 0)).toBe(1);
    expect(drawPit(new Rng(1), 2, 1)).toBe(0);
    expect(drawPit(new Rng(1), 1, 0)).toBe(0);
  });

  it('on the Orchard: the plaza first, then four forest rooms on open ground away from the camps', () => {
    const orchard = starOrchard();
    const { map } = orchard;
    const nav = new TerrainNavGrid(orchard.navigation);
    expect(map.wardenPits.map((p) => p.name)).toEqual([
      'plaza',
      'west glade',
      'west hollow',
      'east glade',
      'east hollow',
    ]);
    const center = map.wardenPits[0]!;
    expect(Math.hypot(center.x - map.size / 2, center.z - map.size / 2)).toBeLessThan(4);
    for (const pit of map.wardenPits) {
      expect(nav.isWalkableAt(pit.x, pit.z), pit.name).toBe(true);
      // A room at least five meters across: a ring of points around the
      // pit stays on open ground.
      for (let a = 0; a < 12; a++) {
        const x = pit.x + Math.cos((a * Math.PI) / 6) * 2.4;
        const z = pit.z + Math.sin((a * Math.PI) / 6) * 2.4;
        expect(nav.isWalkableAt(x, z), `${pit.name} ${a}`).toBe(true);
      }
      for (const camp of map.camps) {
        expect(Math.hypot(camp.x - pit.x, camp.z - pit.z), pit.name).toBeGreaterThan(8);
      }
    }
    for (const pit of map.wardenPits.slice(1)) {
      for (const lane of ['top', 'mid', 'bot'] as const) {
        expect(laneDistance(map.lanes[lane], pit.x, pit.z), pit.name).toBeGreaterThan(6);
      }
    }
    // Each forest room has its point mirror on the other side.
    const mirror = (p: { x: number; z: number }) => ({
      x: 2 * center.x - p.x,
      z: 2 * center.z - p.z,
    });
    for (const pit of map.wardenPits.slice(1)) {
      const m = mirror(pit);
      const twin = map.wardenPits
        .slice(1)
        .find((q) => q !== pit && Math.hypot(q.x - m.x, q.z - m.z) < 6);
      expect(twin, pit.name).toBeDefined();
    }
  });

  it('rises at the plaza first, then at the drawn pit, told to every reader at the rise only', () => {
    const sim = orchardSim();
    const me = sim.addChampion(0);
    expect(sim.wardenPit()).toBeNull();
    const first = riseNow(sim);
    const plaza = sim.map.wardenPits[0]!;
    expect(Math.hypot(first.pos.x - plaza.x, first.pos.z - plaza.z)).toBeLessThan(2);
    expect(sim.wardenPit()?.name).toBe('plaza');
    // Slain: the clock restarts and another pit is drawn, told to nobody.
    const slayer = sim.addChampion(1, { x: first.pos.x + 2, z: first.pos.z });
    first.hp = 1;
    first.lastDamagedAt = sim.time;
    sim.orderAttack(slayer.id, first.id);
    for (let i = 0; i < 100 && findWarden(sim); i++) sim.tick();
    expect(findWarden(sim)).toBeUndefined();
    expect(sim.objectives.pit).not.toBe(0);
    expect(sim.wardenPit()).toBeNull();
    expect(sim.objectiveSpawnAt()! - sim.time).toBeGreaterThan(WARDEN_RESPAWN_S - 6);
    sim.tick();
    expect(buildObservation(sim, me.id)!.wardenPit).toBeUndefined();
    const before = buildSnapshot(sim, 0, me.id, new Set(), []);
    if (before.t !== 'snap') throw new Error('not a snap');
    expect(before.objPit).toBeUndefined();
    const client = new ClientWorld(() => undefined, starOrchard().map);
    client.applyServer({ t: 'match_start', selfUnitId: me.id, team: 0 });
    client.applyServer(before);
    expect(client.wardenPit()).toBeNull();
    expect(
      objectiveLine([], sim.objectiveSpawnAt(), sim.time, client.wardenPit() ?? undefined),
    ).toMatch(/^Warden \d:\d\d$/);
    // It rises at the drawn pit, and now everyone reads it.
    const second = riseNow(sim);
    const next = sim.wardenPit()!;
    expect(next.name).not.toBe('plaza');
    expect(Math.hypot(second.pos.x - next.x, second.pos.z - next.z)).toBeLessThan(2);
    sim.tick();
    expect(buildObservation(sim, me.id)!.wardenPit).toEqual({ x: next.x, z: next.z });
    const snap = buildSnapshot(sim, 0, me.id, new Set(), []);
    if (snap.t !== 'snap') throw new Error('not a snap');
    expect(snap.objPit).toBe(sim.objectives.pit);
    client.applyServer(snap);
    expect(client.wardenPit()).toEqual(next);
    expect(objectiveLine([], null, sim.time, sim.wardenPit() ?? undefined)).toBe(
      `Warden LIVE at the ${next.name}`,
    );
    // Deterministic: the same seed draws the same pits.
    const again = orchardSim();
    again.addChampion(0);
    const w = riseNow(again);
    const s2 = again.addChampion(1, { x: w.pos.x + 2, z: w.pos.z });
    w.hp = 1;
    w.lastDamagedAt = again.time;
    again.orderAttack(s2.id, w.id);
    for (let i = 0; i < 100 && findWarden(again); i++) again.tick();
    expect(again.objectives.pit).toBe(sim.objectives.pit);
  });

  it('a bot cannot know the drawn pit before the rise: it pre-positions at the nearest', () => {
    const sim = orchardSim();
    const hollow = sim.map.wardenPits.findIndex((p) => p.name === 'west hollow');
    sim.objectives.pit = hollow;
    sim.objectives.nextSpawnAt = sim.time + 30;
    const drawn = sim.map.wardenPits[hollow]!;
    const pit = sim.map.wardenPits.find((p) => p.name === 'west glade')!;
    // On the top lane by its own towers, beside the west glade, the
    // hollow forty-five meters up the forest.
    const me = sim.addChampion(0, { x: 10, z: 60 }, 'vesk');
    expect(Math.hypot(me.pos.x - pit.x, me.pos.z - pit.z)).toBeLessThan(
      Math.hypot(me.pos.x - drawn.x, me.pos.z - drawn.z),
    );
    sim.tick();
    expect(buildObservation(sim, me.id)!.wardenPit).toBeUndefined();
    const def: PlaybookDef = {
      version: 1,
      plays: [
        { id: 'warden', when: { kind: 'always' }, do: { kind: 'contestWarden', prepSeconds: 45 } },
      ],
    };
    sim.attachPolicy(me.id, playbookPolicy(def, undefined, sim.map));
    const d0 = Math.hypot(me.pos.x - pit.x, me.pos.z - pit.z);
    const h0 = Math.hypot(me.pos.x - drawn.x, me.pos.z - drawn.z);
    for (let i = 0; i < 6 * TICKS_PER_S; i++) sim.tick();
    expect(Math.hypot(me.pos.x - pit.x, me.pos.z - pit.z)).toBeLessThan(d0 - 5);
    expect(Math.hypot(me.pos.x - drawn.x, me.pos.z - drawn.z)).toBeGreaterThan(h0 - 3);
  });
});
