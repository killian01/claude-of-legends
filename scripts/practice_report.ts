// What the practice matches say, read off the practice reports the
// browser sends at the end of each one (src/net/practice_report.ts,
// stored by server/practice_reports.ts). The question behind it: are the
// house bots the right strength for the people who meet them first? A
// practice match runs in the browser against bots, so the match log knows
// nothing of it; this is the only view.
//
// Usage, on the machine that holds the data:
//   node scripts/practice.mjs /var/lib/docker/volumes/claude-of-legends_game_data/_data
//   node scripts/practice.mjs <data dir> 30      the last 30 days only
//
// Read-only. The reports carry no name and none is printed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readPracticeLines, type StoredPracticeReport } from '../server/practice_reports';
import type { PracticeResult, PracticeRow } from '../src/net/practice_report';

export interface Tally {
  n: number;
  won: number;
  lost: number;
  left: number;
}

export interface ChampionLine extends Tally {
  championId: string;
  kills: number;
  deaths: number;
  assists: number;
  csPerMin: number;
  level: number;
  minutes: number;
}

// Kills and deaths per ten minutes of play, for one kind of seat.
export interface SeatRate {
  kills: number;
  deaths: number;
}

export interface LeavingLine {
  bucket: string;
  n: number;
  deaths: number;
  level: number;
}

export interface KillerLine {
  championId: string;
  n: number;
  kills: number;
}

export interface PracticeSummary {
  all: Tally;
  minutes: { all: number; finished: number; left: number };
  touch: Tally;
  mouse: Tally;
  visitor: Tally;
  account: Tally;
  champions: ChampionLine[];
  rates: { self: SeatRate; allies: SeatRate; enemies: SeatRate };
  leaving: LeavingLine[];
  killers: KillerLine[];
}

const round = (v: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : round(xs.reduce((a, b) => a + b, 0) / xs.length);
const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return round(s[Math.floor(s.length / 2)] ?? 0);
};

function tally(reports: readonly StoredPracticeReport[]): Tally {
  const by = (r: PracticeResult): number => reports.filter((x) => x.result === r).length;
  return { n: reports.length, won: by('won'), lost: by('lost'), left: by('left') };
}

function selfRow(r: StoredPracticeReport): PracticeRow {
  return r.rows.find((x) => x.self) ?? r.rows[0]!;
}

const LEAVE_BUCKETS: readonly (readonly [string, number])[] = [
  ['under 2 min', 2],
  ['2 to 5 min', 5],
  ['5 to 10 min', 10],
  ['10 to 20 min', 20],
  ['20 min and past', Number.POSITIVE_INFINITY],
];

export function summarizePractice(reports: readonly StoredPracticeReport[]): PracticeSummary {
  const minutesOf = (r: StoredPracticeReport): number => r.seconds / 60;
  const finished = reports.filter((r) => r.result !== 'left');
  const left = reports.filter((r) => r.result === 'left');

  const byChampion = new Map<string, StoredPracticeReport[]>();
  for (const r of reports) {
    const id = r.forged ? 'forged' : selfRow(r).championId;
    byChampion.set(id, [...(byChampion.get(id) ?? []), r]);
  }
  const champions: ChampionLine[] = [...byChampion.entries()]
    .map(([championId, list]) => {
      const rows = list.map(selfRow);
      const minutes = list.map(minutesOf);
      const totalMinutes = minutes.reduce((a, b) => a + b, 0);
      return {
        championId,
        ...tally(list),
        kills: mean(rows.map((x) => x.kills)),
        deaths: mean(rows.map((x) => x.deaths)),
        assists: mean(rows.map((x) => x.assists)),
        csPerMin: totalMinutes > 0 ? round(rows.reduce((a, x) => a + x.cs, 0) / totalMinutes) : 0,
        level: mean(rows.map((x) => x.level)),
        minutes: median(minutes),
      };
    })
    .sort((a, b) => b.n - a.n || a.championId.localeCompare(b.championId));

  // Per ten minutes, over every report at once: the person's seat against
  // the bots beside and against them, which is the strength question in
  // two numbers.
  const rate = (pick: (r: StoredPracticeReport) => PracticeRow[]): SeatRate => {
    let kills = 0;
    let deaths = 0;
    let seatMinutes = 0;
    for (const r of reports) {
      const rows = pick(r);
      for (const x of rows) {
        kills += x.kills;
        deaths += x.deaths;
      }
      seatMinutes += rows.length * minutesOf(r);
    }
    return seatMinutes === 0
      ? { kills: 0, deaths: 0 }
      : { kills: round((kills / seatMinutes) * 10), deaths: round((deaths / seatMinutes) * 10) };
  };
  const rates = {
    self: rate((r) => [selfRow(r)]),
    allies: rate((r) => r.rows.filter((x) => !x.self && x.team === selfRow(r).team)),
    enemies: rate((r) => r.rows.filter((x) => x.team !== selfRow(r).team)),
  };

  const leaving: LeavingLine[] = LEAVE_BUCKETS.map(([bucket, limit], i) => {
    const floor = i === 0 ? 0 : LEAVE_BUCKETS[i - 1]![1];
    const inBucket = left.filter((r) => minutesOf(r) >= floor && minutesOf(r) < limit);
    const rows = inBucket.map(selfRow);
    return {
      bucket,
      n: inBucket.length,
      deaths: mean(rows.map((x) => x.deaths)),
      level: mean(rows.map((x) => x.level)),
    };
  });

  const killerRows = new Map<string, number[]>();
  for (const r of reports) {
    const mine = selfRow(r).team;
    for (const x of r.rows) {
      if (x.team === mine) continue;
      killerRows.set(x.championId, [...(killerRows.get(x.championId) ?? []), x.kills]);
    }
  }
  const killers: KillerLine[] = [...killerRows.entries()]
    .map(([championId, kills]) => ({ championId, n: kills.length, kills: mean(kills) }))
    .sort((a, b) => b.kills - a.kills || a.championId.localeCompare(b.championId))
    .slice(0, 5);

  return {
    all: tally(reports),
    minutes: {
      all: median(reports.map(minutesOf)),
      finished: median(finished.map(minutesOf)),
      left: median(left.map(minutesOf)),
    },
    touch: tally(reports.filter((r) => r.touch)),
    mouse: tally(reports.filter((r) => !r.touch)),
    visitor: tally(reports.filter((r) => !r.signedIn)),
    account: tally(reports.filter((r) => r.signedIn)),
    champions,
    rates,
    leaving,
    killers,
  };
}

