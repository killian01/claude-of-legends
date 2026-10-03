// The battle royale on the server (ADR 0031): entering one, the matches it
// runs, their end, and the next. A person who asks for a variant joins the
// liveliest running match of it that still takes people, in a bot's seat
// (server/royale_join.ts, ADR 0025), else a new match starts at once with
// them and forty-nine bots. Each tick runs every match, banks what the
// people earned (server/royale_points.ts), sends each person their own
// snapshot, and tells a person their result when they are out for good
// (One life) or the match ends. Respawn then starts the next match at once
// with the people still connected; One life lingers on its end screen,
// whose Play again enters anew. A dropped connection leaves the seat to the
// mode's bot, held for its owner for a minute. Transport-agnostic: main.ts
// hands it the socket's messages through one case and its deps.

import { type ClientMsg, type ServerMsg, stepOnWire } from '../src/net/protocol';
import type { RoyaleVariant } from '../src/net/royale_wire';
import { activeNearEnd, bankAwards } from './points';
import { ROYALE_VERBS } from './royale_commands';
import { chooseRoyaleMatch, type RoyaleCandidate, takesPeople } from './royale_join';
import { RoyaleMatch, type RoyalePlayer, type RoyaleReplay } from './royale_match';
import { type RoyalePerson, type RoyalePick, royalePick } from './royale_seats';
import type { RoyaleSimFactory } from './royale_sim';
import { buildSeatReport, type SeatEnd, type SeatReport } from './seat_report';

// What a match of fifty champions costs the server, counted in 5v5
// matches against MAX_MATCHES (server/main.ts): its champions are five
// matches' worth, and the champions and their bots are most of a tick.
export const ROYALE_MATCH_WEIGHT = 5;
// Every champion of the roster may be picked in a battle royale (ADR 0031:
// the ten, quick pick), whatever the 5v5's collection holds (ADR 0018): a
// Guest who picked Dain played Torv, the first of the Guests' starters
// (a playtest, 2026-10-03).
const ROYALE_ROSTER = null;
// A dropped connection's seat waits this long for its owner.
export const ROYALE_REJOIN_GRACE_MS = 60_000;
// One life's end screen: the finished match stays this long.
export const ROYALE_LINGER_MS = 20_000;
// The scoreboard every five seconds: fifty lines are heavier than ten.
export const ROYALE_SCORE_EVERY_TICKS = 100;
// A match whose ticks keep failing is closed rather than retried forever.
export const ROYALE_MAX_FAILURES = 200;

// What the service reads of a connection (server/main.ts Client).
export interface RoyaleClient {
  readonly id: number;
  // The account, or a Guest's negative id.
  readonly accountId: number;
  readonly name: string;
  readonly guest: boolean;
  // The match the socket is seated in, set here for a battle royale so the
  // 5v5's doors stay shut while it plays.
  matchId: number | null;
  readonly country: string | null;
  readonly mobile: boolean;
  readonly pings: readonly number[];
  readonly fps: readonly number[];
}

export interface RoyaleDeps {
  send(clientId: number, msg: ServerMsg): void;
  client(clientId: number): RoyaleClient | undefined;
  // The mode's sim builder; null while the mode is not open.
  factory: RoyaleSimFactory | null;
  newMatchId(): number;
  newSeed(matchId: number): number;
  // How many 5v5 matches' worth the server still takes (MAX_MATCHES less
  // what runs).
  capacityLeft(): number;
  // Out of the 5v5's queues: one seat at a time.
  leaveQueues(clientId: number): void;
  // Banks points on a line (ADR 0027), answering the new total or null.
  bank(owner: number, delta: number): number | null;
  appendSeat(rec: SeatReport): void;
  // Keeps a finished match's replay (src/net/replay.ts), when it has one.
  saveReplay(matchId: number, record: RoyaleReplay): void;
  now(): number;
  log(line: string): void;
  // Respawn keeps a match running for the next visitor to drop into, its
  // seats played by the house bots while nobody is in it (server/main.ts
  // turns it on): a visitor lands in a fight under way, and the landing
  // says a match is on. Off, a match starts only with a person.
  readonly standing?: boolean;
}

interface RoyaleEntry {
  match: RoyaleMatch;
  // Wall clock of the end, and of the last person leaving.
  endedAt: number | null;
  abandonedAt: number | null;
  failures: number;
  // The clients whose seat already wrote its report.
  reported: Set<number>;
  // Whether a person ever held a seat in it: a match the house bots
  // played alone keeps no replay.
  hadPeople: boolean;
}

