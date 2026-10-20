// The Thornfray's measure (ADR 0035, docs/plan-thornfray.md slice 8): what
// scripts/thornfray_report.ts plays and prints, kept apart from its command
// line so tests/thornfray_report.test.ts reads it (an import of the report's
// own name would reach the bundling wrapper beside it, thornfray_report.mjs).
// Whole Thornfrays of house bots built the way the server builds one nobody
// joined (server/thornfray_match.ts dealThornfray and nextBoutBuild over the
// ledger, every bout through server/royale_build.ts royaleFactory, so
// through buildBoutSim), each bout's figures read off its sim, a battle
// royale of fifty for the planet's fighting share, and the summary's
// figures, pure over what was played. The report's header says what each
// figure is.

import { royaleSeats } from '../server/royale_seats';
import type { RoyaleBoutArgs, RoyaleSeatPick, RoyaleSimFactory } from '../server/royale_sim';
import {
  type BoutBuild,
  dealThornfray,
  nextBoutBuild,
  type ThornfrayMatch,
} from '../server/thornfray_match';
import { ROYALE_SKILLS } from '../src/sim/content/bots/royale_skills';
import { BOUT_KINDS, boutKindOf, boutPool } from '../src/sim/content/bouts';
import { PRIZE_LASTS, type PrizeLasts } from '../src/sim/content/bouts/match';
import type { BoutKind } from '../src/sim/content/bouts/types';
import { dist } from '../src/sim/geo';
import type { Policy } from '../src/sim/policy';
import { decide } from '../src/sim/royale/bot/brain';
import {
  type BoutResult,
  boutPaid,
  carriedGrafts,
  matchWinner,
  recordBout,
  standings,
  totals,
} from '../src/sim/royale/bouts/ledger';
import { REGION_IDS, type RegionId } from '../src/sim/royale/layout';
import { DROP_S, PLAY_S, type RoyaleVariant } from '../src/sim/royale/types';
import type { Sim, SimEvent } from '../src/sim/sim';
import { DT, TICK_RATE } from '../src/sim/types';

// royale_report.ts's yardstick: an enemy in sight within this many meters,
// and fighting when the seat dealt a champion damage this many seconds ago
// or less.
export const ENGAGE_M = 8;
export const ENGAGED_S = 3;
// A bout still running this long past its clock is cut and marked.
const BOUT_SLACK_S = 30;
// A battle royale still running this long past its last light is cut.
const PLANET_SLACK_S = 120;

// Who plays a seat: its bot's skill, or the stand-in.
export type SeatKind = 'gentle' | 'normal' | 'strong' | 'standin';

// One bout as it was played.
export interface BoutRow {
  index: number;
  kind: string;
  region: RegionId;
  final: boolean;
  // Seconds from the landing to the end, and what ended it: its rule (One
  // life's last one standing), its clock, or the report's cap.
  lengthS: number;
  endedBy: 'rule' | 'clock' | 'cap';
  firstFallS: number | null;
  // The seats best first, the kind's counts and the bushels paid, by seat.
  ranking: number[];
  counts: number[];
  paid: number[];
  // Who played each seat.
  seats: SeatKind[];
  takedowns: number;
  falls: number;
  duskFalls: number;
  // Caches opened by seat (every kind), and the Seedfall caches of them.
  caches: number[];
  seedfallCaches: number[];
  // Bot-seconds with an enemy in sight within ENGAGE_M, and those spent
  // fighting.
  nearS: number;
  fightS: number;
  // The brain's labels in play, counted.
  decided: Record<string, number>;
  // The Grafts picked from a prize in this bout, by seat.
  prizeGrafts: { seat: number; graft: string }[];
  tickMs: number;
  tickMaxMs: number;
  checksum: number;
}

// One whole Thornfray.
export interface MatchRow {
  seed: number;
  prize: PrizeLasts;
  pool: string[];
  standin: number | null;
  bouts: BoutRow[];
  // Every seat's bushels at the end, the table best first, the winner, and
  // the seat that led the table before the Final.
  totals: number[];
  standings: number[];
  winner: number;
  leaderBeforeFinal: number;
}