const pct = (part: number, whole: number): string =>
  whole === 0 ? '-' : `${Math.round((part / whole) * 100)}%`;
const tallyText = (t: Tally): string =>
  `${t.n} played, won ${pct(t.won, t.n)}, lost ${pct(t.lost, t.n)}, left ${pct(t.left, t.n)}`;

export function formatPracticeSummary(s: PracticeSummary): string {
  const lines: string[] = [];
  lines.push(`Practice matches: ${tallyText(s.all)}`);
  lines.push(
    `Minutes, median: ${s.minutes.all} over all, ${s.minutes.finished} when played through, ` +
      `${s.minutes.left} when left`,
  );
  lines.push(`By touch: ${tallyText(s.touch)}; by mouse: ${tallyText(s.mouse)}`);
  lines.push(`Visitors: ${tallyText(s.visitor)}; accounts: ${tallyText(s.account)}`);
  lines.push('');
  lines.push('By champion played (averages per match, cs per minute, median minutes)');
  lines.push(
    `${'champion'.padEnd(18)}${'n'.padStart(4)}${'won'.padStart(6)}${'left'.padStart(6)}` +
      `${'K'.padStart(6)}${'D'.padStart(6)}${'A'.padStart(6)}${'cs/m'.padStart(7)}${'lvl'.padStart(6)}${'min'.padStart(6)}`,
  );
  for (const c of s.champions) {
    lines.push(
      `${c.championId.padEnd(18)}${String(c.n).padStart(4)}${pct(c.won, c.n).padStart(6)}` +
        `${pct(c.left, c.n).padStart(6)}${String(c.kills).padStart(6)}${String(c.deaths).padStart(6)}` +
        `${String(c.assists).padStart(6)}${String(c.csPerMin).padStart(7)}${String(c.level).padStart(6)}` +
        `${String(c.minutes).padStart(6)}`,
    );
  }
  lines.push('');
  lines.push('Per ten minutes of play, kills and deaths');
  lines.push(`  the person:     ${s.rates.self.kills} kills, ${s.rates.self.deaths} deaths`);
  lines.push(`  the ally bots:  ${s.rates.allies.kills} kills, ${s.rates.allies.deaths} deaths`);
  lines.push(`  the enemy bots: ${s.rates.enemies.kills} kills, ${s.rates.enemies.deaths} deaths`);
  lines.push('');
  lines.push('When people leave (matches left, deaths and level at that point)');
  for (const l of s.leaving) {
    lines.push(
      `  ${l.bucket.padEnd(18)}${String(l.n).padStart(4)}   deaths ${l.deaths}, level ${l.level}`,
    );
  }
  lines.push('');
  lines.push('Enemy bots by kills per match');
  for (const k of s.killers) {
    lines.push(`  ${k.championId.padEnd(18)}${String(k.kills).padStart(6)} over ${k.n} matches`);
  }
  return lines.join('\n');
}

export function loadPracticeReports(dir: string, days = 0): StoredPracticeReport[] {
  let text: string;
  try {
    text = readFileSync(path.join(dir, 'practice.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const reports = readPracticeLines(text);
  if (!(days > 0)) return reports;
  const cut = Date.now() - days * 24 * 3600 * 1000;
  return reports.filter((r) => r.at >= cut);
}

function main(): void {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/practice.mjs <data dir> [days]');
    process.exit(2);
  }
  const days = process.argv[3] === undefined ? 0 : Number(process.argv[3]);
  const reports = loadPracticeReports(dir, days);
  if (reports.length === 0) {
    console.log(`no practice reports under ${dir}${days > 0 ? ` in the last ${days} days` : ''}`);
    return;
  }
  console.log(formatPracticeSummary(summarizePractice(reports)));
}

if (process.argv[1]?.endsWith('practice_report.cjs')) main();
