// A Respawn Arrival's Grace waits on the person (src/sim/royale/grace.ts;
// ADR 0031, amended 2026-10-08): the server begins it as the seat is taken,
// while a slow client can keep its joining card up for FIRST_FRAME_WAIT_MS,
// so past ARRIVAL_GRACE_S it lasts until the seat's first order of any
// kind, ARRIVAL_GRACE_MAX_S at most. Its own first attack or cast still
// ends it at once; a bot playing the seat orders on its first decision, so
// its Grace never waits on a load; One life's Arrival keeps the fixed
// ARRIVAL_GRACE_S (a Respawn return's is pinned in royale_grace.test.ts);
// and a replay re-simulates it from the orders it recorded.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import type { RoyalePerson } from '../server/royale_seats';
import { FIRST_FRAME_WAIT_MS } from '../src/game/first_frame';
import type { ClientMsg } from '../src/net/protocol';
import { applyReplayEvent, loadRoyaleReplay } from '../src/net/replay';
import type { Vec3 } from '../src/sim/geo';
import { buildObservation } from '../src/sim/observe';
import { Rng } from '../src/sim/rng';
import { ARRIVAL_GRACE_MAX_S, ARRIVAL_GRACE_S } from '../src/sim/royale/grace';
import { along, randomHeading } from '../src/sim/royale/layout';
import { CALM_S, DROP_S } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import type { Unit } from '../src/sim/unit';
import { loadPlanet } from './royale_planet';

const SEATS = 12;

function person(clientId: number, championId = 'dain'): RoyalePerson {
  return {
    clientId,
    owner: clientId,
    name: `p${clientId}`,
    guest: true,
    pick: { championId, sigils: ['riftstep', 'mend'], skin: 0 },
  };
}

function started(variant: 'respawn' | 'one_life' = 'respawn', seed = 11) {
  const match = new RoyaleMatch(1, seed, variant, [person(1)], royaleFactory(loadPlanet), SEATS);
  const sim = match.sim as unknown as Sim;
  return { match, sim };
}

function tickTo(match: RoyaleMatch, t: number): void {
  while (match.sim.time < t - 1e-9) match.tick();
}

// A person drops in at `at` seconds after landing: their seat, and when.
function droppedIn(variant: 'respawn' | 'one_life' = 'respawn', seed = 11, at = 30) {
  const { match, sim } = started(variant, seed);
  tickTo(match, DROP_S + at);
  const p = match.takeBotSeat(person(2))!;
  const u = sim.units.get(p.unitId)!;
  return { match, sim, u, t: sim.time };
}

function graced(sim: Sim, u: Unit): boolean {
  return sim.royale!.arriving.has(u.id);
}

// The person's move order three steps ahead, as the socket hands it over.
function moveOrder(sim: Sim, u: Unit, verb: 'move' | 'attack_move' = 'move'): ClientMsg {
  const R = sim.royaleMode!.layout.radius;
  const p = along(u.pos as Vec3, randomHeading(new Rng(u.id), u.pos as Vec3), 3, R);
  const q = sim.royaleMode!.ground.nearestWalkable(p) ?? p;
  return { t: verb, x: q.x, y: q.y, z: q.z } as ClientMsg;
}