// A battle royale of fifty house bots, for the planet's fighting share.
export interface PlanetRow {
  variant: RoyaleVariant;
  seed: number;
  lengthS: number;
  nearS: number;
  fightS: number;
  tickMs: number;
}

export interface Dump {
  matches: MatchRow[];
  planet: PlanetRow[];
}

export interface ReportArgs {
  seeds: number;
  from: number;
  bout: string | null;
  prize: PrizeLasts;
  standin: boolean;
  planet: number;
  dump: string;
  merge: string[];
  quiet: boolean;
}

// The command line read, unknown kinds and prize lengths refused.
export function readArgs(argv: readonly string[]): ReportArgs {
  const opt = (name: string, fallback: string): string => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
  };
  const whole = (name: string, fallback: number): number => {
    const n = Number(opt(name, String(fallback)));
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  const prize = opt('--prize', PRIZE_LASTS);
  if (prize !== 'next' && prize !== 'all') throw new Error(`--prize is next or all, not ${prize}`);
  const bout = opt('--bout', '');
  if (bout !== '' && !boutKindOf(bout)) throw new Error(`no bout kind ${bout}`);
  return {
    seeds: whole('--seeds', 6),
    from: whole('--from', 1),
    bout: bout === '' ? null : bout,
    prize,
    standin: argv.includes('--standin'),
    planet: whole('--planet', 1),
    dump: opt('--dump', ''),
    merge: opt('--merge', '')
      .split(',')
      .filter((x) => x.trim() !== ''),
    quiet: argv.includes('--quiet'),
  };
}

// The kinds the matches draw from: one alone, or the released pool.
export function poolOf(bout: string | null): BoutKind[] {
  if (bout !== null) {
    const kind = boutKindOf(bout);
    if (!kind) throw new Error(`no bout kind ${bout}`);
    return [kind];
  }
  const pool = boutPool();
  if (pool.length === 0) throw new Error('no bout kind is released: name one with --bout');
  return pool;
}

// The fighting share, read the same way in a bout and in a battle royale:
// fed every tick's events, sampled once a second.
class FightGauge {
  nearS = 0;
  fightS = 0;
  private readonly lastHit = new Map<number, number>();

  constructor(private readonly seats: ReadonlySet<number>) {}

  onEvents(events: readonly SimEvent[], time: number): void {
    for (const e of events) {
      if (e.type !== 'damage' || e.sourceId === e.targetId) continue;
      if (this.seats.has(e.sourceId) && this.seats.has(e.targetId)) {
        this.lastHit.set(e.sourceId, time);
      }
    }
  }

  // Each bot standing: an enemy in its sight within ENGAGE_M, and whether
  // it dealt a champion damage lately.
  sample(sim: Sim, bots: Iterable<number>): void {
    const standing = [...this.seats]
      .map((id) => sim.units.get(id))
      .filter((u) => u !== undefined && !u.dead);
    for (const id of bots) {
      const u = sim.units.get(id);
      if (!u || u.dead) continue;
      const near = standing.some(
        (o) =>
          o !== undefined &&
          o.id !== u.id &&
          o.team !== u.team &&
          dist(u.pos, o.pos) <= ENGAGE_M &&
          sim.isVisible(u.team, o.id),
      );
      if (!near) continue;
      this.nearS++;
      if (sim.time - (this.lastHit.get(u.id) ?? Number.NEGATIVE_INFINITY) <= ENGAGED_S) {
        this.fightS++;
      }
    }
  }
}

const now = (): number => performance.now();

export interface PlayOptions {
  prize: PrizeLasts;
  // The seat that gives no order, or null for none.
  standin: number | null;
}

// The next bout of a match as the server builds it (nextBoutBuild), with
// the stand-in's seat left without a bot (the factory seats it as a
// person's) and the Grafts each seat carries in under the run's prize
// length rather than only the shipped one.
export function boutBuildFor(
  m: ThornfrayMatch,
  opts: PlayOptions,
): { build: BoutBuild; seats: RoyaleSeatPick[]; bout: RoyaleBoutArgs } {
  const build = nextBoutBuild(m, () => null);
  if (!build) throw new Error('the match is over');
  const seats = build.seats.map((s, i): RoyaleSeatPick => {
    if (i !== opts.standin) return s;
    const { bot: _bot, ...rest } = s;
    return rest;
  });
  return { build, seats, bout: { ...build.bout, grafts: carriedGrafts(m.ledger, opts.prize) } };
}

