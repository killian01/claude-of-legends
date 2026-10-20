// A Thornfray on the wire (src/net/royale_wire.ts, src/net/goal_wire.ts,
// server/thornfray_snapshot.ts; ADR 0035): the tf block of eight rows at a
// bout's start and again on a rejoin, the snapshot's tf (the count and the
// place, the best count, the goals) sent when it changes, every goal
// primitive round trip, and the mirror keeping the last tf until a new
// match.

import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/client_world';
import { goalOffWire, goalOnWire, type WireGoal } from '../src/net/goal_wire';
import type { ServerMsg } from '../src/net/protocol';
import type { SnapRoyale } from '../src/net/royale_wire';
import { BOUT_SEATS, BOUTS } from '../src/sim/content/bouts/match';
import { Sim } from '../src/sim/sim';
import { thornfrayHarness } from './thornfray_harness';

type Snap = Extract<ServerMsg, { t: 'snap' }>;

describe("a bout's start", () => {
  it('carries the bout, the six kinds, the seat and a table of eight rows', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    const start = h.last(1, 'match_start')!;
    const tf = start.royale!.tf!;
    expect(tf.b).toBe(0);
    expect(tf.k).toHaveLength(BOUTS);
    expect(tf.s).toBe(0);
    expect(tf).not.toHaveProperty('p');
    expect(tf.t).toHaveLength(BOUT_SEATS);
    const sim = h.sim();
    // Seat order at nothing, each row its seat's unit, name and champion.
    tf.t.forEach((row, i) => {
      const [seat, unitId, name, championId, bot, bushels, last, won] = row;
      expect(seat).toBe(i);
      expect(sim.units.get(unitId)?.championId).toBe(championId);
      expect(name.length).toBeGreaterThan(0);
      expect(bot).toBe(i === 0 ? 0 : 1);
      expect([bushels, last, won]).toEqual([0, 0, 0]);
    });
    expect(tf.t[0]![2]).toBe('ash');
    expect(start.selfUnitId).toBe(tf.t[0]![1]);
    // The next bout's: best first, what the last bout paid, its winner.
    h.counts([1, 2, 3, 4, 5, 6, 7, 8]);
    h.nextBout();
    const next = h.last(1, 'match_start')!.royale!.tf!;
    expect(next.b).toBe(1);
    expect(next.p).toBe(7);
    expect(next.t.map((r) => r[0])).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(next.t.map((r) => r[5])).toEqual([5, 4, 3, 2, 1, 0, 0, 0]);
    expect(next.t.map((r) => r[6])).toEqual([5, 4, 3, 2, 1, 0, 0, 0]);
    expect(next.t.map((r) => r[7])).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    // Each row names the seat's unit in the new bout's sim.
    for (const r of next.t) expect(h.sim().units.has(r[1])).toBe(true);
  });

  it('is sent again, whole, on a rejoin', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash', 5);
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    const first = h.last(1, 'match_start')!.royale!.tf!;
    h.step(10);
    h.close(a);
    const back = h.connect(2, 'ash', 5);
    h.enter(back);
    expect(back.matchId).not.toBeNull();
    expect(h.last(2, 'match_start')!.royale!.tf).toEqual(first);
  });
});

describe("the snapshot's tf", () => {
  it('tells the count, the place, the best count and the goals, when they change', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    h.step(1);
    const tfOf = (): SnapRoyale['tf'] => (h.last(1, 'snap') as Snap).royale!.tf;
    expect(tfOf()).toEqual({ c: 0, pl: 1, bc: 0 });
    h.step(1);
    expect(tfOf()).toBeUndefined();
    h.land();
    h.counts([2.5, 4, 0, 0, 0, 0, 0, 0]);
    const sim = h.sim();
    sim.goals = [
      { shape: 'carrier', at: { x: 1, y: 79.9, z: 2 }, radius: 2, holder: 1 },
      { shape: 'circle', at: { x: 0, y: 80, z: 0 }, radius: 6, holder: null },
    ];
    h.step(1);
    expect(tfOf()).toEqual({
      c: 2.5,
      pl: 2,
      bc: 4,
      g: [
        ['carrier', 1, 79.9, 2, 2, sim.royale.bout!.seats[1]],
        ['circle', 0, 80, 0, 6, null],
      ],
    });
    h.step(1);
    expect(tfOf()).toBeUndefined();
  });

  it('starts over at each bout', () => {
    const h = thornfrayHarness();
    const a = h.connect(1, 'ash');
    h.enter(a);
    h.say(a, { t: 'thornfray_start' });
    h.step(2);
    h.nextBout();
    h.step(1);
    // The same line as the bout before, sent again to the new seat.
    expect((h.last(1, 'snap') as Snap).royale!.tf).toEqual({ c: 0, pl: 1, bc: 0 });
  });
});

describe('a goal primitive', () => {
  it('makes the round trip in every shape, held or not', () => {
    const goals: WireGoal[] = [
      { shape: 'circle', at: { x: 1.234, y: -79.5, z: 3 }, radius: 6, holder: null },
      { shape: 'carrier', at: { x: 0, y: 80, z: 0.5 }, radius: 2, holder: 17 },
      { shape: 'target', at: { x: -40.25, y: 0, z: 69.1 }, radius: 3.5, holder: null },
    ];
    for (const g of goals) {
      const back = goalOffWire(JSON.parse(JSON.stringify(goalOnWire(g))));
      expect(back).toEqual({
        ...g,
        at: { x: Math.round(g.at.x * 100) / 100, y: g.at.y, z: g.at.z },
      });
    }
  });

  it('is refused off the wire when it is not one', () => {
    for (const bad of [
      null,
      ['ring', 0, 0, 0, 1, null],
      ['circle', 0, 0, 0, -1, null],
      ['circle', 0, 'x', 0, 1, null],
      ['carrier', 0, 0, 0, 1, 1.5],
      ['target', 0, 0, 0, 1],
    ]) {
      expect(goalOffWire(bad)).toBeNull();
    }
  });
});

describe('the mirror', () => {
  it('keeps the last tf between sends, and lets it go at a new match', () => {
    const world = new ClientWorld(
      () => undefined,
      new Sim(1).map,
      null,
      () => 0,
    );
    const start: ServerMsg = {
      t: 'match_start',
      selfUnitId: 1,
      team: 0,
      royale: { v: 'one_life', seats: 8 },
    };
    world.applyServer(start);
    const base: SnapRoyale = {
      v: 'one_life',
      st: 'play',
      de: 10,
      end: 130,
      dusk: { p: 0, c: [0, 80, 0], r: 40, pe: 30, sh: 0, b: 0.03 },
      alive: 8,
      people: 1,
    };
    const snap = (royale: SnapRoyale): Snap => ({
      t: 'snap',
      time: 1,
      units: [],
      gone: [],
      projectiles: [],
      zones: [],
      walls: [],
      self: null,
      events: [],
      winner: null,
      royale,
    });
    world.applyServer(snap({ ...base, tf: { c: 3, pl: 2, bc: 5 } }));
    world.applyServer(snap(base));
    expect(world.royaleView()?.tf).toEqual({ c: 3, pl: 2, bc: 5 });
    world.applyServer(start);
    world.applyServer(snap(base));
    expect(world.royaleView()).not.toHaveProperty('tf');
  });
});
