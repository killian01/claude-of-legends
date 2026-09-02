// The Arena's running half (docs/design/bots.md, ADR 0013): a planned match
// goes to the runner, its outcome moves the Arena ratings through the same
// arithmetic a live match uses (server/match_rating.ts), the replay is
// saved and the match recorded like any other, queue 'arena'. Rounds run
// when due, on-demand matches from the daily allocation. Every dependency
// is injected, so a test runs the whole path inline with a canned result.

import type { FastMatchRequest, FastMatchResult } from '../src/fast_match';
import type { TeamId } from '../src/sim/types';
import {
  ARENA_PLAY_NOW_PER_DAY,
  ARENA_ROUND_MS,
  type ArenaMatchPlan,
  arenaPicks,
  dueRound,
  planPlayNow,
  planRound,
  playNowAllowed,
} from './arena';
import type { BotStore } from './bot_store';
import type { BotOutcome } from './bots';
import { type OwnedSeat, type RatingBook, rateMatch } from './match_rating';
import { buildMatchRecord, type MatchRecord } from './records';

// A full match at 20 Hz runs 18 to 25 minutes; past this the Arena calls
// it a draw and records nothing.
export const ARENA_MAX_TICKS = 20 * 60 * 40;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ArenaDeps {
  store: BotStore;
  runner: { run: (req: FastMatchRequest) => Promise<FastMatchResult> };
  nameOf: (accountId: number) => string | null;
  // Match ids are shared with live matches, so replay ids never collide.
  nextMatchId: () => number;
  // May throw; the match is then recorded without a replay.
  saveReplay: (id: number, record: FastMatchResult['record']) => void;
  recordMatch: (rec: MatchRecord) => void;
  now?: () => number;
  maxTicks?: number;
  roundMs?: number;
  playNowPerDay?: number;
  log?: (line: string) => void;
}

export interface ArenaSeatResult {
  accountId: number;
  botId: string;
  team: TeamId;
  delta: number;
  rating: number;
}

export interface ArenaMatchSummary {
  matchId: number;
  winner: TeamId | null;
  ticks: number;
  rated: boolean;
  replayId?: number;
  seats: ArenaSeatResult[];
}

function poolOf(deps: ArenaDeps) {
  return {
    ratingOf: (accountId: number) => deps.store.botRating(accountId, 'arena').rating,
    nameOf: deps.nameOf,
  };
}

