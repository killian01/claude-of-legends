// The Arrival (CONTEXT.md; src/sim/royale/grace.ts arrive): a person who
// drops into a running match takes a bot's seat and the champion comes down
// fresh inside the light, in its Grace, its tally from zero (a playtest,
// 2026-10-04: a person took a seat mid-fight at half health and was slain
// five seconds after joining, with the bot's score and kills). In Respawn
// it comes down at the field's level, a few steps from a fair first fight
// when a bot offers one, else at a quiet spot (ADR 0031, amended
// 2026-10-08). Recorded as an 'arrive' replay event, so a replay
// re-simulates it alike. The quiet spot (drop.ts arrivalSpot), the fair
// foe's (drop.ts fairFoeSpot) and the Respawn return's point (score.ts
// edgeOfLight) are pinned on the real Wanderseed.

import { describe, expect, it } from 'vitest';
import { royaleFactory } from '../server/royale_build';
import { RoyaleMatch } from '../server/royale_match';
import type { RoyalePerson } from '../server/royale_seats';
import { applyReplayEvent, loadRoyaleReplay } from '../src/net/replay';
import { DUSK_PHASES } from '../src/sim/content/dusk';
import { dist, type Vec3 } from '../src/sim/geo';
import { Rng } from '../src/sim/rng';
import {
  ARRIVAL_DEPTH_M,
  ARRIVAL_QUIET_M,
  arrivalSpot,
  FOE_CLEAR_M,
  FOE_MAX_M,
  FOE_MIN_M,
  type FoeCandidate,
  fairFoeSpot,
} from '../src/sim/royale/drop';
import { depthInside, insideCap } from '../src/sim/royale/dusk';
import {
  ARRIVAL_GRACE_MAX_S,
  ARRIVAL_GRACE_S,
  beginGrace,
  endGrace,
} from '../src/sim/royale/grace';
import { along, type RoyaleGround, randomHeading } from '../src/sim/royale/layout';
import { ARRIVAL_LEVEL_BEHIND } from '../src/sim/royale/levels';
import { edgeOfLight, returnCap } from '../src/sim/royale/score';
import {
  CALM_S,
  DROP_S,
  type DuskCap,
  OUT_OF_COMBAT_S,
  START_LEVEL,
} from '../src/sim/royale/types';
import type { Sim } from '../src/sim/sim';
import { effectiveRank, levelTo } from '../src/sim/stats';
import type { Unit } from '../src/sim/unit';
import { brushIndexAt, inMutualSight, sightBlocked } from '../src/sim/vision';
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
    // Every bot just hit: no fair first fight, the quiet spot.
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
    // In its Grace, which waits on the seat's first order past
    // ARRIVAL_GRACE_S, ARRIVAL_GRACE_MAX_S at most (tests/royale_grace_wait.test.ts).
    expect(sim.royale!.arriving.has(u.id)).toBe(true);
    expect(sim.royaleMode!.graces.get(u.id)).toEqual({
      since: sim.time,
      until: sim.time + ARRIVAL_GRACE_MAX_S,
      orderEndsFrom: sim.time + ARRIVAL_GRACE_S,
      ordered: false,
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
    // Beside a fair first fight, its draws from the match's stream.
    expect(sim.royaleMode!.tally.fairArrivals).toBe(1);
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

// A Respawn Arrival's fair first fight (grace.ts arrive, drop.ts
// fairFoeSpot) and its level (levels.ts arrivalLevel): a scene on a running
// match, the seat arriving one of its bots (its policy detached as the
// server does), the foes left alone at their spots, out of combat and of
// any Grace, at the seat's level; everyone else in a fight on the far side
// of the planet.
function fairScene(sim: Sim, seat: Unit, foes: readonly Unit[], spots: readonly Vec3[]): void {
  const mode = sim.royaleMode!;
  const far = spots[0]!;
  const level = Math.max(...champions(sim).map((u) => u.level));
  levelTo(seat, level);
  for (const u of champions(sim)) {
    if (u.id === seat.id) continue;
    u.path = [];
    const i = foes.indexOf(u);
    if (i >= 0) {
      levelTo(u, level);
      endGrace(mode, u);
      u.dead = false;
      u.hp = u.maxHp;
      u.pos = { ...spots[i]! };
      u.lastDamagedAt = -999;
      u.lastDealtDamageAt = -999;
      continue;
    }
    u.pos = { x: -far.x, y: -far.y!, z: -far.z };
    u.lastDamagedAt = sim.time;
  }
}

function bots(match: RoyaleMatch, sim: Sim): Unit[] {
  const self = match.players.get(1)!.unitId;
  return champions(sim).filter((u) => u.id !== self && sim.policies.has(u.id));
}

// The seat's Arrival as the server makes it (RoyaleMatch.takeBotSeat).
function arriveAt(sim: Sim, seat: Unit): Vec3 {
  sim.detachPolicy(seat.id);
  sim.beginArrival(seat.id);
  return seat.pos as Vec3;
}

// A walkable point `m` from p, toward a heading drawn from `seed`.
function walkableFrom(sim: Sim, p: Vec3, m: number, seed: number): Vec3 {
  const mode = sim.royaleMode!;
  const q = along(p, randomHeading(new Rng(seed), p), m, mode.layout.radius);
  return mode.ground.nearestWalkable(q) ?? q;
}

function quietKept(sim: Sim, seat: Unit): void {
  for (const o of champions(sim)) {
    if (o.id === seat.id || o.dead) continue;
    expect(dist(seat.pos, o.pos)).toBeGreaterThanOrEqual(ARRIVAL_QUIET_M);
  }
}

describe('a Respawn Arrival meets a fair first fight', () => {
  it('lands a few steps from a lone gentle bot out of combat, deep in the light, graced', () => {
    const { match, sim } = started();
    const mode = sim.royaleMode!;
    // A closing phase: the light it closes to is the one that counts.
    tickTo(match, DROP_S + DUSK_PHASES[0]!.closeFrom + 30);
    expect(mode.state.dusk.shrinking).toBe(true);
    const cap = returnCap(mode.state.dusk);
    const [seat, foe] = bots(match, sim);
    mode.skills.set(foe!.id, 'gentle');
    // The foe stands inside the light it closes to, past the depth rule.
    const spot = mode.ground.nearestWalkable(cap.center)!;
    expect(depthInside(cap, spot)).toBeGreaterThan(FOE_MAX_M + ARRIVAL_DEPTH_M);
    fairScene(sim, seat!, [foe!], [spot]);
    const fair = mode.tally.fairArrivals;
    const at = arriveAt(sim, seat!);
    expect(mode.tally.fairArrivals).toBe(fair + 1);
    const d = dist(at, foe!.pos);
    expect(d).toBeGreaterThanOrEqual(FOE_MIN_M - 1);
    expect(d).toBeLessThanOrEqual(FOE_MAX_M + 1);
    // Inside both champions' sight, nothing between them.
    expect(d).toBeLessThan(foe!.sightRange);
    expect(d).toBeLessThan(seat!.sightRange);
    expect(inMutualSight(sim.map, at, foe!.pos)).toBe(true);
    expect(insideCap(cap, at)).toBe(true);
    expect(depthInside(cap, at)).toBeGreaterThanOrEqual(ARRIVAL_DEPTH_M);
    expect(mode.ground.walkable(at)).toBe(true);
    // Nobody else near either of them.
    for (const o of champions(sim)) {
      if (o.id === seat!.id || o.id === foe!.id) continue;
      expect(dist(at, o.pos)).toBeGreaterThan(FOE_CLEAR_M);
    }
    expect(sim.royale!.arriving.has(seat!.id)).toBe(true);
    expect(seat!.hp).toBe(seat!.maxHp);
  });

  it('never beside a bot in combat, above the seat in level, in its Grace, or with company', () => {
    const cases: ((sim: Sim, foe: Unit, seat: Unit, other: Unit) => void)[] = [
      (sim, foe) => {
        foe.lastDealtDamageAt = sim.time - OUT_OF_COMBAT_S + 1;
      },
      (sim, foe) => {
        foe.lastDamagedAt = sim.time - OUT_OF_COMBAT_S + 1;
      },
      (_sim, foe, seat) => {
        levelTo(foe, seat.level + 1);
      },
      (sim, foe, _seat, other) => {
        other.pos = walkableFrom(sim, foe.pos as Vec3, FOE_CLEAR_M - 4, 3);
      },
      // Back from a death, in its own Grace.
      (sim, foe) => {
        beginGrace(sim.royaleMode!, foe, sim.time - 1);
      },
    ];
    for (const change of cases) {
      const { match, sim } = started();
      const mode = sim.royaleMode!;
      tickTo(match, DROP_S + 30);
      const [seat, foe, other] = bots(match, sim);
      mode.skills.set(foe!.id, 'gentle');
      fairScene(sim, seat!, [foe!], [foe!.pos as Vec3]);
      change(sim, foe!, seat!, other!);
      arriveAt(sim, seat!);
      expect(mode.tally.fairArrivals).toBe(0);
      quietKept(sim, seat!);
      expect(sim.royale!.arriving.has(seat!.id)).toBe(true);
    }
  });

  it('takes a gentle bot before a normal one, and one sharpened by 2 takedowns as normal', () => {
    const near = (score: number) => {
      const { match, sim } = started();
      const mode = sim.royaleMode!;
      tickTo(match, DROP_S + 30);
      const [seat, gentle, normal] = bots(match, sim);
      mode.skills.set(gentle!.id, 'gentle');
      mode.skills.set(normal!.id, 'normal');
      mode.state.scores.set(gentle!.id, score);
      // The gentle one deep in the light (where the bot happened to walk
      // to moves with the seats the roster deals): the order is the rule.
      const a = mode.ground.nearestWalkable(returnCap(mode.state.dusk).center)!;
      fairScene(sim, seat!, [gentle!, normal!], [a, walkableFrom(sim, a, 60, 1)]);
      // The normal one a little worn: the softer of two normal bots.
      normal!.hp = normal!.maxHp * 0.9;
      const at = arriveAt(sim, seat!);
      expect(mode.tally.fairArrivals).toBe(1);
      return dist(at, gentle!.pos) < dist(at, normal!.pos) ? 'gentle' : 'normal';
    };
    expect(near(0)).toBe('gentle');
    expect(near(1)).toBe('gentle');
    expect(near(2)).toBe('normal');
  });
});

describe('a Respawn Arrival at the field level', () => {
  it('lifts a seat under the field to one level below its lower median, nothing offered for it', () => {
    const { match, sim } = started();
    const mode = sim.royaleMode!;
    tickTo(match, DROP_S + 30);
    const self = match.players.get(1)!.unitId;
    const seat = bots(match, sim).find((u) => u.level === START_LEVEL)!;
    for (const o of champions(sim)) if (o.id !== seat.id) levelTo(o, 9);
    // One of them down: the fallen count too.
    sim.units.get(self)!.dead = true;
    const maxBefore = seat.maxHp;
    const offers = (mode.state.offers.get(seat.id) ?? []).length;
    arriveAt(sim, seat);
    expect(seat.level).toBe(9 - ARRIVAL_LEVEL_BEHIND);
    expect(seat.maxHp).toBeGreaterThan(maxBefore);
    expect(seat.hp).toBe(seat.maxHp);
    expect(seat.mana).toBe(seat.maxMana);
    expect(seat.skillPoints).toBe(0);
    expect(effectiveRank(seat, 'R')).toBe(1);
    // The Arrival's own Bough, and none for levels 5 and 7.
    const now = (mode.state.offers.get(seat.id) ?? []).filter((o) => o.offeredAt === sim.time);
    expect(now.map((o) => o.grade)).toEqual(['bough']);
    expect((mode.state.offers.get(seat.id) ?? []).length).toBe(offers + 1);
  });

  it('keeps the level of a seat above the field', () => {
    const { match, sim } = started();
    tickTo(match, DROP_S + 30);
    const seat = bots(match, sim)[0]!;
    for (const o of champions(sim)) if (o.id !== seat.id) levelTo(o, 9);
    levelTo(seat, 10);
    seat.xp = 40;
    arriveAt(sim, seat);
    expect(seat.level).toBe(10);
    expect(seat.xp).toBe(40);
  });

  it('leaves One life alone: a quiet spot in the calm, the level kept', () => {
    const { match, sim } = started('one_life');
    const mode = sim.royaleMode!;
    tickTo(match, DROP_S + CALM_S / 2);
    const [seat, foe] = bots(match, sim);
    mode.skills.set(foe!.id, 'gentle');
    fairScene(sim, seat!, [foe!], [foe!.pos as Vec3]);
    for (const o of champions(sim)) if (o.id !== seat!.id && o.id !== foe!.id) levelTo(o, 9);
    const level = seat!.level;
    arriveAt(sim, seat!);
    expect(seat!.level).toBe(level);
    expect(mode.tally.fairArrivals).toBe(0);
    quietKept(sim, seat!);
  });
});

describe('the fair foe spot', () => {
  const mode = landed().sim.royaleMode!;
  const layout = mode.layout;
  const ground = mode.ground;
  const R = layout.radius;
  const center = layout.regions[0]!.heart;
  const foe = (id: number, pos: Vec3, soft = 0, hpShare = 1, level = 5): FoeCandidate => ({
    id,
    pos,
    soft,
    hpShare,
    level,
  });
  // Nothing hides the foe (the sight case below has its own).
  const sees = (): boolean => true;

  it('keeps every landing in the band, deep in a small light, clear of the others', () => {
    const light: DuskCap = { center, radius: 30 };
    // A foe near the light's edge: only the draws on the inner side hold.
    let edge: Vec3 | null = null;
    for (let s = 1; s < 60 && !edge; s += 0.5) {
      const q = along(center, randomHeading(new Rng(4), center), s, R);
      if (ground.walkable(q) && depthInside(light, q) <= ARRIVAL_DEPTH_M + 2) edge = q;
    }
    expect(edge).not.toBeNull();
    let found = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const got = fairFoeSpot(new Rng(seed), light, [foe(7, edge!)], [], layout, ground, sees);
      if (!got) continue;
      found++;
      expect(got.foeId).toBe(7);
      expect(depthInside(light, got.at)).toBeGreaterThanOrEqual(ARRIVAL_DEPTH_M - 1e-9);
      expect(dist(got.at, edge!)).toBeGreaterThanOrEqual(FOE_MIN_M - 1);
      expect(dist(got.at, edge!)).toBeLessThanOrEqual(FOE_MAX_M + 1);
      expect(ground.walkable(got.at)).toBe(true);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('weighs the softest first, passes a crowded foe over, and draws from the stream alike', () => {
    const whole: DuskCap = { center, radius: 2 * R };
    const a = center;
    const b = along(center, randomHeading(new Rng(1), center), 60, R);
    const pick = (foes: FoeCandidate[], others: { id: number; pos: Vec3 }[] = []) =>
      fairFoeSpot(new Rng(9), whole, foes, others, layout, ground, sees)?.foeId ?? null;
    expect(pick([foe(1, a, 1), foe(2, b, 0)])).toBe(2);
    expect(pick([foe(1, a, 0, 0.5), foe(2, b, 0, 0.9)])).toBe(1);
    expect(pick([foe(1, a, 0, 1, 6), foe(2, b, 0, 1, 4)])).toBe(2);
    expect(pick([foe(3, a), foe(2, b)])).toBe(2);
    // A third champion beside the softest: the next one.
    const beside = along(b, randomHeading(new Rng(2), b), FOE_CLEAR_M - 2, R);
    expect(pick([foe(1, a, 1), foe(2, b, 0)], [{ id: 9, pos: beside }])).toBe(1);
    // Only the foe itself near: no company.
    expect(pick([foe(2, b, 0)], [{ id: 2, pos: b }])).toBe(2);
    expect(pick([])).toBeNull();
    const same = (seed: number) =>
      fairFoeSpot(new Rng(seed), whole, [foe(1, a), foe(2, b, 1)], [], layout, ground, sees);
    expect(same(5)).toEqual(same(5));
  });

  it('keeps only a landing the foe and the newcomer see each other from', () => {
    const whole: DuskCap = { center, radius: 2 * R };
    const a = center;
    const b = along(center, randomHeading(new Rng(1), center), 60, R);
    // A bush or a rock between: one side of the softest foe only, then
    // none of it, then nowhere at all.
    const north = (p: Vec3, q: Vec3) => p.y! >= q.y!;
    for (let seed = 1; seed <= 8; seed++) {
      const got = fairFoeSpot(new Rng(seed), whole, [foe(1, a)], [], layout, ground, north);
      if (got) expect(got.at.y!).toBeGreaterThanOrEqual(a.y!);
    }
    const hidden = (_p: Vec3, q: Vec3) => dist(q, a) > 1;
    expect(
      fairFoeSpot(new Rng(3), whole, [foe(1, a), foe(2, b, 1)], [], layout, ground, hidden)?.foeId,
    ).toBe(2);
    expect(fairFoeSpot(new Rng(3), whole, [foe(1, a)], [], layout, ground, () => false)).toBeNull();
  });
});

// What the fair foe's spot asks of the sight line (vision.ts
// inMutualSight), on the Wanderseed's own bushes and rocks.
describe('two champions in sight of each other', () => {
  const sim = landed().sim;
  const map = sim.map;
  const R = sim.royaleMode!.layout.radius;
  const close = map.closeSight ?? 0;
  const at = (c: { x: number; y?: number; z: number }): Vec3 => ({ x: c.x, y: c.y!, z: c.z });
  // A point `m` from p in the first of a few headings that `keep` accepts.
  const away = (p: Vec3, m: number, keep: (q: Vec3) => boolean): Vec3 | null => {
    for (let seed = 1; seed <= 64; seed++) {
      const q = along(p, randomHeading(new Rng(seed), p), m, R);
      if (keep(q)) return q;
    }
    return null;
  };

  it('sees within close sight whatever stands between', () => {
    expect(close).toBeGreaterThan(0);
    const bush = at(map.brush[0]!);
    const near = away(bush, close - 0.5, (q) => brushIndexAt(map, q) === -1);
    if (near) expect(inMutualSight(map, bush, near)).toBe(true);
  });

  it('past close sight: never from a bush to outside it, always within one bush in the open', () => {
    const bush = map.brush.find((b) => b.r >= close / 2 + 1)!;
    const c = at(bush);
    const out = away(
      c,
      bush.r + close,
      (q) => brushIndexAt(map, q) === -1 && !sightBlocked(map, c, q),
    )!;
    expect(out).not.toBeNull();
    expect(inMutualSight(map, c, out)).toBe(false);
    expect(inMutualSight(map, out, c)).toBe(false);
    const h = randomHeading(new Rng(5), c);
    const a = along(c, h, close / 2 + 0.5, R);
    const b = along(c, h, -(close / 2 + 0.5), R);
    if (brushIndexAt(map, a) === brushIndexAt(map, b) && !sightBlocked(map, a, b)) {
      expect(dist(a, b)).toBeGreaterThan(close);
      expect(inMutualSight(map, a, b)).toBe(true);
    }
  });

  it('never across a rock', () => {
    const rock = map.walls.find((w) => w.r >= 2)!;
    const c = at(rock);
    const h = randomHeading(new Rng(2), c);
    const side = along(c, h, rock.r + 3, R);
    const other = along(c, h, -(rock.r + 3), R);
    expect(sightBlocked(map, side, other)).toBe(true);
    expect(inMutualSight(map, side, other)).toBe(false);
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