interface Reservation {
  matchId: number;
  unitId: number;
  until: number;
}

export class RoyaleService {
  readonly matches = new Map<number, RoyaleEntry>();
  // Seats held for a dropped connection, by the owner who may claim them.
  private readonly reservations = new Map<number, Reservation>();
  // The last pick each client entered with: Respawn's next match seats it.
  private readonly picks = new Map<number, RoyalePick>();
  private readonly seated = new Map<number, number>();

  constructor(private readonly deps: RoyaleDeps) {}

  // Whether this client sits in a battle royale.
  owns(clientId: number): boolean {
    return this.seated.has(clientId);
  }

  // What the matches cost, in 5v5 matches.
  load(): number {
    return this.matches.size * ROYALE_MATCH_WEIGHT;
  }

  // People playing, whether Play now would drop into a running match, and
  // the seconds left in the match it would drop into, for the landing's
  // line (ADR 0025). People only: the house bots are never counted.
  presence(): { playing: number; joinable: boolean; endsInS: number | null } {
    let playing = 0;
    let joinable = false;
    const candidates = this.candidates();
    for (const c of candidates) {
      if (c.closing) continue;
      playing += c.people;
      if (c.variant === 'respawn' && takesPeople(c)) joinable = true;
    }
    const id = chooseRoyaleMatch(candidates, 'respawn');
    const into = candidates.find((c) => c.matchId === id);
    const endsInS = into ? Math.max(0, Math.round(into.endsAt - into.time)) : null;
    return { playing, joinable, endsInS };
  }

  // The socket's message, when it is the battle royale's to answer: true
  // when it was.
  handle(client: RoyaleClient, msg: ClientMsg): boolean {
    if (msg.t === 'royale') {
      this.enter(client, msg);
      return true;
    }
    const entry = this.entryOf(client.id);
    if (msg.t === 'drop') {
      entry?.match.pickDrop(client.id, msg.x, msg.y, msg.z);
      return true;
    }
    if (!entry) return false;
    switch (msg.t) {
      case 'leave':
        this.walkOut(client, entry, 'menu');
        return true;
      case 'loaded':
        entry.match.markLoaded(client.id);
        return true;
      case 'step': {
        const step = stepOnWire(msg.id);
        if (step !== null) entry.match.noteStep(client.id, step);
        return true;
      }
      // Each for themself: nobody to chat with or ping for.
      case 'chat':
      case 'ping':
        return true;
      // A card of a Graft offer, and the next survivor to watch once out:
      // taken and answered by nothing yet.
      case 'graft':
      case 'watch':
        return true;
      default:
        if (!ROYALE_VERBS.has(msg.t)) return false;
        entry.match.handleCommand(client.id, msg);
        return true;
    }
  }

  private entryOf(clientId: number): RoyaleEntry | undefined {
    const id = this.seated.get(clientId);
    return id === undefined ? undefined : this.matches.get(id);
  }

  private person(client: RoyaleClient, pick: RoyalePick): RoyalePerson {
    return {
      clientId: client.id,
      owner: client.accountId,
      name: client.name,
      guest: client.guest,
      pick,
    };
  }

  private pickOf(client: RoyaleClient): RoyalePick {
    return this.picks.get(client.id) ?? royalePick({}, ROYALE_ROSTER);
  }

  private candidates(): RoyaleCandidate[] {
    const out: RoyaleCandidate[] = [];
    for (const [matchId, e] of this.matches) {
      const r = e.match.sim.royale;
      out.push({
        matchId,
        variant: e.match.variant,
        stage: r.stage,
        time: e.match.sim.time,
        dropEndsAt: r.dropEndsAt,
        endsAt: r.endsAt,
        people: e.match.players.size,
        openSeats: e.match.openBotSeats,
        closing: e.endedAt !== null || e.abandonedAt !== null,
      });
    }
    return out;
  }

