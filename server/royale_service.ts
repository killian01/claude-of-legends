// The battle royale on the server (ADR 0031): entering one, the matches it
// runs, their end, and the next. A person who asks for a variant and a crew
// size (Solo, Trios or Fives, ADR 0034) joins the liveliest running match
// of it that still takes people, in a bot's seat (server/royale_join.ts,
// ADR 0025), else a new match starts at once with them and bots on every
// other seat. Each tick runs every match, banks what the
// people earned (server/royale_points.ts), sends each person their own
// snapshot, and tells a person their result when they are out for good
// (One life) or the match ends. Respawn then lets every person go, and its
// end screen's Play the next match enters anew, dropping into the match
// kept running for visitors; One life lingers on its end screen, whose Play
// again enters anew. A dropped connection leaves the seat to the mode's
// bot, held for its owner for a minute. Transport-agnostic: main.ts hands
// it the socket's messages through one case and its deps.

import { type ClientMsg, type ServerMsg, stepOnWire } from '../src/net/protocol';
import type { RoyaleVariant } from '../src/net/royale_wire';
import type { RoyaleCrew } from '../src/sim/royale/types';
import { bankAwards } from './points';
import { ROYALE_VERBS } from './royale_commands';
import { chooseRoyaleMatch, type RoyaleCandidate, takesPeople } from './royale_join';
import { RoyaleMatch, type RoyalePlayer, type RoyaleReplay } from './royale_match';
import { respawnSeatTally } from './royale_ranking';
import { type RoyalePerson, type RoyalePick, royalePick } from './royale_seats';
import type { RoyaleSimFactory } from './royale_sim';
import { type ChangedSeat, type SeatChange, seatChangeSends } from './seat_change';
import { buildSeatReport, type SeatEnd, type SeatReport, type SeenQuality } from './seat_report';

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
  readonly quality: SeenQuality | null;
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
  // A Respawn end's tally for a line's seat (ADR 0033): raises the line's
  // best when the tally beats it, answering the best held before, or null
  // when the line is gone. Unset, no best is kept.
  raiseBest?(owner: number, tally: number): number | null;
  // Whether an owner never banked a battle royale award: a newcomer, whose
  // escorts the mode deals differently (RoyalePerson.newcomer). Unset, no
  // one is.
  newcomer?(owner: number): boolean;
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
  // A seat changed hands since the last tick: the scoreboard, every seat's
  // name and bot mark, goes to everyone with the next one.
  seatChanged: boolean;
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
  // The last pick each client entered with: a held seat claimed again
  // seats it.
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

  // People playing, whether Play now (Respawn, Solo) would drop into a
  // running match, and the seconds left in the match it would drop into,
  // for the landing's line (ADR 0025). People only: the house bots are
  // never counted.
  presence(): { playing: number; joinable: boolean; endsInS: number | null } {
    let playing = 0;
    let joinable = false;
    const candidates = this.candidates();
    for (const c of candidates) {
      if (c.closing) continue;
      playing += c.people;
      if (c.variant === 'respawn' && (c.crew ?? 1) === 1 && takesPeople(c)) joinable = true;
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
      // No chat or ping on the planet yet, Crews included (ADR 0034).
      case 'chat':
      case 'ping':
        return true;
      // The next survivor to watch once out: answered by nothing yet. A
      // Graft's card is a verb (royale_commands.ts), recorded and replayed.
      case 'watch':
        return true;
      default:
        if (!ROYALE_VERBS.has(msg.t)) return false;
        entry.match.handleCommand(client.id, msg);
        return true;
    }
  }

  // A seat of this owner in a match still running, its champion not out.
  private playing(owner: number): boolean {
    for (const e of this.matches.values()) {
      if (e.match.over) continue;
      for (const p of e.match.players.values()) {
        if (p.owner === owner && !e.match.isOut(p.unitId)) return true;
      }
    }
    return false;
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
      ...(this.deps.newcomer?.(client.accountId) ? { newcomer: true } : {}),
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
        crew: e.match.crew,
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
    // Trios or Fives; anything else is Solo.
    const crew: RoyaleCrew = msg.c === 3 || msg.c === 5 ? msg.c : 1;
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
    // One seat per line: a seat this account still plays from another tab
    // keeps it out of every other one until that tab leaves.
    if (this.playing(client.accountId)) {
      this.picks.delete(client.id);
      send(client.id, { t: 'error', message: 'You are already in a battle royale.' });
      return;
    }
    const person = this.person(client, this.pickOf(client));
    const matchId = chooseRoyaleMatch(this.candidates(), variant, crew);
    const entry = matchId === null ? undefined : this.matches.get(matchId);
    if (entry) {
      const p = entry.match.takeBotSeat(person);
      if (p) {
        this.seat(client, entry, p, true);
        this.tellSeat(entry, 'joined', p, client.id);
        this.deps.log(`royale ${entry.match.id}: ${client.name} dropped in`);
        return;
      }
    }
    if (this.deps.capacityLeft() < ROYALE_MATCH_WEIGHT) {
      send(client.id, { t: 'error', message: 'The server is at capacity, try again in a bit.' });
      return;
    }
    this.start(variant, [client], crew);
  }

  // A new match with these people and bots on every other seat.
  private start(
    variant: RoyaleVariant,
    clients: readonly RoyaleClient[],
    crew: RoyaleCrew = 1,
  ): RoyaleEntry | null {
    const factory = this.deps.factory;
    if (!factory) return null;
    const id = this.deps.newMatchId();
    const seed = this.deps.newSeed(id);
    const people = clients.map((c) => this.person(c, this.pickOf(c)));
    let match: RoyaleMatch;
    try {
      match = new RoyaleMatch(id, seed, variant, people, factory, undefined, crew);
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
      seatChanged: false,
    };
    this.matches.set(id, entry);
    for (const c of clients) {
      const p = match.players.get(c.id);
      if (p) this.seat(c, entry, p, false);
    }
    const size = crew === 1 ? '' : `, crews of ${crew}`;
    this.deps.log(`royale ${id} (${variant}${size}) started with ${clients.length} person(s)`);
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
      // One team per crew (ADR 0030, ADR 0034): every champion's own in Solo.
      teams: entry.match.sim.teamCount,
      royale: {
        v: entry.match.variant,
        seats: entry.match.seatCount,
        ...(entry.match.crew !== 1 ? { c: entry.match.crew } : {}),
      },
    });
  }

  // A seat changed hands: everyone else in the match reads who, and the
  // scoreboard with the seat's new name and bot mark follows at once. A
  // seat out for good (One life) is told nothing: no bot plays it on.
  private tellSeat(
    entry: RoyaleEntry,
    change: SeatChange,
    seat: ChangedSeat & { unitId: number },
    about: number | null,
  ): void {
    entry.seatChanged = true;
    if (entry.match.isOut(seat.unitId)) return;
    const audience = [...entry.match.players.keys()];
    const playing = !entry.match.over;
    for (const s of seatChangeSends(change, seat, audience, about, playing)) {
      this.deps.send(s.to, s.msg);
    }
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
          ...(entry.match.crew !== 1 ? { crew: entry.match.crew } : {}),
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
          quality: client.quality,
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

  // The Respawn matches in Solo that take people: Play now's.
  private standingOpen(): RoyaleCandidate[] {
    return this.candidates().filter(
      (c) => c.variant === 'respawn' && (c.crew ?? 1) === 1 && takesPeople(c),
    );
  }

  // Whether this match is the one Respawn match in Solo that takes people.
  private onlyOpen(matchId: number): boolean {
    const open = this.standingOpen();
    return open.length === 1 && open[0]!.matchId === matchId;
  }

  // Respawn in Solo always has a match to drop into: when none takes
  // people, one starts with nobody in it and house bots in every seat. The
  // one before runs out its clock (Respawn takes nobody in its last
  // minutes). Crews start with the person who asks (ADR 0034).
  private keepOneOpen(): void {
    if (!this.deps.factory) return;
    const open = this.standingOpen().length > 0;
    if (open || this.deps.capacityLeft() < ROYALE_MATCH_WEIGHT) return;
    this.start('respawn', []);
  }

  // Leaving for good (the pause menu, Play again): the bot plays on, and
  // nothing is held.
  private walkOut(client: RoyaleClient, entry: RoyaleEntry, how: SeatEnd): void {
    this.report(client, entry, how);
    const left = entry.match.leave(client.id, false);
    this.unseat(client.id);
    this.forget(client.accountId);
    if (left) this.tellSeat(entry, 'left', left, client.id);
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
      this.forget(client.accountId);
      this.reservations.set(client.accountId, {
        matchId: entry.match.id,
        unitId: left.unitId,
        until: this.deps.now() + ROYALE_REJOIN_GRACE_MS,
      });
      this.tellSeat(entry, 'left', left, client.id);
    }
    this.picks.delete(client.id);
    this.noteEmpty(entry);
  }

  // An owner holds one seat at most: the one held before is anyone's to
  // take again, as when its grace runs out.
  private forget(owner: number): void {
    const r = this.reservations.get(owner);
    if (!r) return;
    this.reservations.delete(owner);
    this.matches.get(r.matchId)?.match.release(r.unitId);
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
    this.tellSeat(entry, 'back', p, client.id);
    this.deps.log(`royale ${entry.match.id}: ${client.name} reconnected`);
    return true;
  }

  // One step of every match, at the server's 20 Hz.
  tick(): void {
    const now = this.deps.now();
    for (const entry of [...this.matches.values()]) {
      try {
        this.tickOne(entry, now);
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

  // One match's tick.
  private tickOne(entry: RoyaleEntry, now: number): void {
    const { send } = this.deps;
    const m = entry.match;
    m.tick();
    // In Crews the seat's crew, so a crewmate is no opponent (ADR 0034).
    const seats = [...m.players.values()].map((p) => ({
      clientId: p.clientId,
      owner: p.owner,
      unitId: p.unitId,
      lastCommandAt: p.lastCommandAt,
      ...(m.crew > 1 ? { team: p.team } : {}),
    }));
    bankAwards(m.points.observe(m.sim, m.lastEvents, seats), this.deps.bank, (cid, msg) => {
      m.notePoints(cid, msg.delta);
      send(cid, msg);
    });
    // The scoreboard every few seconds, to a person just seated, and to
    // everyone once a seat changed hands: the names and bot marks the kill
    // feed and the nameplates read, a seat out of sight's included.
    const toAll = m.sim.tickCount % ROYALE_SCORE_EVERY_TICKS === 0 || entry.seatChanged;
    entry.seatChanged = false;
    let score = toAll ? m.buildScore() : null;
    for (const p of m.players.values()) {
      const snap = m.snapshotFor(p.clientId);
      if (snap) send(p.clientId, snap);
      if (!score && !p.scoreSent) score = m.buildScore();
      if (score && (!p.scoreSent || toAll)) send(p.clientId, score);
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
      this.end(entry);
      return;
    }
    if (entry.endedAt !== null && now - entry.endedAt > ROYALE_LINGER_MS) this.close(entry, true);
  }

  // The last light went out, or the last champion stands: every person
  // still in hears their result, a Respawn one with the best their line
  // held before it, raised by this seat's tally (ADR 0033). Respawn then
  // closes at once and tells each person the match ended; nobody is
  // moved. The end screen's Play the next match enters anew with the same
  // pick, into the match kept running for visitors (keepOneOpen) with an
  // Arrival, fresh and graced. Moving the
  // people at once landed their champion behind the end screen, where it
  // stood idle and was taken down (the second playtest, 2026-10-04); and a
  // tab left open plays no match for nobody.
  private end(entry: RoyaleEntry): void {
    const m = entry.match;
    let people = 0;
    for (const p of m.players.values()) {
      if (!p.resultSent) {
        const result = m.resultFor(p.clientId);
        if (result) {
          if (m.variant === 'respawn') {
            const before = this.deps.raiseBest?.(p.owner, respawnSeatTally(result)) ?? null;
            if (before !== null) result.bestBefore = before;
          }
          this.deps.send(p.clientId, result);
        }
        p.resultSent = true;
      }
      const c = this.deps.client(p.clientId);
      if (!c) continue;
      this.report(c, entry, 'ended');
      people += 1;
    }
    const replay = entry.hadPeople ? m.replayRecord() : null;
    if (replay) {
      try {
        this.deps.saveReplay(m.id, replay);
      } catch (err) {
        this.deps.log(`royale ${m.id} replay save failed: ${String(err)}`);
      }
    }
    this.deps.log(`royale ${m.id} ended with ${people} person(s) in`);
    if (m.variant === 'respawn') this.close(entry, true);
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
