// A Thornfray on the server (CONTEXT.md: Thornfray, Bout, Lull, Bushel; ADR
// 0035), hosted beside the battle royale and not inside it. A person who
// enters joins the gathering open (server/thornfray_gather.ts), else takes
// the fewest-bushels bot seat of a Thornfray in its second Lull, else opens
// a gathering. A gathering starts full, at its clock or on its opener's
// Start now: the eight seats are dealt once for the match
// (server/thornfray_match.ts), and each bout is a RoyaleMatch of those seats
// built by the factory with the bout (src/net/replay.ts buildBoutSim), its
// drop the Lull. The first tick a bout ends its result goes to the ledger,
// its replay is saved under its own numeric id, and the next bout is built
// at once; every person is moved onto its unit ids with a match_start that
// carries the table, their connection's matchId kept on the Thornfray's id
// through the Lull. The Final's end pays the match's places
// (server/thornfray_points.ts) and tells each person their thornfray_result;
// no bout sends a royale_result. A person who leaves keeps their seat for
// the match, played by its bot until they come back. Transport-agnostic:
// main.ts hands it the socket's messages first and its deps.

import { type ClientMsg, type ServerMsg, stepOnWire } from '../src/net/protocol';
import type { ThornfrayResult } from '../src/net/royale_wire';
import type { BoutKind } from '../src/sim/content/bouts/types';
import { boutsWon, recordBout, totals } from '../src/sim/royale/bouts/ledger';
import { bankAwards } from './points';
import { ROYALE_VERBS } from './royale_commands';
import { RoyaleMatch, type RoyalePlayer, type RoyaleReplay } from './royale_match';
import { type RoyalePerson, type RoyalePick, royalePick } from './royale_seats';
import {
  ROYALE_MAX_FAILURES,
  ROYALE_REJOIN_GRACE_MS,
  ROYALE_SCORE_EVERY_TICKS,
  type RoyaleClient,
} from './royale_service';
import type { RoyaleSimFactory } from './royale_sim';
import { type ChangedSeat, type SeatChange, seatChangeSends } from './seat_change';
import { buildSeatReport, type SeatEnd, type SeatReport } from './seat_report';
import {
  type Gathering,
  gatheringStarts,
  gatherSecondsLeft,
  gatherStatus,
  joinGathering,
  leaveGathering,
  openGathering,
  pressStartNow,
} from './thornfray_gather';
import {
  dealThornfray,
  endRows,
  lateSeat,
  matchPlaces,
  nextBoutBuild,
  type SeatShown,
  seatBouts,
  seatOfOwner,
  type ThornfrayMatch,
  takeSeat,
} from './thornfray_match';
import { thornfrayEndAwards } from './thornfray_points';
import {
  countersOf,
  foldStint,
  newTally,
  type SeatTally,
  type UnitCounters,
} from './thornfray_seat';
import { boutStartBlock } from './thornfray_snapshot';

// What a Thornfray costs the server, in 5v5 matches against MAX_MATCHES
// (server/main.ts): eight champions, one bout at a time.
export const THORNFRAY_MATCH_WEIGHT = 1;
// Every champion of the roster may be picked, as in the battle royale.
const THORNFRAY_ROSTER = null;
// The messages that take a person into another door: one in a gathering
// leaves it on the way.
const ENTERING: ReadonlySet<string> = new Set([
  'royale',
  'queue',
  'create_lobby',
  'join_lobby',
  'spectate',
]);

export interface ThornfrayDeps {
  send(clientId: number, msg: ServerMsg): void;
  client(clientId: number): RoyaleClient | undefined;
  // The bouts' sim builder (the battle royale's factory, handed the bout);
  // null while the mode is not open.
  factory: RoyaleSimFactory | null;
  // The kinds a Thornfray draws its bouts from (the released pool): none,
  // and the mode is not open.
  pool: readonly BoutKind[];
  newMatchId(): number;
  newSeed(matchId: number): number;
  // How many 5v5 matches' worth the server still takes.
  capacityLeft(): number;
  // Out of the 5v5's queues: one seat at a time.
  leaveQueues(clientId: number): void;
  // Banks points on a line (ADR 0027), answering the new total or null.
  bank(owner: number, delta: number): number | null;
  // Whether an owner never banked a battle royale award.
  newcomer?(owner: number): boolean;
  appendSeat(rec: SeatReport): void;
  // Keeps a bout's replay under its own id.
  saveReplay(matchId: number, record: RoyaleReplay): void;
  now(): number;
  log(line: string): void;
}