  // Entering (the 'royale' message): back into a held seat, else a bot's
  // seat in a running match, else a new match.
  enter(client: RoyaleClient, msg: Extract<ClientMsg, { t: 'royale' }>): void {
    const { send } = this.deps;
    if (!this.deps.factory) {
      send(client.id, { t: 'error', message: 'The battle royale is not open yet.' });
      return;
    }
    const variant: RoyaleVariant | null =
      msg.v === 'respawn' || msg.v === 'one_life' ? msg.v : null;
    if (variant === null) return;
    const current = this.entryOf(client.id);
    if (current) {
      // Play again: a seat whose match is over, or whose champion is out
      // for good, is left for a new one; a seat still playing stays.
      const p = current.match.players.get(client.id);
      if (p && !current.match.over && !current.match.isOut(p.unitId)) return;
      this.walkOut(client, current, 'menu');
    } else if (client.matchId !== null) {
      return;
    }
    this.picks.set(client.id, royalePick(msg, ROYALE_ROSTER));
    this.deps.leaveQueues(client.id);
    if (this.rejoin(client)) return;
    const person = this.person(client, this.pickOf(client));
    const matchId = chooseRoyaleMatch(this.candidates(), variant);
    const entry = matchId === null ? undefined : this.matches.get(matchId);
    if (entry) {
      const p = entry.match.takeBotSeat(person);
      if (p) {
        this.seat(client, entry, p, true);
        for (const other of entry.match.players.values()) {
          if (other.clientId === client.id) continue;
          send(other.clientId, { t: 'player_joined', name: p.name, team: p.team });
        }
        this.deps.log(`royale ${entry.match.id}: ${client.name} dropped in`);
        return;
      }
    }
    if (this.deps.capacityLeft() < ROYALE_MATCH_WEIGHT) {
      send(client.id, { t: 'error', message: 'The server is at capacity, try again in a bit.' });
      return;
    }
    this.start(variant, [client]);
  }

  // A new match with these people and bots on every other seat.
  private start(variant: RoyaleVariant, clients: readonly RoyaleClient[]): RoyaleEntry | null {
    const factory = this.deps.factory;
    if (!factory) return null;
    const id = this.deps.newMatchId();
    const seed = this.deps.newSeed(id);
    const people = clients.map((c) => this.person(c, this.pickOf(c)));
    let match: RoyaleMatch;
    try {
      match = new RoyaleMatch(id, seed, variant, people, factory);
    } catch (err) {
      this.deps.log(`royale ${id} failed to start: ${String(err)}`);
      for (const c of clients) {
        this.deps.send(c.id, { t: 'error', message: 'The battle royale could not start.' });
      }
      return null;
    }
    const entry: RoyaleEntry = {
      match,
      endedAt: null,
      abandonedAt: null,
      failures: 0,
      reported: new Set(),
      hadPeople: clients.length > 0,
    };
    this.matches.set(id, entry);
    for (const c of clients) {
      const p = match.players.get(c.id);
      if (p) this.seat(c, entry, p, false);
    }
    this.deps.log(`royale ${id} (${variant}) started with ${clients.length} person(s)`);
    return entry;
  }

  private seat(client: RoyaleClient, entry: RoyaleEntry, p: RoyalePlayer, dropIn: boolean): void {
    client.matchId = entry.match.id;
    this.seated.set(client.id, entry.match.id);
    entry.abandonedAt = null;
    entry.hadPeople = true;
    this.deps.send(client.id, {
      t: 'match_start',
      selfUnitId: p.unitId,
      team: p.team,
      ...(dropIn ? { dropIn: true as const } : {}),
      // Each champion its own team (ADR 0030).
      teams: entry.match.sim.teamCount,
      royale: { v: entry.match.variant, seats: entry.match.seatCount },
    });
  }

  private unseat(clientId: number): void {
    this.seated.delete(clientId);
    const c = this.deps.client(clientId);
    if (c) c.matchId = null;
  }

  private report(client: RoyaleClient, entry: RoyaleEntry, how: SeatEnd): void {
    if (entry.reported.has(client.id)) return;
    const p = entry.match.players.get(client.id);
    if (!p) return;
    entry.reported.add(client.id);
    const u = entry.match.sim.units.get(p.unitId);
    try {
      this.deps.appendSeat(
        buildSeatReport({
          at: this.deps.now(),
          how,
          queue: 'royale',
          variant: entry.match.variant,
          guest: client.guest,
          dropIn: p.dropIn,
          mobile: client.mobile,
          country: client.country,
          stats: p.stats,
          tickCount: entry.match.sim.tickCount,
          unit: u
            ? { level: u.level, kills: u.kills, deaths: u.deaths, assists: u.assists, cs: u.cs }
            : null,
          pings: client.pings,
          fps: client.fps,
        }),
      );
    } catch (err) {
      this.deps.log(`seat report append failed: ${String(err)}`);
    }
  }

