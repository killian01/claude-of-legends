// The Arrival (CONTEXT.md; src/sim/royale/grace.ts arrive): a person who
// drops into a running match takes a bot's seat and the champion comes down
// fresh, at a quiet spot inside the light, in its Grace, its tally from zero
// (a playtest, 2026-10-04: a visitor took a seat mid-fight at half health
// and was slain five seconds after joining, with the bot's score and kills).
// Recorded as an 'arrive' replay event, so a replay re-simulates it alike.
// The quiet spot itself (drop.ts arrivalSpot) and the Respawn return's
// point (score.ts edgeOfLight) are pinned on the real Wanderseed.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import type { RoyalePerson } from '../server/royale_seats';
import { applyReplayEvent, loadRoyaleReplay } from '../src/net/replay';
import { dist, type Vec3 } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import { ARRIVAL_DEPTH_M, ARRIVAL_QUIET_M, arrivalSpot } from '../src/sim/royale/drop';
import { depthInside, insideCap } from '../src/sim/royale/dusk';
import { ARRIVAL_GRACE_S } from '../src/sim/royale/grace';
import { along, type RoyaleGround, randomHeading } from '../src/sim/royale/layout';
import { edgeOfLight } from '../src/sim/royale/score';
import { CALM_S, DROP_S, type DuskCap } from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { landed } from './royale_contract_fixture';
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

function champions(sim: Sim) {
  return [...sim.units.values()].filter((u) => u.kind === 'champion');
}

// Every bot seat worn down as a fight leaves it: half health, a third of
// its mana, every cooldown and sigil down, a pending strike, a score and a
// tally of its own, a slow on it, and the leader.
function wearDown(sim: Sim, exceptId: number): void {
  const mode = sim.royaleMode!;
  for (const u of champions(sim)) {
    if (u.id === exceptId || u.dead) continue;
    u.hp = u.maxHp / 2;
    u.mana = u.maxMana / 3;
    u.cooldowns = { Q: sim.time + 9, W: sim.time + 9, E: sim.time + 9, R: sim.time + 60 };
    u.sigilCooldowns = [sim.time + 30, sim.time + 30];
    u.kills = 3;
    u.deaths = 2;
    u.assists = 4;
    u.killStreak = 3;
    u.statuses.push({ kind: 'slow', until: sim.time + 5, pct: 0.3 });
    u.lastDamagedAt = sim.time;
    mode.state.scores.set(u.id, 5);
  }
}

