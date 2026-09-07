// What was actually played, read off the match log.
//
// scripts/meta_matrix.mjs answers the sim's question: what happens when
// the house styles play each other on fixed seeds. This answers the other
// one, which no amount of simulation can: what the people and bots on this
// deployment picked, and what happened when they did. The two disagreeing
// is information, and until now only one of them existed.
//
// Every finished match is already in DATA_DIR/matches.jsonl with its
// duration, its winner and one row per seat (server/records.ts). Nothing
// is collected for this and nothing is written by it.
//
// Usage:
//   node scripts/meta.mjs /var/lib/docker/volumes/claude-of-legends_game_data/_data
//   node scripts/meta.mjs data 30        the last 30 days only
//
// A match that was abandoned rather than finished never reaches the log,
// so this reports what was played through. The pulse's matches against
// finished is where the difference between the two lives.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface SeatRow {
  // Null on a bot seat: a house bot, or an account's bot fielded in a
  // match. A human seat is one with an account behind it playing by hand.
  accountId: number | null;
  championId: string;
  team: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  // Present when the seat was played by the account's bot rather than by
  // the account (ADR 0013), which makes it a bot seat despite the account.
  way?: string;
}

export interface MatchRow {
  at: number;
  durationS: number;
  winner: number;
  rated: boolean;
  queue?: string;
  players: readonly SeatRow[];
}

export interface ChampionRow {
  championId: string;
  seats: number;
  wins: number;
  handSeats: number;
  handWins: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
}

// A seat somebody played by hand, as opposed to one a Policy played. The
// account's own bot carries an account id and is not a person, which is
// the one case that would quietly turn a bot's pick into a player's.
export function byHand(seat: SeatRow): boolean {
  return seat.accountId !== null && seat.way === undefined;
}

export function championRows(matches: readonly MatchRow[]): ChampionRow[] {
  const rows = new Map<string, ChampionRow>();
  for (const match of matches) {
    for (const seat of match.players) {
      const row = rows.get(seat.championId) ?? {
        championId: seat.championId,
        seats: 0,
        wins: 0,
        handSeats: 0,
        handWins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
      };
      const won = seat.team === match.winner;
      row.seats += 1;
      if (won) row.wins += 1;
      if (byHand(seat)) {
        row.handSeats += 1;
        if (won) row.handWins += 1;
      }
      row.kills += seat.kills;
      row.deaths += seat.deaths;
      row.assists += seat.assists;
      row.cs += seat.cs;
      rows.set(seat.championId, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.seats - a.seats || (a.championId < b.championId ? -1 : 1),
  );
}

export interface Overview {
  matches: number;
  withHuman: number;
  rated: number;
  arena: number;
  medianS: number;
  blueWins: number;
}

export function overview(matches: readonly MatchRow[]): Overview {
  const durations = matches.map((m) => m.durationS).sort((a, b) => a - b);
  return {
    matches: matches.length,
    withHuman: matches.filter((m) => m.players.some(byHand)).length,
    rated: matches.filter((m) => m.rated).length,
    arena: matches.filter((m) => m.queue === 'arena').length,
    medianS: median(durations),
    // Which side won, which is the one balance question the map itself
    // can answer: the two halves are mirrored, so a lasting gap here is a
    // bug rather than a meta.
    blueWins: matches.filter((m) => m.winner === 0).length,
  };
}

export function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

export function readMatches(dir: string, since = 0): MatchRow[] {
  let text: string;
  try {
    text = readFileSync(path.join(dir, 'matches.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const rows: MatchRow[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let entry: Partial<MatchRow>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry.at !== 'number' || !Array.isArray(entry.players)) continue;
    if (entry.at < since) continue;
    rows.push({
      at: entry.at,
      durationS: typeof entry.durationS === 'number' ? entry.durationS : 0,
      winner: typeof entry.winner === 'number' ? entry.winner : -1,
      rated: entry.rated === true,
      ...(typeof entry.queue === 'string' ? { queue: entry.queue } : {}),
      players: entry.players.map((p) => {
        const seat = p as Partial<SeatRow>;
        return {
          accountId: typeof seat.accountId === 'number' ? seat.accountId : null,
          championId: typeof seat.championId === 'string' ? seat.championId : '?',
          team: typeof seat.team === 'number' ? seat.team : -1,
          kills: num(seat.kills),
          deaths: num(seat.deaths),
          assists: num(seat.assists),
          cs: num(seat.cs),
          ...(typeof seat.way === 'string' ? { way: seat.way } : {}),
        };
      }),
    });
  }
  return rows;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function pct(part: number, whole: number): string {
  return whole <= 0 ? '   -' : `${Math.round((part / whole) * 100)}%`.padStart(4);
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function per(total: number, seats: number): string {
  return seats <= 0 ? '  -' : (total / seats).toFixed(1).padStart(5);
}

export function render(o: Overview, rows: readonly ChampionRow[]): string {
  const head = `${'Champion'.padEnd(14)}${'Seats'.padStart(6)}${'Win'.padStart(6)}${'By hand'.padStart(9)}${'Win'.padStart(6)}${'K'.padStart(7)}${'D'.padStart(6)}${'A'.padStart(6)}${'CS'.padStart(7)}`;
  const line = (r: ChampionRow): string =>
    `${r.championId.padEnd(14)}${String(r.seats).padStart(6)}${pct(r.wins, r.seats).padStart(6)}` +
    `${String(r.handSeats).padStart(9)}${pct(r.handWins, r.handSeats).padStart(6)}` +
    `${per(r.kills, r.seats).padStart(7)}${per(r.deaths, r.seats).padStart(6)}` +
    `${per(r.assists, r.seats).padStart(6)}${per(r.cs, r.seats).padStart(7)}`;
  return [
    `Matches   ${o.matches}   with a human ${o.withHuman}   rated ${o.rated}   arena ${o.arena}`,
    `Duration  median ${clock(o.medianS)}`,
    `Sides     blue won ${o.blueWins} of ${o.matches} (${pct(o.blueWins, o.matches).trim()})`,
    '',
    head,
    ...rows.map(line),
    '',
    'Seats    every seat on that champion, human and bot alike',
    'By hand  the seats a person actually played, which is the column',
    '         with a meta in it; the rest is the house and the Arena',
    'K D A CS per seat, over every seat on the champion',
  ].join('\n');
}

function main(): void {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('usage: node scripts/meta.mjs <data dir> [days]');
    process.exit(2);
    return;
  }
  const days = process.argv[3] === undefined ? 0 : Number(process.argv[3]);
  const since = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  const matches = readMatches(dir, since);
  const span = days > 0 ? `the last ${days} days` : 'every match logged';
  console.log(`Match log: ${dir}, ${span}\n`);
  console.log(render(overview(matches), championRows(matches)));
}

if (process.argv[1]?.endsWith('meta_report.cjs')) main();
