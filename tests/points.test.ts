// Points (server/points.ts, ADR 0027): what each action pays, the weight
// the humans in the match put on it, the end bonus only for a seat still
// playing, and a seat that changes hands earning nothing for the bot that
// held it. Read off a small world first, then off a real match.

import { describe, expect, it } from 'vitest';
import { fillWithBots, TEAM_SIZE } from '../server/bot_fill';
import { gentleTeams } from '../server/guests';
import { Match, type MatchPick } from '../server/match';
import {
  ACTIVE_END_TICKS,
  bankAwards,
  botsWeight,
  GENTLE_WEIGHT,
  humanSeats,
  humansWeight,
  MatchPoints,
  POINTS,
  type PointsSeat,
  type PointsUnit,
  type PointsWorld,
  pointsWeight,
  weighted,
} from '../server/points';
import type { ServerMsg } from '../src/net/protocol';
import type { SimEvent } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';

interface World extends PointsWorld {
  units: Map<number, PointsUnit>;
  objectives: { wardenId: number | null };
  tickCount: number;
}

const champ = (team: TeamId): PointsUnit => ({
  kind: 'champion',
  team,
  kills: 0,
  assists: 0,
  cs: 0,
});
const body = (kind: string, team: TeamId): PointsUnit => ({
  kind,
  team,
  kills: 0,
  assists: 0,
  cs: 0,
});

// Two champions (1 blue, 2 red), a tower each (11 blue, 12 red), a camp
// body (21) and nothing else.
function world(): World {
  return {
    units: new Map<number, PointsUnit>([
      [1, champ(0)],
      [2, champ(1)],
      [3, champ(0)],
      [11, body('tower', 0)],
      [12, body('tower', 1)],
      [21, body('camp', 1)],
    ]),
    objectives: { wardenId: null },
    tickCount: 1000,
  };
}

const seat = (clientId: number, unitId: number, team: TeamId, owner = clientId): PointsSeat => ({
  clientId,
  owner,
  unitId,
  team,
  lastCommandAt: 990,
});