describe('an Arrival in play', () => {
  it('brings the seat down fresh, at a quiet spot, graced, its tally from zero', () => {
    const { match, sim } = started();
    tickTo(match, DROP_S + 30);
    const self = match.players.get(1)!.unitId;
    wearDown(sim, self);
    const before = new Map(
      champions(sim).map((u) => [u.id, { level: u.level, items: [...u.items], pos: u.pos }]),
    );
    const tally = { ...sim.royaleMode!.tally };
    const p = match.takeBotSeat(person(2))!;
    const u = sim.units.get(p.unitId)!;
    expect(u.dead).toBe(false);
    expect(u.hp).toBe(u.maxHp);
    expect(u.mana).toBe(u.maxMana);
    for (const k of ['Q', 'W', 'E', 'R'] as const) {
      expect(u.cooldowns[k] ?? 0).toBeLessThanOrEqual(sim.time);
    }
    expect(u.sigilCooldowns.every((c) => c <= sim.time)).toBe(true);
    expect(u.statuses.map((s) => s.kind)).toEqual(['untargetable']);
    expect(u.level).toBe(before.get(u.id)!.level);
    expect(u.items).toEqual(before.get(u.id)!.items);
    expect([u.kills, u.deaths, u.assists, u.killStreak]).toEqual([0, 0, 0, 0]);
    expect(sim.royale!.scores.get(u.id)).toBe(0);
    // The match's own count keeps what happened.
    expect(sim.royaleMode!.tally).toEqual(tally);
    // In its Grace, for ARRIVAL_GRACE_S.
    expect(sim.royale!.arriving.has(u.id)).toBe(true);
    expect(sim.royaleMode!.graces.get(u.id)).toEqual({
      since: sim.time,
      until: sim.time + ARRIVAL_GRACE_S,
      held: true,
    });
    // Somewhere quiet inside the light, on walkable ground.
    const at = u.pos as Vec3;
    expect(insideCap(sim.royale!.dusk.now, at)).toBe(true);
    expect(sim.royaleMode!.ground.walkable(at)).toBe(true);
    for (const o of champions(sim)) {
      if (o.id === u.id || o.dead) continue;
      expect(dist(at, o.pos)).toBeGreaterThanOrEqual(ARRIVAL_QUIET_M);
    }
    expect(dist(at, before.get(u.id)!.pos)).toBeGreaterThan(0);
    // The landing's dust and slam on the next tick's events.
    const events = match.tick();
    expect(events).toContainEqual({ type: 'royale_land', unitId: u.id });
    // Recorded after the kit, on the same tick, so a replay does it alike.
    const k = match.replayEvents.find((e) => e.u === u.id && e.e === 'kit')!.k;
    expect(match.replayEvents.filter((e) => e.u === u.id).map((e) => [e.k, e.e])).toEqual([
      [k, 'bot_off'],
      [k, 'kit'],
      [k, 'arrive'],
    ]);
  });

  it('reads the leader again when the seat taken led', () => {
    const { match, sim } = started();
    tickTo(match, DROP_S + 5);
    const mode = sim.royaleMode!;
    const self = match.players.get(1)!.unitId;
    const bots = champions(sim).filter((u) => u.id !== self);
    // The seat a person picking its champion takes leads, a bot after it.
    const lead = bots[0]!;
    const next = bots[1]!;
    mode.state.scores.set(lead.id, 4);
    mode.state.scores.set(next.id, 2);
    mode.state.leaderId = lead.id;
    const p = match.takeBotSeat(person(2, lead.championId!))!;
    expect(p.unitId).toBe(lead.id);
    expect(mode.state.leaderId).toBe(next.id);
  });

  it('brings a seat that was down back at once, with no death counted', () => {
    const { match, sim } = started();
    tickTo(match, DROP_S + 5);
    const self = match.players.get(1)!.unitId;
    for (const u of champions(sim)) {
      if (u.id === self) continue;
      u.dead = true;
      u.hp = 0;
      u.respawnAt = sim.time + 4;
    }
    const p = match.takeBotSeat(person(2))!;
    const u = sim.units.get(p.unitId)!;
    expect(u.dead).toBe(false);
    expect(u.hp).toBe(u.maxHp);
    expect(u.deaths).toBe(0);
  });

  it('forgets the bot hits that would credit the person later', () => {
    const { match, sim } = started();
    tickTo(match, DROP_S + 5);
    const self = match.players.get(1)!.unitId;
    const seat = champions(sim).find((u) => u.id !== self)!;
    for (const o of champions(sim)) {
      if (o.id === seat.id) continue;
      o.recentDamagers = [{ id: seat.id, at: sim.time }];
      o.lastHitByChampion = seat.id;
      o.lastHitAt = sim.time;
    }
    match.takeBotSeat(person(2, seat.championId!));
    for (const o of champions(sim)) {
      if (o.id === seat.id) continue;
      expect(o.recentDamagers).toEqual([]);
      expect(o.lastHitByChampion).toBe(0);
    }
  });

  it('arrives in One life during the calm as well, never during the drop', () => {
    const one = started('one_life');
    tickTo(one.match, DROP_S + CALM_S / 2);
    const p = one.match.takeBotSeat(person(2))!;
    expect(one.sim.royale!.arriving.has(p.unitId)).toBe(true);
    expect(one.match.replayEvents.some((e) => e.e === 'arrive')).toBe(true);

    const drop = started('respawn');
    tickTo(drop.match, DROP_S / 2);
    const rng = drop.sim.rng.state;
    const q = drop.match.takeBotSeat(person(2))!;
    expect(drop.sim.royale!.arriving.size).toBe(0);
    expect(drop.sim.rng.state).toBe(rng);
    expect(drop.match.replayEvents.some((e) => e.e === 'arrive')).toBe(false);
    expect(drop.sim.units.get(q.unitId)!.statuses).toEqual([]);
  });

  it('re-simulates alike from the replay', () => {
    const { match, sim } = started('respawn', 23);
    tickTo(match, DROP_S + 20);
    match.takeBotSeat(person(2));
    tickTo(match, DROP_S + 40);
    const live = match.replayRecord()!;
    const record = { ...live, picks: [...live.picks] };
    const replay = loadRoyaleReplay(loadPlanet(), record)!;
    const teams = new Map<number, number>();
    for (const u of champions(replay.sim)) teams.set(u.id, u.team);
    const events = [...record.events];
    while (replay.sim.tickCount < record.ticks) {
      while (events.length > 0 && events[0]!.k === replay.sim.tickCount) {
        applyReplayEvent(replay.sim, teams, events.shift()!);
      }
      replay.sim.tick();
    }
    expect(replay.sim.checksum()).toBe(sim.checksum());
    // And without the arrive event, it does not.
    const without = loadRoyaleReplay(loadPlanet(), record)!;
    const rest = record.events.filter((e) => e.e !== 'arrive');
    while (without.sim.tickCount < record.ticks) {
      while (rest.length > 0 && rest[0]!.k === without.sim.tickCount) {
        applyReplayEvent(without.sim, teams, rest.shift()!);
      }
      without.sim.tick();
    }
    expect(without.sim.checksum()).not.toBe(sim.checksum());
  });
});