// The next bout of a match, built and played to its end: what it was, and
// its result for the ledger.
export function playBout(
  m: ThornfrayMatch,
  factory: RoyaleSimFactory,
  opts: PlayOptions,
): { row: BoutRow; result: BoutResult } {
  const { build, seats, bout } = boutBuildFor(m, opts);
  const built = factory(build.seed, build.kind.base, seats, 1, bout);
  if (!built.bout) throw new Error('not a bout');
  const host = built.bout;
  const sim = built.sim as unknown as Sim;
  const mode = sim.royaleMode!;
  const unitIds = built.unitIds;
  const seatOf = new Map(unitIds.map((id, i) => [id, i]));
  const who: SeatKind[] = unitIds.map((id, i) =>
    i === opts.standin ? 'standin' : mode.skillOf(id),
  );
  // Each bot seat's policy again, the same as royaleBotPolicy's with the
  // brain's labels counted: the trace never changes a decision.
  const decided: Record<string, number> = {};
  const bots: number[] = [];
  unitIds.forEach((id, i) => {
    if (i === opts.standin) return;
    bots.push(id);
    const skill = ROYALE_SKILLS[mode.skillOf(id)];
    const boutBots = mode.bout?.kind.bots ?? null;
    const trace = (why: string): void => {
      if (mode.state.stage === 'play') decided[why] = (decided[why] ?? 0) + 1;
    };
    const policy: Policy = (obs, rng) => decide(obs, rng, mode.layout, skill, trace, boutBots);
    sim.attachPolicy(id, policy);
  });
  const gauge = new FightGauge(new Set(unitIds));
  const caches = new Array<number>(unitIds.length).fill(0);
  let firstFall: number | null = null;
  let falls = 0;
  let tickMs = 0;
  let tickMax = 0;
  let playTicks = 0;
  const cap = Math.round((DROP_S + build.kind.playS + BOUT_SLACK_S) / DT);
  while (mode.state.stage !== 'over' && sim.tickCount < cap) {
    const t0 = now();
    const events = sim.tick();
    const ms = now() - t0;
    if (mode.state.stage === 'drop') continue;
    tickMs += ms;
    playTicks++;
    if (ms > tickMax) tickMax = ms;
    gauge.onEvents(events, sim.time);
    for (const e of events) {
      if (e.type === 'royale_cache') {
        const seat = seatOf.get(e.unitId);
        if (seat !== undefined) caches[seat]! += 1;
      } else if (e.type === 'death' && seatOf.has(e.unitId)) {
        falls++;
        firstFall ??= sim.time - mode.state.dropEndsAt;
      }
    }
    if (sim.tickCount % TICK_RATE === 0) gauge.sample(sim, bots);
  }
  const s = mode.state;
  const over = s.stage === 'over';
  const result = host.result();
  const b = s.bout!;
  const row: BoutRow = {
    index: build.index,
    kind: build.kind.id,
    region: build.bout.region,
    final: build.final,
    lengthS: sim.time - s.dropEndsAt,
    endedBy: !over ? 'cap' : sim.time + 1e-9 >= s.endsAt ? 'clock' : 'rule',
    firstFallS: firstFall,
    ranking: result.ranking,
    counts: result.counts,
    paid: [],
    seats: who,
    takedowns: mode.tally.takedowns,
    falls,
    duskFalls: mode.tally.duskDeaths,
    caches,
    seedfallCaches: [...b.seedfalls],
    nearS: gauge.nearS,
    fightS: gauge.fightS,
    decided,
    prizeGrafts: result.prizeGrafts,
    tickMs: playTicks > 0 ? tickMs / playTicks : 0,
    tickMaxMs: tickMax,
    checksum: sim.checksum(),
  };
  return { row, result };
}