describe("a Respawn Arrival's Grace waits on the person", () => {
  it('outlasts the joining card a slow client keeps up', () => {
    // FIRST_FRAME_WAIT_MS, and two seconds to take the world in.
    expect(ARRIVAL_GRACE_MAX_S * 1000).toBeGreaterThanOrEqual(FIRST_FRAME_WAIT_MS + 2000);
    expect(ARRIVAL_GRACE_S).toBeLessThan(ARRIVAL_GRACE_MAX_S);
  });

  it('lasts past ARRIVAL_GRACE_S while the seat gives no order, ARRIVAL_GRACE_MAX_S at most', () => {
    const { match, sim, u, t } = droppedIn();
    expect(u.statuses).toContainEqual({ kind: 'untargetable', until: t + ARRIVAL_GRACE_MAX_S });
    tickTo(match, t + ARRIVAL_GRACE_S + 1);
    expect(graced(sim, u)).toBe(true);
    tickTo(match, t + ARRIVAL_GRACE_MAX_S - 0.1);
    expect(graced(sim, u)).toBe(true);
    expect(u.hp).toBe(u.maxHp);
    tickTo(match, t + ARRIVAL_GRACE_MAX_S + 0.1);
    expect(graced(sim, u)).toBe(false);
    expect(u.statuses.some((s) => s.kind === 'untargetable')).toBe(false);
  });

  it('ends at the first order past ARRIVAL_GRACE_S, a move, an attack-move or a Stop', () => {
    for (const verb of ['move', 'attack_move', 'stop'] as const) {
      const { match, sim, u, t } = droppedIn();
      tickTo(match, t + ARRIVAL_GRACE_S + 1.5);
      expect(graced(sim, u)).toBe(true);
      match.handleCommand(2, verb === 'stop' ? { t: 'stop' } : moveOrder(sim, u, verb));
      expect(graced(sim, u)).toBe(true);
      match.tick();
      expect(graced(sim, u)).toBe(false);
      expect(u.statuses.some((s) => s.kind === 'untargetable')).toBe(false);
      // A Stop's hold is the seat's own and stays.
      if (verb === 'stop') expect(u.holding).toBe(true);
    }
  });

  it('never ends at an order before ARRIVAL_GRACE_S', () => {
    const { match, sim, u, t } = droppedIn();
    tickTo(match, t + 1);
    match.handleCommand(2, moveOrder(sim, u));
    tickTo(match, t + ARRIVAL_GRACE_S - 0.1);
    expect(graced(sim, u)).toBe(true);
    tickTo(match, t + ARRIVAL_GRACE_S + 0.1);
    expect(graced(sim, u)).toBe(false);
  });

  it('ends at once at its own first cast, before ARRIVAL_GRACE_S too', () => {
    const { match, sim, u, t } = droppedIn();
    tickTo(match, t + 0.5);
    const R = sim.royaleMode!.layout.radius;
    const aim = along(u.pos as Vec3, randomHeading(new Rng(3), u.pos as Vec3), 4, R);
    const cast = (['Q', 'W', 'E'] as const).some((k) => sim.castAbility(u.id, k, aim));
    expect(cast).toBe(true);
    match.tick();
    expect(graced(sim, u)).toBe(false);
  });

  it('never waits on a load for a bot playing the seat: it orders at once', () => {
    const { match, sim, u, t } = droppedIn();
    // The person leaves at once: the seat's bot plays it from here.
    match.leave(2, false);
    expect(sim.policies.has(u.id)).toBe(true);
    tickTo(match, t + ARRIVAL_GRACE_S + 0.3);
    expect(graced(sim, u)).toBe(false);
  });

  it('shows the champions in sight its latest end', () => {
    // Seed 23 at 0:20: beside a fair first fight, the foe in sight.
    const { match, sim, u, t } = droppedIn('respawn', 23, 20);
    expect(sim.royaleMode!.tally.fairArrivals).toBe(1);
    match.tick();
    const seer = [...sim.units.values()].find(
      (o) => o.kind === 'champion' && o.id !== u.id && !o.dead && sim.isVisible(o.team, u.id),
    )!;
    expect(seer).toBeDefined();
    expect(buildObservation(sim, seer.id)!.royale!.graced).toContainEqual({
      id: u.id,
      until: t + ARRIVAL_GRACE_MAX_S,
    });
    expect(buildObservation(sim, u.id)!.royale!.arriving).toBe(true);
  });
});

describe('the Grace that does not wait', () => {
  it("keeps One life's Arrival to ARRIVAL_GRACE_S", () => {
    const { match, sim, u, t } = droppedIn('one_life', 11, CALM_S / 2);
    expect(sim.royaleMode!.graces.get(u.id)).toEqual({
      since: t,
      until: t + ARRIVAL_GRACE_S,
      orderEndsFrom: null,
      ordered: false,
      held: true,
    });
    tickTo(match, t + ARRIVAL_GRACE_S + 0.1);
    expect(graced(sim, u)).toBe(false);
  });
});

describe('the waiting Grace in a replay', () => {
  it('ends on the same tick, from the order the match recorded', () => {
    const { match, sim, u, t } = droppedIn('respawn', 23, 20);
    tickTo(match, t + 4);
    match.handleCommand(2, moveOrder(sim, u));
    // The tick each state of the Grace was seen on, live.
    const seen = (s: Sim): boolean => s.royale!.arriving.has(u.id);
    const live: [number, boolean][] = [];
    while (sim.time < t + 8 - 1e-9) {
      match.tick();
      live.push([sim.tickCount, seen(sim)]);
    }
    expect(live.some(([, g]) => g)).toBe(false);
    const live0 = match.replayRecord()!;
    const record = { ...live0, picks: [...live0.picks] };
    const replay = loadRoyaleReplay(loadPlanet(), record)!;
    const teams = new Map<number, number>();
    for (const o of replay.sim.units.values()) teams.set(o.id, o.team);
    const events = [...record.events];
    const replayed = new Map<number, boolean>();
    let wasGraced = false;
    while (replay.sim.tickCount < record.ticks) {
      while (events.length > 0 && events[0]!.k === replay.sim.tickCount) {
        applyReplayEvent(replay.sim, teams, events.shift()!);
      }
      replay.sim.tick();
      replayed.set(replay.sim.tickCount, seen(replay.sim));
      if (replay.sim.time < t + 4 - 1e-9 && replay.sim.time > t + ARRIVAL_GRACE_S + 0.1) {
        wasGraced ||= seen(replay.sim);
      }
    }
    // Graced past the floor until the order, then not, on the same ticks.
    expect(wasGraced).toBe(true);
    for (const [k, g] of live) expect(replayed.get(k)).toBe(g);
    expect(replay.sim.checksum()).toBe(sim.checksum());
  });
});