export async function runArenaMatch(
  deps: ArenaDeps,
  plan: ArenaMatchPlan,
): Promise<ArenaMatchSummary> {
  const now = (deps.now ?? Date.now)();
  const matchId = deps.nextMatchId();
  const picks = arenaPicks(plan);
  const result = await deps.runner.run({
    seed: (now % 2_000_000_000) + matchId,
    picks,
    maxTicks: deps.maxTicks ?? ARENA_MAX_TICKS,
  });
  const summary: ArenaMatchSummary = {
    matchId,
    winner: result.winner,
    ticks: result.ticks,
    rated: false,
    seats: plan.seats.map((s) => ({
      accountId: s.bot.accountId,
      botId: s.bot.id,
      team: s.team,
      delta: 0,
      rating: deps.store.botRating(s.bot.accountId, 'arena').rating,
    })),
  };
  if (result.winner === null) {
    deps.log?.(`arena match ${matchId}: no winner after ${result.ticks} ticks, not recorded`);
    return summary;
  }
  const winner = result.winner;
  // The rating: every bot seat is an owned seat of its account's bot,
  // rated on the Arena way. House bots move nothing.
  const owned: OwnedSeat[] = plan.seats.map((s) => ({
    accountId: s.bot.accountId,
    team: s.team,
    way: 'bot',
  }));
  const book: RatingBook = {
    read: (pid) => deps.store.botRating(pid, 'arena').rating,
    apply: (pid, _way, delta) => deps.store.applyBotRating(pid, 'arena', delta),
  };
  const outcome = rateMatch(owned, winner, true, book);
  summary.rated = outcome.rated;
  const deltas = new Map<number, number>();
  for (const r of outcome.results) deltas.set(r.accountId, r.delta);
  summary.seats = plan.seats.map((s) => ({
    accountId: s.bot.accountId,
    botId: s.bot.id,
    team: s.team,
    delta: deltas.get(s.bot.accountId) ?? 0,
    rating: deps.store.botRating(s.bot.accountId, 'arena').rating,
  }));
  // The replay first, so the record can point at it.
  let replayId: number | undefined;
  try {
    deps.saveReplay(matchId, result.record);
    replayId = matchId;
  } catch (err) {
    deps.log?.(`arena match ${matchId}: replay save failed: ${(err as Error).message}`);
  }
  summary.replayId = replayId;
  // The record: bot seats carry their account and their way; house bots
  // their champion's name, like a live match.
  const accountIdByUnit = new Map<number, number>();
  const ways = new Map<number, 'bot'>();
  const nameByUnit = new Map<number, string>();
  picks.forEach((p, i) => {
    const unitId = result.unitIds[i];
    if (unitId === undefined) return;
    nameByUnit.set(unitId, p.name);
    const seat = plan.seats[i];
    if (i < plan.seats.length && seat) {
      accountIdByUnit.set(unitId, seat.bot.accountId);
      ways.set(unitId, 'bot');
    }
  });
  const rows = result.score.map((r) => ({ ...r, player: nameByUnit.get(r.unitId) ?? r.player }));
  deps.recordMatch(
    buildMatchRecord(
      rows,
      accountIdByUnit,
      winner,
      result.time,
      now,
      { rated: outcome.rated, deltas, ways, queue: 'arena' },
      replayId,
    ),
  );
  deps.log?.(
    `arena match ${matchId}: team ${winner + 1} won after ${Math.round(result.time)} s ` +
      `(${plan.seats.length} bot seat(s))`,
  );
  return summary;
}

export function roundDue(deps: ArenaDeps): boolean {
  return dueRound(
    deps.store.arenaLastRoundAt(),
    (deps.now ?? Date.now)(),
    deps.roundMs ?? ARENA_ROUND_MS,
  );
}

// A round: every deposited bot plays once. The round's time is written
// first, so a crash mid-round does not replay it on every restart.
export async function runArenaRound(deps: ArenaDeps): Promise<{ matches: number }> {
  const now = (deps.now ?? Date.now)();
  deps.store.setArenaLastRoundAt(now);
  const plans = planRound(deps.store.listDeposited(), poolOf(deps));
  for (const plan of plans) await runArenaMatch(deps, plan);
  if (plans.length > 0) deps.log?.(`arena round: ${plans.length} match(es)`);
  return { matches: plans.length };
}

// One on-demand match for the account's bot, from the daily allocation.
export async function playNow(
  deps: ArenaDeps,
  accountId: number,
  botId: unknown,
): Promise<BotOutcome<ArenaMatchSummary & { myTeam: 0 }>> {
  if (typeof botId !== 'string') return { ok: false, error: 'malformed request' };
  const bot = deps.store.getBot(botId);
  if (!bot || bot.accountId !== accountId)
    return { ok: false, error: 'no such bot on this account' };
  const now = (deps.now ?? Date.now)();
  const cap = deps.playNowPerDay ?? ARENA_PLAY_NOW_PER_DAY;
  if (!playNowAllowed(deps.store.arenaEventsSince(accountId, now - DAY_MS), cap)) {
    return {
      ok: false,
      error: `daily limit reached (${cap} Arena matches per day); try again tomorrow`,
    };
  }
  const plan = planPlayNow(bot, deps.store.listDeposited(), poolOf(deps));
  if (!plan) return { ok: false, error: 'this account cannot enter the Arena' };
  deps.store.addArenaEvent(accountId, now);
  try {
    const summary = await runArenaMatch(deps, plan);
    return { ok: true, ...summary, myTeam: 0 };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