  private noteEmpty(entry: RoyaleEntry): void {
    if (entry.match.players.size !== 0 || entry.abandonedAt !== null) return;
    // The match kept for the next visitor plays on with its bots.
    if (this.deps.standing && this.onlyOpen(entry.match.id)) return;
    entry.abandonedAt = this.deps.now();
  }

  // Whether this match is the one Respawn match that takes people.
  private onlyOpen(matchId: number): boolean {
    const open = this.candidates().filter((c) => c.variant === 'respawn' && takesPeople(c));
    return open.length === 1 && open[0]!.matchId === matchId;
  }

  // Respawn always has a match to drop into: when none takes people, one
  // starts with nobody in it and house bots in every seat. The one before
  // runs out its clock (Respawn takes nobody in its last minutes).
  private keepOneOpen(): void {
    if (!this.deps.factory) return;
    const open = this.candidates().some((c) => c.variant === 'respawn' && takesPeople(c));
    if (open || this.deps.capacityLeft() < ROYALE_MATCH_WEIGHT) return;
    this.start('respawn', []);
  }

  // Leaving for good (the pause menu, Play again): the bot plays on, and
  // nothing is held.
  private walkOut(client: RoyaleClient, entry: RoyaleEntry, how: SeatEnd): void {
    this.report(client, entry, how);
    const left = entry.match.leave(client.id, false);
    this.unseat(client.id);
    this.reservations.delete(client.accountId);
    if (left && !entry.match.over) {
      for (const other of entry.match.players.values()) {
        this.deps.send(other.clientId, {
          t: 'player_left',
          name: left.name,
          team: left.team,
        });
      }
    }
    this.noteEmpty(entry);
  }

  // The socket closed with no word: the seat waits for its owner.
  disconnect(client: RoyaleClient): void {
    const entry = this.entryOf(client.id);
    if (!entry) return;
    this.report(client, entry, 'closed');
    const hold = !entry.match.over;
    const left = entry.match.leave(client.id, hold);
    this.unseat(client.id);
    if (left && hold) {
      this.reservations.set(client.accountId, {
        matchId: entry.match.id,
        unitId: left.unitId,
        until: this.deps.now() + ROYALE_REJOIN_GRACE_MS,
      });
      for (const other of entry.match.players.values()) {
        this.deps.send(other.clientId, {
          t: 'player_left',
          name: left.name,
          team: left.team,
        });
      }
    }
    this.picks.delete(client.id);
    this.noteEmpty(entry);
  }

  // A reconnected socket claims the seat held for its owner (the 'hello'
  // message, or entering again): true when it did.
  rejoin(client: RoyaleClient): boolean {
    if (this.owns(client.id) || client.matchId !== null) return false;
    const r = this.reservations.get(client.accountId);
    if (!r) return false;
    this.reservations.delete(client.accountId);
    const entry = this.matches.get(r.matchId);
    if (!entry || entry.match.over) return false;
    const p = entry.match.rejoin(this.person(client, this.pickOf(client)), r.unitId);
    if (!p) return false;
    this.seat(client, entry, p, false);
    for (const other of entry.match.players.values()) {
      if (other.clientId === client.id) continue;
      this.deps.send(other.clientId, { t: 'player_back', name: p.name, team: p.team });
    }
    this.deps.log(`royale ${entry.match.id}: ${client.name} reconnected`);
    return true;
  }

  // One step of every match, at the server's 20 Hz.
  tick(): void {
    const now = this.deps.now();
    const next: RoyaleClient[][] = [];
    for (const entry of [...this.matches.values()]) {
      try {
        const movers = this.tickOne(entry, now);
        if (movers) next.push(movers);
        entry.failures = 0;
      } catch (err) {
        this.deps.log(`royale ${entry.match.id} tick failed: ${String(err)}`);
        entry.failures += 1;
        if (entry.failures > ROYALE_MAX_FAILURES) {
          this.close(entry, true);
          this.deps.log(`royale ${entry.match.id} force-closed after repeated tick failures`);
        }
      }
    }
    // Respawn's next match, with the people its last one ended with.
    for (const movers of next) {
      if (!this.start('respawn', movers)) {
        for (const c of movers) this.deps.send(c.id, { t: 'match_end' });
      }
    }
    for (const [owner, r] of this.reservations) {
      if (now <= r.until) continue;
      this.reservations.delete(owner);
      this.matches.get(r.matchId)?.match.release(r.unitId);
    }
    for (const entry of [...this.matches.values()]) {
      if (entry.abandonedAt !== null && now - entry.abandonedAt > ROYALE_REJOIN_GRACE_MS) {
        this.close(entry, false);
        this.deps.log(`royale ${entry.match.id} reaped: nobody came back`);
      }
    }
    if (this.deps.standing) this.keepOneOpen();
  }

