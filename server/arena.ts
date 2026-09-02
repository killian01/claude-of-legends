// The Arena (docs/design/bots.md, ADR 0013): the server-run competition of
// deposited bots. Hourly rounds and on-demand "play now" matches, played
// at full speed with no one present, never coached, rated on the
// account's Arena rating. This module is the pure half: which bots meet
// in which match, on which side, when a round is due, and how many
// on-demand matches an account still has today. The running, rating and
// recording are the server's (server/main.ts through server/arena_runner).

import type { ReplayPick } from '../src/net/replay';
import type { TeamId } from '../src/sim/types';
import { fillWithBots } from './bot_fill';
import type { BotRow } from './bot_store';
import type { MatchPick } from './match';

// One round an hour: the ladder lives at every hour of the day.
export const ARENA_ROUND_MS = 60 * 60 * 1000;
// On-demand matches per account per rolling day.
export const ARENA_PLAY_NOW_PER_DAY = 20;
export const ARENA_TEAM_SIZE = 5;
export const ARENA_MATCH_SIZE = ARENA_TEAM_SIZE * 2;

export interface ArenaSeat {
  bot: BotRow;
  // The owning account's name, the seat's public identity.
  owner: string;
  team: TeamId;
}

export interface ArenaMatchPlan {
  seats: ArenaSeat[];
}

export interface ArenaPool {
  ratingOf: (accountId: number) => number;
  nameOf: (accountId: number) => string | null;
}

// A round is due when the last one is older than the round length, or
// never ran. Lazy, like the weekly creation grant: no timer to survive a
// restart.
export function dueRound(lastAt: number | null, now: number, roundMs = ARENA_ROUND_MS): boolean {
  return lastAt === null || now - lastAt >= roundMs;
}

// Sides snake by rating so the two teams come out even: 1st and 4th
// together, 2nd and 3rd together, and so on.
const SNAKE: readonly TeamId[] = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1];

// Seats a sorted run of bots into one match: one bot per account, no
// duplicate champion inside a team, snaked sides. Bots that cannot fit
// this match are handed back for the next.
function seatMatch(sorted: readonly { bot: BotRow; owner: string }[]): {
  plan: ArenaMatchPlan;
  rest: { bot: BotRow; owner: string }[];
} {
  const seats: ArenaSeat[] = [];
  const rest: { bot: BotRow; owner: string }[] = [];
  const accounts = new Set<number>();
  const champions: [Set<string>, Set<string>] = [new Set(), new Set()];
  const count: [number, number] = [0, 0];
  for (const entry of sorted) {
    if (seats.length >= ARENA_MATCH_SIZE || accounts.has(entry.bot.accountId)) {
      rest.push(entry);
      continue;
    }
    const preferred = SNAKE[seats.length] ?? 0;
    const other: TeamId = preferred === 0 ? 1 : 0;
    let team: TeamId | null = null;
    for (const t of [preferred, other]) {
      if (count[t] < ARENA_TEAM_SIZE && !champions[t].has(entry.bot.championId)) {
        team = t;
        break;
      }
    }
    if (team === null) {
      rest.push(entry);
      continue;
    }
    seats.push({ bot: entry.bot, owner: entry.owner, team });
    accounts.add(entry.bot.accountId);
    champions[team].add(entry.bot.championId);
    count[team] += 1;
  }
  return { plan: { seats }, rest };
}

// A round: every deposited bot once, the strongest together, the rest in
// smaller matches filled with house bots. Deterministic over its inputs.
export function planRound(bots: readonly BotRow[], pool: ArenaPool): ArenaMatchPlan[] {
  let sorted = bots
    .map((bot) => ({ bot, owner: pool.nameOf(bot.accountId) }))
    .filter((e): e is { bot: BotRow; owner: string } => e.owner !== null)
    .sort(
      (a, b) =>
        pool.ratingOf(b.bot.accountId) - pool.ratingOf(a.bot.accountId) ||
        a.bot.id.localeCompare(b.bot.id),
    );
  const plans: ArenaMatchPlan[] = [];
  while (sorted.length > 0) {
    const { plan, rest } = seatMatch(sorted);
    if (plan.seats.length === 0) break;
    plans.push(plan);
    sorted = rest;
  }
  return plans;
}

// One on-demand match for a bot: the pool's closest ratings around it, one
// bot per account, the asking bot always on team 0.
export function planPlayNow(
  bot: BotRow,
  pool: readonly BotRow[],
  ratings: ArenaPool,
): ArenaMatchPlan | null {
  const owner = ratings.nameOf(bot.accountId);
  if (owner === null) return null;
  const mine = ratings.ratingOf(bot.accountId);
  const others = pool
    .filter((b) => b.accountId !== bot.accountId)
    .map((b) => ({ bot: b, owner: ratings.nameOf(b.accountId) }))
    .filter((e): e is { bot: BotRow; owner: string } => e.owner !== null)
    .sort(
      (a, b) =>
        Math.abs(ratings.ratingOf(a.bot.accountId) - mine) -
          Math.abs(ratings.ratingOf(b.bot.accountId) - mine) || a.bot.id.localeCompare(b.bot.id),
    );
  const { plan } = seatMatch([{ bot, owner }, ...others]);
  // The asking bot took the first seat, which the snake puts on team 0.
  return plan;
}

// The match's picks: bot seats by name, playbook embedded, house bots on
// every seat nobody took. The client ids are placeholders: nobody is
// connected to an Arena match.
export function arenaPicks(plan: ArenaMatchPlan): ReplayPick[] {
  const seats: MatchPick[] = plan.seats.map((s, i) => ({
    clientId: -1000 - i,
    name: `${s.owner} (${s.bot.name})`,
    team: s.team,
    championId: s.bot.championId,
    sigils: s.bot.sigils,
    skin: s.bot.skin,
    playbook: s.bot.playbook,
  }));
  return fillWithBots(seats, ARENA_TEAM_SIZE).map((p) => ({
    name: p.name,
    team: p.team,
    championId: p.championId,
    sigils: [p.sigils[0], p.sigils[1]],
    ...(p.skin !== undefined ? { skin: p.skin } : {}),
    ...(p.bot !== undefined ? { bot: p.bot } : {}),
    ...(p.playbook !== undefined ? { playbook: p.playbook } : {}),
  }));
}

// Whether an account may start another on-demand match today.
export function playNowAllowed(usedToday: number, cap = ARENA_PLAY_NOW_PER_DAY): boolean {
  return cap <= 0 || usedToday < cap;
}