// A whole Thornfray of house bots on a match seed: its six bouts chained
// through the ledger, each recorded with the bushels it paid.
export function playThornfray(
  matchSeed: number,
  pool: readonly BoutKind[],
  factory: RoyaleSimFactory,
  opts: PlayOptions,
  onBout?: (row: BoutRow) => void,
): MatchRow {
  const m = dealThornfray([], matchSeed, pool);
  const bouts: BoutRow[] = [];
  let leaderBeforeFinal = -1;
  for (let i = 0; i < m.ledger.draws.length; i++) {
    if (i === m.ledger.draws.length - 1) leaderBeforeFinal = standings(m.ledger)[0]!;
    const { row, result } = playBout(m, factory, opts);
    recordBout(m.ledger, result);
    row.paid = boutPaid(m.ledger, i);
    bouts.push(row);
    onBout?.(row);
  }
  return {
    seed: matchSeed,
    prize: opts.prize,
    pool: pool.map((k) => k.id),
    standin: opts.standin,
    bouts,
    totals: totals(m.ledger),
    standings: standings(m.ledger),
    winner: matchWinner(m.ledger)!,
    leaderBeforeFinal,
  };
}

// A battle royale of fifty house bots, dealt as the server deals one
// nobody joined, for the planet's fighting share.
export function playPlanet(
  factory: RoyaleSimFactory,
  variant: RoyaleVariant,
  seed: number,
): PlanetRow {
  const built = factory(seed, variant, royaleSeats([], seed), 1);
  const sim = built.sim as unknown as Sim;
  const mode = sim.royaleMode!;
  const gauge = new FightGauge(new Set(built.unitIds));
  const cap = Math.round((DROP_S + PLAY_S + PLANET_SLACK_S) / DT);
  let tickMs = 0;
  let playTicks = 0;
  while (mode.state.stage !== 'over' && sim.tickCount < cap) {
    const t0 = now();
    const events = sim.tick();
    const ms = now() - t0;
    if (mode.state.stage === 'drop') continue;
    tickMs += ms;
    playTicks++;
    gauge.onEvents(events, sim.time);
    if (sim.tickCount % TICK_RATE === 0) gauge.sample(sim, built.unitIds);
  }
  return {
    variant,
    seed,
    lengthS: sim.time - mode.state.dropEndsAt,
    nearS: gauge.nearS,
    fightS: gauge.fightS,
    tickMs: playTicks > 0 ? tickMs / playTicks : 0,
  };
}

// The summary's figures, pure over what was played.

const sum = (xs: readonly number[]): number => xs.reduce((a, x) => a + x, 0);
const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? Number.NaN : sum(xs) / xs.length;
export const lowerMedian = (xs: readonly number[]): number => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
};
export const share = (part: number, whole: number): number =>
  whole > 0 ? part / whole : Number.NaN;

// How often the leader before the Final won the match.
export function leaderHolds(matches: readonly MatchRow[]): { held: number; of: number } {
  const played = matches.filter((m) => m.leaderBeforeFinal >= 0);
  return {
    held: played.filter((m) => m.leaderBeforeFinal === m.winner).length,
    of: played.length,
  };
}

// How often a bout's winner won the next bout, and its mean place there,
// by the prize's length the matches were played under.
export interface Repeats {
  prize: PrizeLasts;
  pairs: number;
  repeats: number;
  nextPlace: number;
}

export function winnerRepeats(matches: readonly MatchRow[]): Repeats[] {
  const out: Repeats[] = [];
  for (const prize of ['next', 'all'] as const) {
    const ms = matches.filter((m) => m.prize === prize);
    if (ms.length === 0) continue;
    let pairs = 0;
    let repeats = 0;
    const places: number[] = [];
    for (const m of ms) {
      for (let i = 0; i + 1 < m.bouts.length; i++) {
        const winner = m.bouts[i]!.ranking[0]!;
        const next = m.bouts[i + 1]!.ranking.indexOf(winner) + 1;
        pairs++;
        if (next === 1) repeats++;
        places.push(next);
      }
    }
    out.push({ prize, pairs, repeats, nextPlace: mean(places) });
  }
  return out;
}

