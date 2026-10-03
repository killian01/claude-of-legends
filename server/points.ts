// Points (CONTEXT.md, ADR 0027): what a human seat earns in a classic
// public queue match for what it does there, times the match's weight at
// that moment (the people in it, and the bots it faces), banked on the
// player's line of the ladder as it comes. A player who leaves keeps every
// point already banked, and the bot that stands in for them earns nothing
// more on their behalf.
//
// Pure over what the sim already counts. The tracker keeps what the last
// tick left behind (each human seat's kills, assists and last hits, the
// towers still standing, the camp bodies alive, the Warden) and answers
// the awards the next tick earned; server/main.ts banks them and tells the
// scoring player, and nobody else.

import type { PointsReason, ServerMsg } from '../src/net/protocol';
import type { SimEvent } from '../src/sim/sim';
import { otherTeam } from '../src/sim/teams';
import { DT, type TeamId } from '../src/sim/types';

// What each action is worth before the weight.
export const POINTS: Readonly<Record<PointsReason, number>> = {
  // A minion or a camp body last-hit by the seat.
  last_hit: 1,
  kill: 10,
  assist: 5,
  // A tower the seat's team destroyed, to every human of that team.
  tower: 15,
  // A ring creature (its favor) or the Warden, taken by the team.
  creature: 15,
  // An Ascendant (the Wrath), taken by the team.
  ascendant: 25,
  // The end: the winning side, and the losing side that played it out.
  victory: 50,
  finish: 15,
};

// The end bonus goes to a seat that issued a command in the last three
// minutes of match time: a tab left open while the allied bots win pays
// nothing. The actions pay only when there are actions anyway.
export const ACTIVE_END_TICKS = Math.round((3 * 60) / DT);

// The weight the people put on an award, from the humans connected in the
// match at that moment by team, the scoring seat included: another human
// on any other team (ADR 0030) doubles it, another only on the seat's own
// team makes it one and a half.
export function humansWeight(team: TeamId, humansByTeam: readonly number[]): number {
  if (humansByTeam.some((n, t) => t !== team && n > 0)) return 2;
  if ((humansByTeam[team] ?? 0) > 1) return 1.5;
  return 1;
}

// The weight the bots put on it: a seat whose opposing lane seats play the
// Gentle player (server/guests.ts gentleTeams, decided at the match's
// start) earns half; against the drawn house styles, the whole.
export const GENTLE_WEIGHT = 0.5;
export function botsWeight(team: TeamId, gentle: readonly TeamId[]): number {
  return gentle.some((t) => t !== team) ? GENTLE_WEIGHT : 1;
}

// The weight of an award: the people's, times the bots'. `gentle` names
// the teams whose house lane seats play the Gentle player.
export function pointsWeight(
  team: TeamId,
  humansByTeam: readonly number[],
  gentle: readonly TeamId[] = [],
): number {
  return humansWeight(team, humansByTeam) * botsWeight(team, gentle);
}

// Points are integers; the weighted amount rounds, one action at a time.
export function weighted(base: number, weight: number): number {
  return Math.round(base * weight);
}

export function activeNearEnd(tickCount: number, lastCommandAt: number): boolean {
  return tickCount - lastCommandAt <= ACTIVE_END_TICKS;
}

// One human seat connected right now: a player's seat by hand, account or
// Guest. Coach seats and bots are never here.
export interface PointsSeat {
  clientId: number;
  // Who banks: an account id, or a Guest's negative id.
  owner: number;
  unitId: number;
  team: TeamId;
  // sim.tickCount of the seat's last command (server/match.ts).
  lastCommandAt: number;
}

export interface PointsAward {
  clientId: number;
  owner: number;
  reason: PointsReason;
  delta: number;
}

// The human seats of a match, read off its players: connected (`ownerOf`
// answers the account or Guest behind a client, null once it is gone), and
// played by hand, so a coach seat is not one.
export function humanSeats(
  players: Iterable<{
    clientId: number;
    team: TeamId;
    unitId: number;
    lastCommandAt: number;
    coach: boolean;
  }>,
  ownerOf: (clientId: number) => number | null,
): PointsSeat[] {
  const out: PointsSeat[] = [];
  for (const p of players) {
    if (p.coach) continue;
    const owner = ownerOf(p.clientId);
    if (owner === null) continue;
    out.push({
      clientId: p.clientId,
      owner,
      unitId: p.unitId,
      team: p.team,
      lastCommandAt: p.lastCommandAt,
    });
  }
  return out;
}

// Banks each award on its owner's line (`bank` answers the new total, or
// null when there is no line to bank on) and tells that player alone.
export function bankAwards(
  awards: readonly PointsAward[],
  bank: (owner: number, delta: number) => number | null,
  send: (clientId: number, msg: Extract<ServerMsg, { t: 'points' }>) => void,
): void {
  for (const a of awards) {
    const total = bank(a.owner, a.delta);
    if (total === null) continue;
    send(a.clientId, { t: 'points', delta: a.delta, total, reason: a.reason });
  }
}