// A person's seat in a Thornfray, kept across its bouts.
interface SeatHolder {
  owner: number;
  name: string;
  guest: boolean;
  pick: RoyalePick;
  newcomer: boolean;
  // The connection in the seat now; null while away, the seat's bot playing.
  clientId: number | null;
  // Took a bot's seat at the second Lull.
  dropIn: boolean;
  // The match's tick of the last order given (the end's "still playing").
  lastOrderAt: number;
  // The ladder points banked over the match.
  banked: number;
  // The seat report's stints, and where the current one's counters began.
  tally: SeatTally;
  stintFrom: UnitCounters | null;
}

// A bout built: its match, its index, and the seat offered a prize in it.
interface BuiltBout {
  match: RoyaleMatch;
  index: number;
  prize: number | null;
}

interface ThornfrayEntry {
  id: number;
  m: ThornfrayMatch;
  // The bout being played: its Lull (the drop), then its play.
  match: RoyaleMatch;
  index: number;
  // The seat offered a prize this bout, null in the first.
  prize: number | null;
  // The replays kept so far, one per bout, in order.
  replayIds: number[];
  // The ticks of the bouts before this one: the match's clock.
  ticksBefore: number;
  // The people's seats, by seat index.
  holders: Map<number, SeatHolder>;
  abandonedAt: number | null;
  failures: number;
  // A seat changed hands since the last tick: the scoreboard follows.
  seatChanged: boolean;
  // The connections whose seat already wrote its report.
  reported: Set<number>;
}

export class ThornfrayService {
  readonly entries = new Map<number, ThornfrayEntry>();
  private gathering: Gathering | null = null;
  // The gathering's seconds left as last told.
  private gatherTold = -1;
  // The last pick each client entered with.
  private readonly picks = new Map<number, RoyalePick>();
  // The Thornfray each seated client is in, by connection.
  private readonly seated = new Map<number, number>();

  constructor(private readonly deps: ThornfrayDeps) {}

  // Whether this client sits in a Thornfray.
  owns(clientId: number): boolean {
    return this.seated.has(clientId);
  }

  // Whether this client waits in the gathering.
  gathers(clientId: number): boolean {
    return this.gathering?.people.includes(clientId) ?? false;
  }

  // What the Thornfrays cost, in 5v5 matches.
  load(): number {
    return this.entries.size * THORNFRAY_MATCH_WEIGHT;
  }

  // People in a Thornfray and in the gathering, for the landing's line.
  presence(): { playing: number; gathering: number } {
    let playing = 0;
    for (const e of this.entries.values()) {
      for (const h of e.holders.values()) if (h.clientId !== null) playing += 1;
    }
    return { playing, gathering: this.gathering?.people.length ?? 0 };
  }

  // The replays of the Thornfrays still running: held from the prune.
  heldReplayIds(): number[] {
    const out: number[] = [];
    for (const e of this.entries.values()) out.push(...e.replayIds);
    return out;
  }

  // The socket's message, when it is the Thornfray's to answer: true when
  // it was. Asked before the battle royale's.
  handle(client: RoyaleClient, msg: ClientMsg): boolean {
    if (msg.t === 'thornfray') {
      this.enter(client, msg);
      return true;
    }
    if (msg.t === 'thornfray_start') {
      if (this.gathering && pressStartNow(this.gathering, client.id)) this.startGathered();
      return true;
    }
    if (this.gathers(client.id)) {
      if (msg.t === 'leave') {
        this.leaveGathering(client.id);
        return true;
      }
      if (ENTERING.has(msg.t)) this.leaveGathering(client.id);
      return false;
    }
    const entry = this.entryOf(client.id);
    if (!entry) return false;
    const m = entry.match;
    switch (msg.t) {
      case 'drop':
        m.pickDrop(client.id, msg.x, msg.y, msg.z);
        this.noteOrder(entry, client.id);
        return true;
      case 'leave':
        this.leaveSeat(client, entry, 'menu');
        return true;
      case 'loaded':
        m.markLoaded(client.id);
        return true;
      case 'step': {
        const step = stepOnWire(msg.id);
        if (step !== null) m.noteStep(client.id, step);
        return true;
      }
      case 'chat':
      case 'ping':
      case 'watch':
        return true;
      default:
        if (!ROYALE_VERBS.has(msg.t)) return false;
        m.handleCommand(client.id, msg);
        this.noteOrder(entry, client.id);
        return true;
    }
  }