const unit = (w: World, id: number): PointsUnit => {
  const u = w.units.get(id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};

const death = (unitId: number, killerId: number): SimEvent => ({ type: 'death', unitId, killerId });

// The awards of one observed tick, as reason -> delta per client.
function tally(awards: { clientId: number; reason: string; delta: number }[]): string[] {
  return awards.map((a) => `${a.clientId}:${a.reason}:${a.delta}`).sort();
}

describe('the weight', () => {
  it('is one alone, one and a half with a human beside, two with one opposite', () => {
    expect(pointsWeight(0, [1, 0])).toBe(1);
    expect(pointsWeight(0, [2, 0])).toBe(1.5);
    expect(pointsWeight(0, [1, 1])).toBe(2);
    expect(pointsWeight(0, [3, 1])).toBe(2);
    expect(pointsWeight(1, [0, 1])).toBe(1);
    expect(pointsWeight(1, [0, 2])).toBe(1.5);
    expect(pointsWeight(1, [1, 1])).toBe(2);
  });

  it('halves for a seat facing the Gentle player, and multiplies with the people', () => {
    // `gentle` names the teams whose house lane seats play the Gentle
    // player: team 1 here, the lone Guest's enemies.
    expect(pointsWeight(0, [1, 0], [1])).toBe(0.5);
    expect(pointsWeight(0, [2, 0], [1])).toBe(0.75);
    expect(pointsWeight(0, [1, 1], [])).toBe(2);
    expect(pointsWeight(0, [1, 0], [])).toBe(1);
    // A newcomer dropping in on the Gentle side faces the drawn styles, and
    // the first Guest, facing Gentle bots, now has a human opponent.
    expect(pointsWeight(1, [1, 1], [1])).toBe(2);
    expect(pointsWeight(0, [1, 1], [1])).toBe(1);
    expect(humansWeight(0, [2, 0])).toBe(1.5);
    expect(botsWeight(0, [1])).toBe(GENTLE_WEIGHT);
    expect(botsWeight(1, [1])).toBe(1);
  });

  it('rounds each weighted action to an integer', () => {
    expect(weighted(POINTS.last_hit, 1.5)).toBe(2);
    expect(weighted(POINTS.assist, 1.5)).toBe(8);
    expect(weighted(POINTS.tower, 1.5)).toBe(23);
    expect(weighted(POINTS.kill, 2)).toBe(20);
    expect(weighted(POINTS.victory, 1)).toBe(50);
  });

  it('pays the numbers the maintainer set', () => {
    expect(POINTS).toEqual({
      last_hit: 1,
      kill: 10,
      assist: 5,
      tower: 15,
      creature: 15,
      ascendant: 25,
      victory: 50,
      finish: 15,
    });
    expect(ACTIVE_END_TICKS).toBe(3 * 60 * 20);
  });
});

describe('the actions', () => {
  it('pays last hits, kills and assists off the counters, from the second look on', () => {
    const w = world();
    const points = new MatchPoints(w);
    const seats = [seat(7, 1, 0)];
    // The first look only takes the line: nothing before it is paid.
    unit(w, 1).cs = 5;
    expect(points.observe(w, [], seats)).toEqual([]);
    unit(w, 1).cs = 7;
    unit(w, 1).kills = 1;
    unit(w, 1).assists = 2;
    expect(tally(points.observe(w, [], seats))).toEqual([
      '7:assist:10',
      '7:kill:10',
      '7:last_hit:2',
    ]);
    // Deaths cost nothing.
    expect(points.observe(w, [death(1, 2)], seats)).toEqual([]);
  });

  it('weighs every action by the humans connected at that moment', () => {
    const w = world();
    const points = new MatchPoints(w);
    const together = [seat(7, 1, 0), seat(8, 3, 0)];
    points.observe(w, [], together);
    unit(w, 1).cs = 3;
    expect(tally(points.observe(w, [], together))).toEqual(['7:last_hit:6']);
    // A human on the other team doubles it.
    const apart = [seat(7, 1, 0), seat(9, 2, 1)];
    points.observe(w, [], apart);
    unit(w, 1).kills = 1;
    expect(tally(points.observe(w, [], apart))).toEqual(['7:kill:20']);
  });

  it('pays a lone Guest facing the Gentle player half, rounded', () => {
    const w = world();
    const points = new MatchPoints(w, [1]);
    const seats = [seat(7, 1, 0, -7)];
    points.observe(w, [], seats);
    unit(w, 1).cs = 1;
    unit(w, 1).kills = 1;
    unit(w, 1).assists = 1;
    // A last hit still pays its point: a half rounds up.
    expect(tally(points.observe(w, [], seats))).toEqual(['7:assist:3', '7:kill:5', '7:last_hit:1']);
    w.units.delete(12);
    expect(tally(points.observe(w, [death(12, 1)], seats))).toEqual(['7:tower:8']);
  });

  it('pays a camp body to the seat that last-hit it, and nobody else', () => {
    const w = world();
    const points = new MatchPoints(w);
    const seats = [seat(7, 1, 0), seat(8, 3, 0)];
    points.observe(w, [], seats);
    w.units.delete(21);
    expect(tally(points.observe(w, [death(21, 1)], seats))).toEqual(['7:last_hit:2']);
    // A body a bot took pays no one.
    w.units.set(22, body('camp', 1));
    points.observe(w, [], seats);
    w.units.delete(22);
    expect(points.observe(w, [death(22, 2)], seats)).toEqual([]);
  });

  it('pays a tower to every human of the team that took it, once', () => {
    const w = world();
    const points = new MatchPoints(w);
    const seats = [seat(7, 1, 0), seat(8, 3, 0), seat(9, 2, 1)];
    points.observe(w, [], seats);
    w.units.delete(12);
    // A minion's last hit is the team's tower all the same.
    expect(tally(points.observe(w, [death(12, 55)], seats))).toEqual(['7:tower:30', '8:tower:30']);
    expect(points.observe(w, [death(12, 55)], seats)).toEqual([]);
  });

  it('pays a creature, the Warden and an Ascendant to the team that took it', () => {
    const w = world();
    w.units.set(30, body('warden', 0));
    w.objectives.wardenId = 30;
    const points = new MatchPoints(w);
    const seats = [seat(7, 1, 0), seat(9, 2, 1)];
    points.observe(w, [], seats);
    const favor: SimEvent = { type: 'favor', team: 1, aspect: 'tide', creature: 'pyrefang' };
    expect(tally(points.observe(w, [favor], seats))).toEqual(['9:creature:30']);
    const wrath: SimEvent = { type: 'wrath', team: 0, creature: 'pyrefang' };
    expect(tally(points.observe(w, [wrath], seats))).toEqual(['7:ascendant:50']);
    w.units.delete(30);
    w.objectives.wardenId = null;
    expect(tally(points.observe(w, [death(30, 1)], seats))).toEqual(['7:creature:30']);
  });

  it('pays only the seats connected by hand: a unit nobody holds earns nothing', () => {
    const w = world();
    const points = new MatchPoints(w);
    points.observe(w, [], [seat(7, 1, 0)]);
    unit(w, 2).cs = 10;
    unit(w, 2).kills = 3;
    expect(points.observe(w, [], [seat(7, 1, 0)])).toEqual([]);
  });

  it('pays nothing for what the stand-in did while the player was away', () => {
    const w = world();
    const points = new MatchPoints(w);
    const seats = [seat(7, 1, 0)];
    points.observe(w, [], seats);
    // The player leaves: the bot farms in their seat.
    points.observe(w, [], []);
    unit(w, 1).cs = 20;
    points.observe(w, [], []);
    // Back (a rejoin, or a drop-in taking a bot's seat): from here on.
    expect(points.observe(w, [], seats)).toEqual([]);
    unit(w, 1).cs = 21;
    expect(tally(points.observe(w, [], seats))).toEqual(['7:last_hit:1']);
  });
});

describe('the end', () => {
  it('pays the winners fifty and the losers fifteen, to a seat still playing', () => {
    const w = world();
    const points = new MatchPoints(w);
    const idle: PointsSeat = {
      ...seat(8, 3, 0),
      lastCommandAt: w.tickCount - ACTIVE_END_TICKS - 1,
    };
    const seats = [seat(7, 1, 0), idle, seat(9, 2, 1)];
    points.observe(w, [], seats);
    const victory: SimEvent = { type: 'victory', team: 0 };
    // Two humans on the winning side and one against: everything doubles.
    expect(tally(points.observe(w, [victory], seats))).toEqual(['7:victory:100', '9:finish:30']);
    // And nothing after it.
    unit(w, 1).kills = 4;
    expect(points.observe(w, [victory], seats)).toEqual([]);
  });

  it('counts a command three minutes before the end as playing', () => {
    const w = world();
    const points = new MatchPoints(w);
    const seats = [{ ...seat(7, 1, 0), lastCommandAt: w.tickCount - ACTIVE_END_TICKS }];
    points.observe(w, [], seats);
    expect(tally(points.observe(w, [{ type: 'victory', team: 1 }], seats))).toEqual([
      '7:finish:15',
    ]);
  });
});

describe('banking', () => {
  it('tells each award to its own player, with the total it makes, and no one else', () => {
    const w = world();
    const points = new MatchPoints(w);
    const seats = [seat(7, 1, 0, 70), seat(9, 2, 1, -90)];
    points.observe(w, [], seats);
    w.units.delete(12);
    const sent: [number, ServerMsg][] = [];
    const banked: [number, number][] = [];
    bankAwards(
      points.observe(w, [death(12, 1)], seats),
      (owner, delta) => {
        banked.push([owner, delta]);
        return 1000 + delta;
      },
      (clientId, msg) => sent.push([clientId, msg]),
    );
    expect(banked).toEqual([[70, 30]]);
    expect(sent).toEqual([[7, { t: 'points', delta: 30, total: 1030, reason: 'tower' }]]);
  });

  it('tells nothing when the line could not be banked', () => {
    const sent: unknown[] = [];
    bankAwards(
      [{ clientId: 7, owner: -3, reason: 'kill', delta: 10 }],
      () => null,
      (_c, msg) => sent.push(msg),
    );
    expect(sent).toEqual([]);
  });

  it('reads the human seats off the match: connected, by hand, never a coach', () => {
    const players = [
      { clientId: 1, team: 0 as const, unitId: 5, lastCommandAt: 40, coach: false },
      { clientId: 2, team: 1 as const, unitId: 6, lastCommandAt: 41, coach: true },
      { clientId: 3, team: 1 as const, unitId: 7, lastCommandAt: 42, coach: false },
    ];
    const owners = new Map([
      [1, 11],
      [2, 12],
    ]);
    expect(humanSeats(players, (cid) => owners.get(cid) ?? null)).toEqual([
      { clientId: 1, owner: 11, unitId: 5, team: 0, lastCommandAt: 40 },
    ]);
  });
});

describe('over a real match', () => {
  const alice: MatchPick = {
    clientId: 1,
    name: 'alice',
    team: 0,
    championId: 'vesk',
    sigils: ['riftstep', 'mend'],
  };

  it('weighs a lone Guest by the Gentle player its match start seated', () => {
    // What onMatchReady does: the Gentle teams off the picks, the fill,
    // and the tracker holding the same decision for the whole match.
    const guest: MatchPick = { ...alice, accountId: -5 };
    const gentle = gentleTeams(true, [guest]);
    expect(gentle).toEqual([1]);
    const match = new Match(7, fillWithBots([guest], 7, TEAM_SIZE, [], gentle));
    const points = new MatchPoints(match.sim, gentle);
    const seats = humanSeats(match.players.values(), () => -5);
    points.observe(match.sim, [], seats);
    const redTower = [...match.sim.units.values()].find((u) => u.kind === 'tower' && u.team === 1);
    expect(tally(points.observe(match.sim, [death(redTower?.id ?? -1, 999)], seats))).toEqual([
      '1:tower:8',
    ]);
    // With an account in the match nobody plays Gentle, and the whole pays.
    expect(gentleTeams(true, [{ ...alice, accountId: 12 }])).toEqual([]);
  });

  it('knows the towers from the start and pays one that falls to the other team', () => {
    const match = new Match(7, [alice]);
    const points = new MatchPoints(match.sim);
    const seats = humanSeats(match.players.values(), () => 42);
    expect(seats.map((s) => s.owner)).toEqual([42]);
    match.tick();
    expect(points.observe(match.sim, match.lastEvents, seats)).toEqual([]);
    const redTower = [...match.sim.units.values()].find((u) => u.kind === 'tower' && u.team === 1);
    const blueTower = [...match.sim.units.values()].find((u) => u.kind === 'tower' && u.team === 0);
    expect(redTower && blueTower).toBeTruthy();
    const deaths = [death(redTower?.id ?? -1, 999), death(blueTower?.id ?? -1, 999)];
    expect(tally(points.observe(match.sim, deaths, seats))).toEqual(['1:tower:15']);
  });
});