// What the tracker reads of the sim: the units and their counters, the
// Warden standing, the clock. The Sim satisfies it as it is.
export interface PointsUnit {
  kind: string;
  team: TeamId;
  kills: number;
  assists: number;
  cs: number;
}
export interface PointsWorld {
  readonly units: ReadonlyMap<number, PointsUnit>;
  readonly objectives: { readonly wardenId: number | null };
  readonly tickCount: number;
}

interface Counters {
  owner: number;
  kills: number;
  assists: number;
  cs: number;
}

export class MatchPoints {
  // Each human seat's counters as the last tick left them, by unit id. A
  // seat that stops being human loses its line, so taking it back (a
  // rejoin, a drop-in) starts from what the unit holds then, never from
  // what a bot earned in between.
  private readonly seen = new Map<number, Counters>();
  // The towers still standing and the team each belongs to: fixed at the
  // start, and a tower falls once.
  private readonly towers = new Map<number, TeamId>();
  // The camp bodies alive at the end of the last tick. A body is gone from
  // the sim by the time its death is read, so it is known beforehand.
  private readonly camps = new Set<number>();
  private wardenId: number | null = null;
  // The match is over: the end bonus is paid once and nothing after it.
  private ended = false;

  // `gentle`: the teams whose house lane seats play the Gentle player, as
  // the match's start decided them (server/guests.ts gentleTeams), for the
  // bots' weight. Fixed for the match, like the styles it seated.
  constructor(
    world: PointsWorld,
    private readonly gentle: readonly TeamId[] = [],
  ) {
    for (const [id, u] of world.units) if (u.kind === 'tower') this.towers.set(id, u.team);
    this.note(world);
  }

  // After each tick: what it earned for the human seats connected now.
  observe(
    world: PointsWorld,
    events: readonly SimEvent[],
    seats: readonly PointsSeat[],
  ): PointsAward[] {
    if (this.ended) return [];
    const humans = [0, 0];
    for (const s of seats) humans[s.team] = (humans[s.team] ?? 0) + 1;
    const bySeat = new Map<number, PointsSeat>();
    for (const s of seats) bySeat.set(s.unitId, s);
    const earned = new Map<string, PointsAward>();
    const give = (seat: PointsSeat, reason: PointsReason, count = 1): void => {
      if (count <= 0) return;
      const weight = pointsWeight(seat.team, humans, this.gentle);
      const delta = count * weighted(POINTS[reason], weight);
      if (delta <= 0) return;
      const key = `${seat.clientId}:${reason}`;
      const had = earned.get(key);
      if (had) had.delta += delta;
      else earned.set(key, { clientId: seat.clientId, owner: seat.owner, reason, delta });
    };
    const team = (t: TeamId, reason: PointsReason): void => {
      for (const s of seats) if (s.team === t) give(s, reason);
    };

    // The seat's own counters: champion kills, assists, minions last-hit.
    for (const seat of seats) {
      const u = world.units.get(seat.unitId);
      if (!u) continue;
      const before = this.seen.get(seat.unitId);
      if (before && before.owner === seat.owner) {
        give(seat, 'kill', u.kills - before.kills);
        give(seat, 'assist', u.assists - before.assists);
        give(seat, 'last_hit', u.cs - before.cs);
      }
      this.seen.set(seat.unitId, {
        owner: seat.owner,
        kills: u.kills,
        assists: u.assists,
        cs: u.cs,
      });
    }
    for (const unitId of [...this.seen.keys()]) if (!bySeat.has(unitId)) this.seen.delete(unitId);

    // What the tick's events say: a camp body last-hit by a seat, a tower
    // or the Warden for a team, a creature's favor or an Ascendant's
    // Wrath, the end.
    for (const ev of events) {
      if (ev.type === 'death') {
        if (this.camps.delete(ev.unitId)) {
          const seat = bySeat.get(ev.killerId);
          if (seat) give(seat, 'last_hit');
          continue;
        }
        const towerTeam = this.towers.get(ev.unitId);
        if (towerTeam !== undefined) {
          this.towers.delete(ev.unitId);
          team(otherTeam(towerTeam), 'tower');
          continue;
        }
        // The Warden's Boon goes to the team of the champion that killed
        // it (src/sim/sim.ts), and so do its points.
        if (ev.unitId === this.wardenId) {
          const killer = world.units.get(ev.killerId);
          if (killer?.kind === 'champion') team(killer.team, 'creature');
        }
      } else if (ev.type === 'favor') {
        team(ev.team, 'creature');
      } else if (ev.type === 'wrath') {
        team(ev.team, 'ascendant');
      } else if (ev.type === 'victory') {
        this.ended = true;
        for (const s of seats) {
          if (!activeNearEnd(world.tickCount, s.lastCommandAt)) continue;
          give(s, s.team === ev.team ? 'victory' : 'finish');
        }
      }
    }
    this.note(world);
    return [...earned.values()];
  }

  // What the next tick's deaths are read against.
  private note(world: PointsWorld): void {
    for (const [id, u] of world.units) if (u.kind === 'camp') this.camps.add(id);
    this.wardenId = world.objectives.wardenId;
  }
}
