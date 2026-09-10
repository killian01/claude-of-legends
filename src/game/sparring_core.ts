// Local sparring (docs/design/bots.md): a whole match against house bots
// at full speed, in the browser, free and unrated. The DOM-free half: the
// seats and what comes back (the winner, the play report, and a replay
// record embedding the playbook that played), on the one fast runner the
// Arena uses too (src/fast_match.ts), so the worker and the tests share
// one implementation.

import { FAST_MATCH_MAX_TICKS, type FastMatchRequest, runFastMatch } from '../fast_match';
import type { ReplayPick, ReplayRecord } from '../net/replay';
import { houseName, houseSeats } from '../sim/content/bots/house';
import type { StarOrchard } from '../sim/content/star_orchard';
import type { PlayReport, PlayStats } from '../sim/playbook/report';
import type { PlaybookDef } from '../sim/playbook/types';
import { Rng } from '../sim/rng';
import type { ScoreRow, TeamId } from '../sim/types';

export interface SparBot {
  name: string;
  championId: string;
  sigils: [string, string];
  skin: number;
  playbook: PlaybookDef;
}

// A match request, plus which pick is the sparring bot's (the first by
// default; the series seats it on either side).
export type SparRequest = FastMatchRequest & { botIndex?: number };

export interface SparResult {
  winner: TeamId | null;
  ticks: number;
  // Sim seconds at the end.
  time: number;
  report: PlayReport;
  // The sparring bot's unit id in the report and the replay.
  botUnitId: number;
  // The scoreboard at the end, all ten seats: the line (kills, deaths,
  // assists, creep score, the build) is what the summary leads with
  // (playtest round 3: the play table alone said nothing about the match).
  score: ScoreRow[];
  record: ReplayRecord;
}

// The sparring bot's own scoreboard row.
export function botRow(r: SparResult): ScoreRow | undefined {
  return r.score.find((s) => s.unitId === r.botUnitId);
}

export const SPAR_MAX_TICKS = FAST_MATCH_MAX_TICKS;

// A series is five seeds (docs/design/bots.md, the bar: a change must show
// its effect, and one match cannot).
export const SERIES_SEEDS = 5;

// The sparring bot on team 0, seat 0, then house bots on every other seat
// from the fill (src/sim/fill.ts) drawn from the seed, each on a house
// style drawn from it too (src/sim/content/bots/house.ts): its own team
// completed around its champion, the other team drawn whole, so two
// sparrings on different seeds meet different lineups played differently.
// The same shape the offline practice match builds.
export function sparringPicks(bot: SparBot, seed = 1): ReplayPick[] {
  const rng = new Rng(seed);
  const picks: ReplayPick[] = [
    {
      name: bot.name,
      team: 0,
      championId: bot.championId,
      sigils: bot.sigils,
      skin: bot.skin,
      playbook: bot.playbook,
    },
  ];
  const house = (team: 0 | 1, held: string[]): void => {
    for (const [i, seat] of houseSeats(
      held.map((id) => ({ championId: id })),
      rng,
    ).entries()) {
      picks.push({
        name: houseName(seat.bot),
        team,
        championId: seat.championId,
        sigils: ['riftstep', 'mend'],
        skin: i % 3,
        bot: seat.bot,
      });
    }
  };
  house(0, [bot.championId]);
  house(1, []);
  return picks;
}

export function sparMatch(orchard: StarOrchard, req: SparRequest): SparResult {
  const r = runFastMatch(orchard, req);
  // The seats named from the picks (unit ids come in pick order), as the
  // Arena and the replay viewer name them: the bot, "House sieger".
  const score = r.score.map((row) => {
    const i = r.unitIds.indexOf(row.unitId);
    return i === -1 ? row : { ...row, player: req.picks[i]?.name ?? row.player };
  });
  return {
    winner: r.winner,
    ticks: r.ticks,
    time: r.time,
    report: r.report,
    botUnitId: r.unitIds[req.botIndex ?? 0]!,
    score,
    record: r.record,
  };
}

// The series' seats: the bot on `team` (its first seat), the previous
// version of the same bot on the other team's first seat when there is
// one (the same champion on both sides is allowed: only a team forbids
// duplicates), house bots on every other seat from the fill, on house
// styles drawn from the seed. Sides alternate from seed to seed so the map
// favors neither version.
export function seriesPicks(
  bot: SparBot,
  previous: PlaybookDef | null,
  seed: number,
  team: TeamId,
): { picks: ReplayPick[]; botIndex: number } {
  const rng = new Rng(seed);
  const picks: ReplayPick[] = [];
  let botIndex = 0;
  for (const t of [0, 1] as const) {
    const held: { championId: string }[] = [];
    if (t === team) {
      botIndex = picks.length;
      picks.push({
        name: bot.name,
        team: t,
        championId: bot.championId,
        sigils: bot.sigils,
        skin: bot.skin,
        playbook: bot.playbook,
      });
      held.push({ championId: bot.championId });
    } else if (previous) {
      picks.push({
        name: `${bot.name} (previous)`,
        team: t,
        championId: bot.championId,
        sigils: bot.sigils,
        skin: bot.skin,
        playbook: previous,
      });
      held.push({ championId: bot.championId });
    }
    for (const [i, seat] of houseSeats(held, rng).entries()) {
      picks.push({
        name: houseName(seat.bot),
        team: t,
        championId: seat.championId,
        sigils: ['riftstep', 'mend'],
        skin: i % 3,
        bot: seat.bot,
      });
    }
  }
  return { picks, botIndex };
}

export interface SeriesMatch {
  seed: number;
  // The team the bot played on.
  team: TeamId;
  result: SparResult;
}

export interface SeriesSummary {
  wins: number;
  losses: number;
  draws: number;
  // The bot's plays summed over the series.
  plays: Record<string, PlayStats>;
  deaths: number;
  // The bot's line summed over the series.
  kills: number;
  assists: number;
  cs: number;
}

// The series in numbers: wins from the bot's side, its line and its plays
// summed.
export function summarizeSeries(matches: readonly SeriesMatch[]): SeriesSummary {
  const out: SeriesSummary = {
    wins: 0,
    losses: 0,
    draws: 0,
    plays: {},
    deaths: 0,
    kills: 0,
    assists: 0,
    cs: 0,
  };
  for (const m of matches) {
    if (m.result.winner === null) out.draws++;
    else if (m.result.winner === m.team) out.wins++;
    else out.losses++;
    const row = botRow(m.result);
    if (row) {
      out.kills += row.kills;
      out.assists += row.assists ?? 0;
      out.cs += row.cs ?? 0;
    }
    const mine = m.result.report.units.find((u) => u.unitId === m.result.botUnitId);
    if (!mine) continue;
    out.deaths += mine.deaths;
    for (const [id, s] of Object.entries(mine.plays)) {
      const acc = out.plays[id] ?? { ticks: 0, deaths: 0 };
      out.plays[id] = { ticks: acc.ticks + s.ticks, deaths: acc.deaths + s.deaths };
    }
  }
  return out;
}