// The totals by final place, averaged over the matches (first place
// first), and the winner's mean margin over the second.
export function bushelSpread(matches: readonly MatchRow[]): { byPlace: number[]; margin: number } {
  if (matches.length === 0) return { byPlace: [], margin: Number.NaN };
  const seats = matches[0]!.totals.length;
  const byPlace = Array.from({ length: seats }, (_, p) =>
    mean(matches.map((m) => m.totals[m.standings[p]!] ?? 0)),
  );
  const margin = mean(
    matches.map((m) => (m.totals[m.standings[0]!] ?? 0) - (m.totals[m.standings[1]!] ?? 0)),
  );
  return { byPlace, margin };
}

// One kind over every bout of it played.
export interface KindSummary {
  kind: string;
  bouts: number;
  lengths: { min: number; median: number; max: number };
  endedBy: Record<BoutRow['endedBy'], number>;
  firstFall: number;
  // Mean place (1 the first) and wins, by who played the seat.
  places: Partial<Record<SeatKind, { place: number; wins: number; seats: number }>>;
  // The winner's count and the field's (the lower median of every seat's).
  winnerCount: number;
  fieldCount: number;
  takedowns: number;
  falls: number;
  duskFalls: number;
  // Caches opened a seat a bout, overall and by region; Seedfall caches a
  // bout.
  caches: number;
  cachesByRegion: Partial<Record<RegionId, { caches: number; bouts: number }>>;
  seedfallCaches: number;
  nearS: number;
  fightS: number;
  decided: Record<string, number>;
  tickMs: number;
  tickMaxMs: number;
}

export function kindSummary(matches: readonly MatchRow[], kind: string): KindSummary | null {
  const bouts = matches.flatMap((m) => m.bouts).filter((b) => b.kind === kind);
  if (bouts.length === 0) return null;
  const lengths = bouts.map((b) => b.lengthS);
  const endedBy: KindSummary['endedBy'] = { rule: 0, clock: 0, cap: 0 };
  for (const b of bouts) endedBy[b.endedBy]++;
  const places: KindSummary['places'] = {};
  for (const b of bouts) {
    b.seats.forEach((who, seat) => {
      const row = places[who] ?? { place: 0, wins: 0, seats: 0 };
      const place = b.ranking.indexOf(seat) + 1;
      row.place += place;
      row.seats++;
      if (place === 1) row.wins++;
      places[who] = row;
    });
  }
  for (const row of Object.values(places)) row.place /= row.seats;
  const cachesByRegion: KindSummary['cachesByRegion'] = {};
  for (const b of bouts) {
    const row = cachesByRegion[b.region] ?? { caches: 0, bouts: 0 };
    row.caches += sum(b.caches) / b.caches.length;
    row.bouts++;
    cachesByRegion[b.region] = row;
  }
  for (const row of Object.values(cachesByRegion)) row.caches /= row.bouts;
  const decided: Record<string, number> = {};
  for (const b of bouts) {
    for (const [why, n] of Object.entries(b.decided)) decided[why] = (decided[why] ?? 0) + n;
  }
  const falls = bouts.map((b) => b.firstFallS).filter((x): x is number => x !== null);
  return {
    kind,
    bouts: bouts.length,
    lengths: { min: Math.min(...lengths), median: lowerMedian(lengths), max: Math.max(...lengths) },
    endedBy,
    firstFall: lowerMedian(falls),
    places,
    winnerCount: lowerMedian(bouts.map((b) => b.counts[b.ranking[0]!] ?? 0)),
    fieldCount: lowerMedian(bouts.flatMap((b) => b.counts)),
    takedowns: mean(bouts.map((b) => b.takedowns)),
    falls: mean(bouts.map((b) => b.falls)),
    duskFalls: mean(bouts.map((b) => b.duskFalls)),
    caches: mean(bouts.map((b) => sum(b.caches) / b.caches.length)),
    cachesByRegion,
    seedfallCaches: mean(bouts.map((b) => sum(b.seedfallCaches))),
    nearS: sum(bouts.map((b) => b.nearS)),
    fightS: sum(bouts.map((b) => b.fightS)),
    decided,
    tickMs: mean(bouts.map((b) => b.tickMs)),
    tickMaxMs: Math.max(...bouts.map((b) => b.tickMaxMs)),
  };
}