  private entryOf(clientId: number): ThornfrayEntry | undefined {
    const id = this.seated.get(clientId);
    return id === undefined ? undefined : this.entries.get(id);
  }

  private holderOf(entry: ThornfrayEntry, clientId: number): SeatHolder | undefined {
    for (const h of entry.holders.values()) if (h.clientId === clientId) return h;
    return undefined;
  }

  private matchTick(entry: ThornfrayEntry): number {
    return entry.ticksBefore + entry.match.sim.tickCount;
  }

  private noteOrder(entry: ThornfrayEntry, clientId: number): void {
    const h = this.holderOf(entry, clientId);
    if (h) h.lastOrderAt = this.matchTick(entry);
  }

  private pickOf(client: RoyaleClient): RoyalePick {
    return this.picks.get(client.id) ?? royalePick({}, THORNFRAY_ROSTER);
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

  private holder(person: RoyalePerson, dropIn: boolean, at: number): SeatHolder {
    return {
      owner: person.owner,
      name: person.name,
      guest: person.guest,
      pick: person.pick,
      newcomer: person.newcomer === true,
      clientId: person.clientId,
      dropIn,
      lastOrderAt: at,
      banked: 0,
      tally: newTally(),
      stintFrom: null,
    };
  }

  // Entering (the 'thornfray' message): back into a held seat, else the
  // gathering, else a late seat at a second Lull, else a new gathering.
  enter(client: RoyaleClient, msg: Extract<ClientMsg, { t: 'thornfray' }>): void {
    const { send } = this.deps;
    if (!this.deps.factory || this.deps.pool.length === 0) {
      send(client.id, { t: 'error', message: 'Thornfray is not open yet.' });
      return;
    }
    if (this.owns(client.id) || this.gathers(client.id) || client.matchId !== null) return;
    this.picks.set(client.id, royalePick(msg, THORNFRAY_ROSTER));
    this.deps.leaveQueues(client.id);
    if (this.rejoin(client)) return;
    // One Thornfray per line: a seat this account holds from another tab
    // keeps it out of every other match until that tab leaves.
    if ([...this.entries.values()].some((e) => seatOfOwner(e.m, client.accountId) !== null)) {
      this.picks.delete(client.id);
      send(client.id, { t: 'error', message: 'You are already in a Thornfray.' });
      return;
    }
    const g = this.gathering;
    if (g) {
      // One seat per line: the same account in two tabs gathers once.
      const same = g.people.some((id) => this.deps.client(id)?.accountId === client.accountId);
      if (same) return;
      if (joinGathering(g, client.id)) {
        this.tellGathering();
        if (gatheringStarts(g, this.deps.now()) === 'full') this.startGathered();
        return;
      }
    }
    if (this.takeLate(client)) return;
    if (this.deps.capacityLeft() < THORNFRAY_MATCH_WEIGHT) {
      send(client.id, { t: 'error', message: 'The server is at capacity, try again in a bit.' });
      return;
    }
    if (this.gathering) this.startGathered();
    this.gathering = openGathering(client.id, this.deps.now());
    this.tellGathering();
  }

  // Where the gathering stands, to everyone in it.
  private tellGathering(): void {
    const g = this.gathering;
    if (!g) return;
    const now = this.deps.now();
    this.gatherTold = gatherSecondsLeft(g, now);
    for (const id of g.people) {
      this.deps.send(id, { t: 'thornfray_gather', ...gatherStatus(g, now, id) });
    }
  }

  private leaveGathering(clientId: number): void {
    const g = this.gathering;
    if (!g || !leaveGathering(g, clientId)) return;
    if (g.people.length === 0) this.gathering = null;
    else this.tellGathering();
  }

  // The gathering starts: its people's seats dealt, the first bout built.
  private startGathered(): void {
    const g = this.gathering;
    if (!g) return;
    this.gathering = null;
    const clients: RoyaleClient[] = [];
    for (const id of g.people) {
      const c = this.deps.client(id);
      if (c && c.matchId === null && !clients.some((o) => o.accountId === c.accountId)) {
        clients.push(c);
      }
    }
    if (clients.length === 0) return;
    const refuse = (message: string): void => {
      for (const c of clients) this.deps.send(c.id, { t: 'error', message });
    };
    if (!this.deps.factory || this.deps.capacityLeft() < THORNFRAY_MATCH_WEIGHT) {
      refuse('The server is at capacity, try again in a bit.');
      return;
    }
    const id = this.deps.newMatchId();
    const seed = this.deps.newSeed(id);
    const people = clients.map((c) => this.person(c, this.pickOf(c)));
    let entry: ThornfrayEntry;
    try {
      const m = dealThornfray(people, seed, this.deps.pool);
      const holders = new Map<number, SeatHolder>();
      m.owners.forEach((owner, seat) => {
        const p = people.find((q) => q.owner === owner);
        if (owner !== null && p) holders.set(seat, this.holder(p, false, 0));
      });
      const built = this.buildBout(m, holders, this.deps.newMatchId());
      entry = {
        id,
        m,
        match: built.match,
        index: built.index,
        prize: built.prize,
        replayIds: [],
        ticksBefore: 0,
        holders,
        abandonedAt: null,
        failures: 0,
        seatChanged: false,
        reported: new Set(),
      };
    } catch (err) {
      this.deps.log(`thornfray ${id} failed to start: ${String(err)}`);
      refuse('The Thornfray could not start.');
      return;
    }
    this.entries.set(id, entry);
    for (const c of clients) this.seatClient(c, entry);
    this.startStints(entry);
    const kinds = entry.m.ledger.draws.map((d) => d.kind).join(', ');
    this.deps.log(`thornfray ${id} started with ${clients.length} person(s): ${kinds}`);
  }

  // The next bout of a match, built over its seats as they stand: every
  // person in it is seated on it, every seat whose person is away held for
  // them.
  private buildBout(
    m: ThornfrayMatch,
    holders: ReadonlyMap<number, SeatHolder>,
    boutId: number,
  ): BuiltBout {
    const factory = this.deps.factory;
    if (!factory) throw new Error('the Thornfray is not open');
    const clientOf = (owner: number): number | null => {
      for (const h of holders.values()) if (h.owner === owner) return h.clientId;
      return null;
    };
    const build = nextBoutBuild(m, clientOf);
    if (!build) throw new Error('the match is over');
    const people: RoyalePerson[] = [];
    for (const h of holders.values()) {
      if (h.clientId === null) continue;
      people.push({
        clientId: h.clientId,
        owner: h.owner,
        name: h.name,
        guest: h.guest,
        pick: h.pick,
        ...(h.newcomer ? { newcomer: true } : {}),
      });
    }
    const match = new RoyaleMatch(
      boutId,
      build.seed,
      build.kind.base,
      people,
      factory,
      build.seats.length,
      1,
      { seats: build.seats, bout: build.bout },
    );
    holders.forEach((h, seat) => {
      const unitId = match.unitIds[seat];
      if (h.clientId === null && unitId !== undefined) match.reserve(unitId, h.owner);
    });
    return { match, index: build.index, prize: build.bout.prize };
  }

  private seatClient(client: RoyaleClient, entry: ThornfrayEntry): void {
    client.matchId = entry.id;
    this.seated.set(client.id, entry.id);
    entry.abandonedAt = null;
  }

  // Every person in the bout begins a stint and hears its start.
  private startStints(entry: ThornfrayEntry): void {
    for (const h of entry.holders.values()) {
      if (h.clientId === null) continue;
      this.beginStint(entry, h);
      this.sendStart(entry, h.clientId);
    }
  }

  private beginStint(entry: ThornfrayEntry, h: SeatHolder): void {
    const p = h.clientId !== null ? entry.match.players.get(h.clientId) : undefined;
    h.stintFrom = p ? countersOf(entry.match.sim.units.get(p.unitId)) : null;
  }

  // A stint ends (the bout's end, a leave, a rebuilt Lull): folded into the
  // seat's tally.
  private foldPlayer(entry: ThornfrayEntry, p: RoyalePlayer): void {
    const h = this.holderOf(entry, p.clientId);
    if (!h) return;
    const unit = countersOf(entry.match.sim.units.get(p.unitId));
    foldStint(h.tally, p.stats, entry.ticksBefore, h.stintFrom ?? unit, unit);
    h.stintFrom = null;
  }

  private shown(entry: ThornfrayEntry): (seat: number) => SeatShown {
    return (seat) => {
      const label = entry.match.seatLabel(entry.match.unitIds[seat] ?? -1);
      return label ?? { name: entry.m.seats[seat]?.name ?? '', bot: true };
    };
  }

  // The bout's start to one person: their champion, the bout's variant and
  // the table (also what a rejoin is told).
  private sendStart(entry: ThornfrayEntry, clientId: number): void {
    const m = entry.match;
    const p = m.players.get(clientId);
    if (!p) return;
    const seat = m.unitIds.indexOf(p.unitId);
    this.deps.send(clientId, {
      t: 'match_start',
      selfUnitId: p.unitId,
      team: p.team,
      teams: m.sim.teamCount,
      royale: {
        v: m.variant,
        seats: m.seatCount,
        tf: boutStartBlock(entry.m, entry.index, m.unitIds, seat, this.shown(entry), entry.prize),
      },
    });
  }

  // A late person takes the fewest-bushels bot seat of a Thornfray in its
  // second Lull: the Lull is built again with their champion on the seat
  // and played up to where it stood (RoyaleMatch.replayFrom), every person
  // in it told the new table.
  private takeLate(client: RoyaleClient): boolean {
    for (const entry of this.entries.values()) {
      if (entry.match.stage !== 'drop') continue;
      // A line holds one seat in a match.
      if (seatOfOwner(entry.m, client.accountId) !== null) continue;
      const seat = lateSeat(entry.m);
      if (seat === null) continue;
      const person = this.person(client, this.pickOf(client));
      const was = { seat: entry.m.seats[seat]!, owner: entry.m.owners[seat] ?? null };
      takeSeat(entry.m, seat, person);
      const h = this.holder(person, true, this.matchTick(entry));
      entry.holders.set(seat, h);
      const old = entry.match;
      let built: BuiltBout;
      try {
        built = this.buildBout(entry.m, entry.holders, old.id);
      } catch (err) {
        entry.m.seats[seat] = was.seat;
        entry.m.owners[seat] = was.owner;
        entry.holders.delete(seat);
        this.deps.log(`thornfray ${entry.id}: a late seat failed: ${String(err)}`);
        continue;
      }
      for (const p of [...old.players.values()]) this.foldPlayer(entry, p);
      const match = built.match;
      const same =
        match.unitIds.length === old.unitIds.length &&
        match.unitIds.every((u, i) => u === old.unitIds[i]);
      if (same) match.replayFrom(old.replayEvents, old.sim.tickCount);
      entry.match = match;
      this.seatClient(client, entry);
      this.startStints(entry);
      const p = match.players.get(client.id);
      if (p) this.tellSeat(entry, 'joined', p, client.id);
      this.deps.log(`thornfray ${entry.id}: ${client.name} took seat ${seat} at the second Lull`);
      return true;
    }
    return false;
  }

  // A person entering again takes back the seat they own in a running
  // Thornfray, left by the menu or by a closed socket alike: true when they
  // did. Entering is the only way back: every flow's socket says hello on
  // opening (the 5v5, the battle royale, a spectate), and a seat taken back
  // on it sent the bout to a client that never asked for a Thornfray.
  private rejoin(client: RoyaleClient): boolean {
    if (this.owns(client.id) || client.matchId !== null) return false;
    for (const entry of this.entries.values()) {
      const seat = seatOfOwner(entry.m, client.accountId);
      if (seat === null) continue;
      const h = entry.holders.get(seat);
      const unitId = entry.match.unitIds[seat];
      if (!h || h.clientId !== null || unitId === undefined) continue;
      const person: RoyalePerson = {
        clientId: client.id,
        owner: h.owner,
        name: h.name,
        guest: h.guest,
        pick: h.pick,
      };
      const p = entry.match.rejoin(person, unitId);
      if (!p) continue;
      h.clientId = client.id;
      this.seatClient(client, entry);
      this.beginStint(entry, h);
      this.sendStart(entry, client.id);
      this.tellSeat(entry, 'back', p, client.id);
      this.deps.log(`thornfray ${entry.id}: ${client.name} came back`);
      return true;
    }
    return false;
  }

  // Leaving (the pause menu's Leave, or the socket closing): the seat's bot
  // plays on and the seat stays the person's for the match.
  private leaveSeat(client: RoyaleClient, entry: ThornfrayEntry, how: SeatEnd): void {
    const p = entry.match.players.get(client.id);
    if (p) this.foldPlayer(entry, p);
    this.report(client, entry, how);
    const left = entry.match.leave(client.id, true);
    const h = this.holderOf(entry, client.id);
    if (h) h.clientId = null;
    this.unseat(client.id);
    if (left) this.tellSeat(entry, 'left', left, client.id);
    this.noteEmpty(entry);
  }

  // The socket closed with no word.
  disconnect(client: RoyaleClient): void {
    this.leaveGathering(client.id);
    this.picks.delete(client.id);
    const entry = this.entryOf(client.id);
    if (entry) this.leaveSeat(client, entry, 'closed');
  }

  private unseat(clientId: number): void {
    this.seated.delete(clientId);
    const c = this.deps.client(clientId);
    if (c) c.matchId = null;
  }

  private noteEmpty(entry: ThornfrayEntry): void {
    if (entry.abandonedAt !== null) return;
    for (const h of entry.holders.values()) if (h.clientId !== null) return;
    entry.abandonedAt = this.deps.now();
  }

  // A seat changed hands: everyone else in the bout reads who.
  private tellSeat(
    entry: ThornfrayEntry,
    change: SeatChange,
    seat: ChangedSeat & { unitId: number },
    about: number | null,
  ): void {
    entry.seatChanged = true;
    if (entry.match.isOut(seat.unitId)) return;
    const audience = [...entry.match.players.keys()];
    for (const s of seatChangeSends(change, seat, audience, about, !entry.match.over)) {
      this.deps.send(s.to, s.msg);
    }
  }

  private report(client: RoyaleClient, entry: ThornfrayEntry, how: SeatEnd): void {
    if (entry.reported.has(client.id)) return;
    const h = this.holderOf(entry, client.id);
    if (!h?.tally.stats) return;
    entry.reported.add(client.id);
    try {
      this.deps.appendSeat(
        buildSeatReport({
          at: this.deps.now(),
          how,
          queue: 'thornfray',
          replays: entry.replayIds,
          guest: client.guest,
          dropIn: h.dropIn,
          mobile: client.mobile,
          country: client.country,
          stats: h.tally.stats,
          tickCount: this.matchTick(entry),
          unit: h.tally.unit,
          pings: client.pings,
          fps: client.fps,
          quality: client.quality,
        }),
      );
    } catch (err) {
      this.deps.log(`seat report append failed: ${String(err)}`);
    }
  }

  // One step of the gathering and of every Thornfray, at the server's 20 Hz.
  tick(): void {
    const now = this.deps.now();
    const g = this.gathering;
    if (g) {
      if (gatheringStarts(g, now) !== null) this.startGathered();
      else if (gatherSecondsLeft(g, now) !== this.gatherTold) this.tellGathering();
    }
    for (const entry of [...this.entries.values()]) {
      try {
        this.tickOne(entry);
        entry.failures = 0;
      } catch (err) {
        this.deps.log(`thornfray ${entry.id} tick failed: ${String(err)}`);
        entry.failures += 1;
        if (entry.failures > ROYALE_MAX_FAILURES) {
          this.close(entry, true);
          this.deps.log(`thornfray ${entry.id} force-closed after repeated tick failures`);
        }
      }
    }
    for (const entry of [...this.entries.values()]) {
      if (entry.abandonedAt !== null && now - entry.abandonedAt > ROYALE_REJOIN_GRACE_MS) {
        this.close(entry, false);
        this.deps.log(`thornfray ${entry.id} reaped: nobody came back`);
      }
    }
  }

  private tickOne(entry: ThornfrayEntry): void {
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
      const h = this.holderOf(entry, cid);
      if (h) h.banked += msg.delta;
      send(cid, msg);
    });
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
    if (m.over) this.endBout(entry);
  }

  // The bout's first tick over: its result to the ledger, its replay kept,
  // then the next bout at once, or the match's end after the Final.
  private endBout(entry: ThornfrayEntry): void {
    const m = entry.match;
    const host = m.bout;
    if (!host) throw new Error('a Thornfray plays bouts only');
    const result = host.result();
    recordBout(entry.m.ledger, result);
    for (const p of [...m.players.values()]) this.foldPlayer(entry, p);
    const replay = m.replayRecord();
    if (replay) {
      try {
        this.deps.saveReplay(m.id, replay);
        entry.replayIds.push(m.id);
      } catch (err) {
        this.deps.log(`thornfray ${entry.id} bout ${m.id} replay save failed: ${String(err)}`);
      }
    }
    entry.ticksBefore += m.sim.tickCount;
    const winner = entry.m.seats[result.ranking[0] ?? -1]?.name ?? '';
    this.deps.log(`thornfray ${entry.id}: bout ${entry.index + 1} (${result.kind}) to ${winner}`);
    if (entry.m.ledger.results.length >= entry.m.ledger.draws.length) {
      this.endMatch(entry);
      return;
    }
    try {
      const built = this.buildBout(entry.m, entry.holders, this.deps.newMatchId());
      entry.match = built.match;
      entry.index = built.index;
      entry.prize = built.prize;
    } catch (err) {
      this.deps.log(`thornfray ${entry.id} could not build its next bout: ${String(err)}`);
      for (const h of entry.holders.values()) {
        if (h.clientId === null) continue;
        this.deps.send(h.clientId, { t: 'error', message: 'The Thornfray could not go on.' });
      }
      this.close(entry, true);
      return;
    }
    entry.seatChanged = true;
    this.startStints(entry);
  }

  // After the Final: the match's places paid to the ladder, each person
  // still in told their result, then let go.
  private endMatch(entry: ThornfrayEntry): void {
    const m = entry.m;
    const places = matchPlaces(m);
    const bushels = totals(m.ledger);
    const won = boutsWon(m.ledger);
    const matchTick = entry.ticksBefore;
    const people: { clientId: number; owner: number; seat: number; lastOrderAt: number }[] = [];
    entry.holders.forEach((h, seat) => {
      if (h.clientId !== null) {
        people.push({ clientId: h.clientId, owner: h.owner, seat, lastOrderAt: h.lastOrderAt });
      }
    });
    bankAwards(thornfrayEndAwards(places, people, matchTick), this.deps.bank, (cid, msg) => {
      const h = this.holderOf(entry, cid);
      if (h) {
        h.banked += msg.delta;
        if (h.tally.stats) h.tally.stats.points += msg.delta;
      }
      this.deps.send(cid, msg);
    });
    const shown = (seat: number): SeatShown => {
      const h = entry.holders.get(seat);
      return { name: m.seats[seat]?.name ?? '', bot: !h || h.clientId === null };
    };
    const table = endRows(m, shown);
    for (const p of people) {
      const h = entry.holders.get(p.seat)!;
      const result: ThornfrayResult = {
        t: 'thornfray_result',
        place: places[p.seat] ?? m.seats.length,
        of: m.seats.length,
        seat: p.seat,
        bushels: bushels[p.seat] ?? 0,
        won: won[p.seat] ?? 0,
        points: h.banked,
        table,
        bouts: seatBouts(m, p.seat),
        replays: [...entry.replayIds],
      };
      this.deps.send(p.clientId, result);
      const c = this.deps.client(p.clientId);
      if (c) this.report(c, entry, 'ended');
    }
    this.deps.log(`thornfray ${entry.id} ended with ${people.length} person(s) in`);
    this.close(entry, true);
  }

  private close(entry: ThornfrayEntry, notify: boolean): void {
    for (const h of entry.holders.values()) {
      if (h.clientId === null) continue;
      this.unseat(h.clientId);
      if (notify) this.deps.send(h.clientId, { t: 'match_end' });
      h.clientId = null;
    }
    this.entries.delete(entry.id);
  }
}