// A ground that notes every point it answers walkable or snaps to: the
// candidates a draw weighed.
function noting(ground: RoyaleGround): { ground: RoyaleGround; seen: Vec3[] } {
  const seen: Vec3[] = [];
  return {
    seen,
    ground: {
      walkable: (p) => {
        const ok = ground.walkable(p);
        if (ok) seen.push(p);
        return ok;
      },
      nearestWalkable: (p) => {
        const q = ground.nearestWalkable(p);
        if (q) seen.push(q);
        return q;
      },
    },
  };
}

describe('the quiet spot', () => {
  const mode = landed().sim.royaleMode!;
  const layout = mode.layout;
  const ground = mode.ground;
  const R = layout.radius;
  const center = layout.regions[0]!.heart;
  const small: DuskCap = { center, radius: 30 };

  it('keeps ARRIVAL_QUIET_M from everyone and ARRIVAL_DEPTH_M inside the light', () => {
    const others = [center];
    const light: DuskCap = { center, radius: 45 };
    for (let seed = 1; seed <= 8; seed++) {
      const p = arrivalSpot(new Rng(seed), light, others, layout, ground);
      expect(insideCap(light, p)).toBe(true);
      expect(depthInside(light, p)).toBeGreaterThanOrEqual(ARRIVAL_DEPTH_M - 1e-9);
      expect(ground.walkable(p)).toBe(true);
      expect(dist(p, center)).toBeGreaterThanOrEqual(ARRIVAL_QUIET_M);
    }
    // The whole planet's light: anywhere walkable.
    const whole: DuskCap = { center, radius: 2 * R };
    const p = arrivalSpot(new Rng(3), whole, others, layout, ground);
    expect(dist(p, center)).toBeGreaterThanOrEqual(ARRIVAL_QUIET_M);
  });

  it('takes the farthest point drawn when the light leaves no quiet room', () => {
    // Champions everywhere in a small light: no point is 25 m from all.
    const crowd: Vec3[] = [];
    const rng = new Rng(99);
    for (let i = 0; i < 40; i++) crowd.push(arrivalSpot(rng, small, [], layout, ground));
    const seed = 5;
    const { ground: g, seen } = noting(ground);
    const p = arrivalSpot(new Rng(seed), small, crowd, layout, g);
    const nearest = (q: Vec3) => Math.min(...crowd.map((c) => dist(q, c)));
    expect(nearest(p)).toBeLessThan(ARRIVAL_QUIET_M);
    const candidates = seen.filter(
      (q) => insideCap(small, q) && depthInside(small, q) >= ARRIVAL_DEPTH_M,
    );
    expect(candidates.length).toBeGreaterThan(10);
    const best = Math.max(...candidates.map(nearest));
    expect(nearest(p)).toBeCloseTo(best, 9);
    // The same stream, the same spot.
    expect(arrivalSpot(new Rng(seed), small, crowd, layout, ground)).toEqual(p);
  });

  it('brings a Respawn return to the edge candidate farthest from every enemy', () => {
    // Two enemies inside the light, off its center.
    const enemies = [
      along(center, randomHeading(new Rng(1), center), 12, R),
      along(center, randomHeading(new Rng(2), center), 40, R),
    ];
    for (const cap of [small, { center, radius: 60 }]) {
      const { ground: g, seen } = noting(ground);
      const p = edgeOfLight(new Rng(7), cap, enemies, layout, g);
      const nearest = (q: Vec3) => Math.min(...enemies.map((e) => dist(q, e)));
      const candidates = seen.filter((q) => insideCap(cap, q));
      expect(candidates.length).toBeGreaterThan(1);
      expect(nearest(p)).toBeCloseTo(Math.max(...candidates.map(nearest)), 9);
      // Not merely the first one drawn.
      expect(candidates.some((q) => nearest(q) < nearest(p) - 1e-6)).toBe(true);
    }
  });
});