// The stand-in's bushels in each match it sat in, and its places by kind.
export function standinSummary(matches: readonly MatchRow[]): {
  bushels: number[];
  places: Record<string, number[]>;
} {
  const bushels: number[] = [];
  const places: Record<string, number[]> = {};
  for (const m of matches) {
    if (m.standin === null) continue;
    bushels.push(m.totals[m.standin] ?? 0);
    for (const b of m.bouts) {
      places[b.kind] ??= [];
      places[b.kind]!.push(b.ranking.indexOf(m.standin) + 1);
    }
  }
  return { bushels, places };
}

// Dumps written before, joined.
export function mergeDumps(dumps: readonly Dump[]): Dump {
  return {
    matches: dumps.flatMap((d) => d.matches),
    planet: dumps.flatMap((d) => d.planet),
  };
}

// The printing.

const clock = (s: number): string => {
  if (!Number.isFinite(s)) return '-';
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const pct = (x: number): string => (Number.isNaN(x) ? '-' : `${(100 * x).toFixed(1)}%`);
const num = (x: number, digits = 1): string => (Number.isNaN(x) ? '-' : x.toFixed(digits));
const VARIANT_NAME: Record<RoyaleVariant, string> = { respawn: 'Respawn', one_life: 'One life' };
const SEAT_KINDS: readonly SeatKind[] = ['strong', 'normal', 'gentle', 'standin'];

export function boutLine(b: BoutRow): string {
  const winner = b.ranking[0]!;
  const ended = b.endedBy === 'rule' ? 'its rule' : b.endedBy === 'clock' ? 'its clock' : 'the cap';
  return (
    `  bout ${b.index + 1}${b.final ? ' (Final)' : ''} ${b.kind} in ${b.region}: ` +
    `${ended} at ${clock(b.lengthS)}, first fall ${b.firstFallS === null ? '-' : clock(b.firstFallS)}, ` +
    `${b.takedowns} takedowns, ${b.duskFalls} to the Dusk, ` +
    `caches ${sum(b.caches)} (Seedfall ${sum(b.seedfallCaches)}), ` +
    `fighting ${pct(share(b.fightS, b.nearS))}, ` +
    `seat ${winner} (${b.seats[winner]}) wins on ${b.counts[winner]}, ` +
    `tick ${num(b.tickMs, 2)} ms`
  );
}

export function matchLine(m: MatchRow): string {
  const w = m.winner;
  return (
    `thornfray seed ${m.seed} (prize ${m.prize}): seat ${w} (${m.bouts[0]?.seats[w] ?? '?'}) ` +
    `wins on ${m.totals[w]} bushels; the leader before the Final, seat ${m.leaderBeforeFinal}, ` +
    `${m.leaderBeforeFinal === w ? 'holds' : 'is passed'}` +
    (m.standin !== null ? `; the stand-in ${m.totals[m.standin]} bushels` : '')
  );
}

export function planetLine(p: PlanetRow): string {
  return (
    `battle royale ${VARIANT_NAME[p.variant]} seed ${p.seed}: over at ${clock(p.lengthS)}, ` +
    `fighting ${pct(share(p.fightS, p.nearS))} of ${p.nearS} bot-seconds, ` +
    `tick ${num(p.tickMs, 2)} ms`
  );
}

export function formatSummary(dump: Dump, kinds: readonly BoutKind[] = BOUT_KINDS): string {
  const { matches, planet: planetRows } = dump;
  const out: string[] = [];
  const bouts = matches.reduce((a, m) => a + m.bouts.length, 0);
  out.push(`summary: ${matches.length} matches, ${bouts} bouts`);
  const planetShare = (variant: RoyaleVariant): string => {
    const rows = planetRows.filter((p) => p.variant === variant);
    if (rows.length === 0) return 'not played';
    return (
      `${pct(share(sum(rows.map((p) => p.fightS)), sum(rows.map((p) => p.nearS))))} ` +
      `over ${rows.length} match${rows.length === 1 ? '' : 'es'}`
    );
  };
  const played = [...new Set(matches.flatMap((m) => m.bouts.map((b) => b.kind)))];
  for (const id of played) {
    const k = kindSummary(matches, id)!;
    const kind = kinds.find((x) => x.id === id);
    const base = kind?.base ?? 'respawn';
    out.push(`${id} (${k.bouts} bouts, ${VARIANT_NAME[base]}, clock ${kind?.playS ?? '?'} s)`);
    out.push(
      `  length ${clock(k.lengths.min)} to ${clock(k.lengths.max)}, median ${clock(k.lengths.median)}; ` +
        `ended by its rule ${k.endedBy.rule}, its clock ${k.endedBy.clock}` +
        (k.endedBy.cap > 0 ? `, CUT AT THE CAP ${k.endedBy.cap}` : '') +
        `; first fall median ${clock(k.firstFall)}`,
    );
    const placeBits = SEAT_KINDS.filter((w) => k.places[w]).map((w) => {
      const p = k.places[w]!;
      return `${w} ${num(p.place)} (${p.wins} wins of ${p.seats} seats)`;
    });
    out.push(`  mean place: ${placeBits.join(', ')}`);
    out.push(
      `  count (${kind?.hud.word ?? 'count'}): the winner's median ${num(k.winnerCount)}, ` +
        `every seat's ${num(k.fieldCount)}`,
    );
    out.push(
      `  a bout: ${num(k.takedowns)} takedowns, ${num(k.falls)} falls, ` +
        `${num(k.duskFalls)} to the Dusk, ${num(k.seedfallCaches)} Seedfall caches`,
    );
    const regions = REGION_IDS.filter((r) => k.cachesByRegion[r]).map((r) => {
      const c = k.cachesByRegion[r]!;
      return `${r} ${num(c.caches, 2)} (${c.bouts})`;
    });
    out.push(`  caches a seat a bout: ${num(k.caches, 2)}; by region ${regions.join(', ')}`);
    out.push(
      `  fighting ${pct(share(k.fightS, k.nearS))} of ${k.nearS} bot-seconds with an enemy ` +
        `within ${ENGAGE_M} m in sight (the planet in ${VARIANT_NAME[base]}: ${planetShare(base)})`,
    );
    const allDecided = sum(Object.values(k.decided));
    const top = Object.entries(k.decided)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([why, n]) => `${why} ${pct(share(n, allDecided))}`);
    out.push(`  decided: ${top.join(', ')}`);
    out.push(`  tick ${num(k.tickMs, 2)} ms mean, ${num(k.tickMaxMs, 1)} ms at most`);
  }
  if (matches.length > 0) {
    const spread = bushelSpread(matches);
    out.push('the matches');
    out.push(
      `  bushels by final place: ${spread.byPlace.map((x) => num(x)).join(', ')}; ` +
        `the winner's margin ${num(spread.margin)}`,
    );
    const lead = leaderHolds(matches);
    out.push(
      `  the leader before the Final wins: ${lead.held} of ${lead.of} (${pct(share(lead.held, lead.of))})`,
    );
    const even = 1 / (matches[0]!.totals.length || 1);
    for (const r of winnerRepeats(matches)) {
      out.push(
        `  prize ${r.prize}: a bout's winner wins the next ${r.repeats} of ${r.pairs} ` +
          `(${pct(share(r.repeats, r.pairs))}, an even chance ${pct(even)}), its mean place there ${num(r.nextPlace)}`,
      );
    }
    const s = standinSummary(matches);
    if (s.bushels.length > 0) {
      const byKind = Object.entries(s.places).map(
        ([k, ps]) => `${k} ${num(mean(ps))} (${ps.length})`,
      );
      out.push(
        `  the stand-in: bushels ${s.bushels.join(', ')} (mean ${num(mean(s.bushels))}); ` +
          `mean place ${byKind.join(', ')}`,
      );
    }
  }
  return out.join('\n');
}