  // One match's tick; the people to move into Respawn's next match when
  // this one just ended.
  private tickOne(entry: RoyaleEntry, now: number): RoyaleClient[] | null {
    const { send } = this.deps;
    const m = entry.match;
    m.tick();
    const seats = [...m.players.values()].map((p) => ({
      clientId: p.clientId,
      owner: p.owner,
      unitId: p.unitId,
      lastCommandAt: p.lastCommandAt,
    }));
    bankAwards(m.points.observe(m.sim, m.lastEvents, seats), this.deps.bank, (cid, msg) => {
      m.notePoints(cid, msg.delta);
      send(cid, msg);
    });
    // The scoreboard every few seconds, and to a person just seated at once:
    // the names the kill feed and the nameplates read.
    let score = m.sim.tickCount % ROYALE_SCORE_EVERY_TICKS === 0 ? m.buildScore() : null;
    for (const p of m.players.values()) {
      const snap = m.snapshotFor(p.clientId);
      if (snap) send(p.clientId, snap);
      if (!score && !p.scoreSent) score = m.buildScore();
      if (score && (!p.scoreSent || m.sim.tickCount % ROYALE_SCORE_EVERY_TICKS === 0)) {
        send(p.clientId, score);
      }
      p.scoreSent = true;
    }
    // Out for good (One life): the result now, the end screen's Play again.
    for (const p of m.outThisTick()) {
      if (p.resultSent) continue;
      const result = m.resultFor(p.clientId);
      if (!result) continue;
      p.resultSent = true;
      send(p.clientId, result);
    }
    if (m.over && entry.endedAt === null) {
      entry.endedAt = now;
      return this.end(entry);
    }
    if (entry.endedAt !== null && now - entry.endedAt > ROYALE_LINGER_MS) this.close(entry, true);
    return null;
  }

  // The last light went out, or the last champion stands: every person
  // still in hears their result. Respawn hands back the people to move: the
  // ones still playing (a command in the last three minutes, ADR 0027's
  // rule), so a tab left open does not play match after match for nobody;
  // the others are told the match ended, and their end screen offers the
  // way back in.
  private end(entry: RoyaleEntry): RoyaleClient[] | null {
    const m = entry.match;
    const people: RoyaleClient[] = [];
    for (const p of m.players.values()) {
      if (!p.resultSent) {
        const result = m.resultFor(p.clientId);
        if (result) this.deps.send(p.clientId, result);
        p.resultSent = true;
      }
      const c = this.deps.client(p.clientId);
      if (!c) continue;
      this.report(c, entry, 'ended');
      if (m.variant !== 'respawn') continue;
      if (activeNearEnd(m.sim.tickCount, p.lastCommandAt)) people.push(c);
      else this.deps.send(p.clientId, { t: 'match_end' });
    }
    const replay = entry.hadPeople ? m.replayRecord() : null;
    if (replay) {
      try {
        this.deps.saveReplay(m.id, replay);
      } catch (err) {
        this.deps.log(`royale ${m.id} replay save failed: ${String(err)}`);
      }
    }
    this.deps.log(`royale ${m.id} ended with ${people.length} person(s) in`);
    if (m.variant !== 'respawn') return null;
    this.close(entry, false);
    return people.length > 0 ? people : null;
  }

  private close(entry: RoyaleEntry, notify: boolean): void {
    for (const p of entry.match.players.values()) {
      this.unseat(p.clientId);
      if (notify) this.deps.send(p.clientId, { t: 'match_end' });
    }
    for (const [owner, r] of this.reservations) {
      if (r.matchId === entry.match.id) this.reservations.delete(owner);
    }
    this.matches.delete(entry.match.id);
  }
}
