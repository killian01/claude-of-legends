// The night coach, the sparring gate, and the Briefing (docs/design/bots.md,
// plan-bots phase 7). After the Arena has played, the same model that
// writes plays reads a bot's structured report and proposes a patch; the
// proposal is played in a handful of unrated sparring matches against the
// same opponents, with the current playbook and with the candidate, and
// applies only if it wins more. Nothing is applied without the owner
// unless they opted in, and every applied change is a version they can
// undo. The Briefing is what the owner reads: the record, the plays, the
// proposal and what sparring said.

import type { FastMatchRequest, FastMatchResult } from '../src/fast_match';
import type { ReplayPick } from '../src/net/replay';
import { applyPatch, type PatchOp } from '../src/sim/playbook/patch';
import type { PlayReport, PlayStats } from '../src/sim/playbook/report';
import type { PlaybookDef } from '../src/sim/playbook/types';
import type { BotRow, BotStore } from './bot_store';
import type { BotOutcome } from './bots';
import type { CoachAnswer, CoachDeps } from './playbook_suggest';
import type { MatchRecord } from './records';

const DAY_MS = 24 * 60 * 60 * 1000;
// Sparring matches per side of the gate: six matches, about a minute of
// CPU per bot per night, the same allocation for every bot.
export const SPARRING_PER_SIDE = 3;
export const SPARRING_MAX_TICKS = 20 * 60 * 40;

export interface NightCoachDeps {
  store: BotStore;
  runner: { run: (req: FastMatchRequest) => Promise<FastMatchResult> };
  // The coach behind the Academy, asked once per bot per night; null when
  // no key is configured (the Briefing then carries no proposal).
  coach:
    | ((accountId: number, botId: string, message: string) => Promise<BotOutcome<CoachAnswer>>)
    | null;
  // Every recorded match, newest last.
  records: () => readonly MatchRecord[];
  now?: () => number;
  sparringPerSide?: number;
  maxTicks?: number;
  log?: (line: string) => void;
}

// A bot's Arena matches since a moment, from the record.
export interface BriefingMatch {
  at: number;
  win: boolean;
  delta: number;
  replayId?: number;
  matchId?: number;
}

export interface Briefing {
  since: number;
  matches: BriefingMatch[];
  wins: number;
  losses: number;
  ratingDelta: number;
  rating: number;
  // Ticks and deaths per play, summed over the matches.
  plays: Record<string, PlayStats>;
  proposal: StoredProposal | null;
  autoApply: boolean;
}

export interface StoredProposal {
  id: number;
  at: number;
  comment: string;
  ops: PatchOp[];
  currentWins: number;
  candidateWins: number;
  matches: number;
  // pending: awaiting the owner; applied: became a version; dismissed.
  status: 'pending' | 'applied' | 'dismissed';
  appliedVersion: number | null;
}

export function botMatchesSince(
  records: readonly MatchRecord[],
  accountId: number,
  since: number,
): BriefingMatch[] {
  const out: BriefingMatch[] = [];
  for (const rec of records) {
    if (rec.queue !== 'arena' || rec.at < since) continue;
    const me = rec.players.find((p) => p.accountId === accountId && p.way === 'bot');
    if (!me) continue;
    out.push({
      at: rec.at,
      win: me.team === rec.winner,
      delta: me.ratingDelta ?? 0,
      ...(rec.replayId !== undefined ? { replayId: rec.replayId, matchId: rec.replayId } : {}),
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

// The per-play totals over a set of reports for one unit each.
export function sumPlays(
  reports: readonly { report: PlayReport; unitId: number }[],
): Record<string, PlayStats> {
  const out: Record<string, PlayStats> = {};
  for (const { report, unitId } of reports) {
    const mine = report.units.find((u) => u.unitId === unitId);
    if (!mine) continue;
    for (const [id, s] of Object.entries(mine.plays)) {
      const acc = out[id] ?? { ticks: 0, deaths: 0 };
      out[id] = { ticks: acc.ticks + s.ticks, deaths: acc.deaths + s.deaths };
    }
  }
  return out;
}

// What the coach reads: the record and the plays, in plain figures.
export function briefingPrompt(
  bot: BotRow,
  matches: readonly BriefingMatch[],
  plays: Record<string, PlayStats>,
): string {
  const wins = matches.filter((m) => m.win).length;
  const delta = matches.reduce((n, m) => n + m.delta, 0);
  const lines = Object.entries(plays)
    .sort((a, b) => b[1].ticks - a[1].ticks)
    .map(([id, s]) => `${id}: ${Math.round(s.ticks / 20)} s active, ${s.deaths} death(s)`);
  return [
    `Nightly review of the bot "${bot.name}" after its Arena matches: ${wins} won, ${matches.length - wins} lost, ` +
      `Arena rating ${delta >= 0 ? '+' : ''}${delta}.`,
    `Time and deaths per play over those matches:\n${lines.join('\n') || '(no play data)'}`,
    'Propose the smallest patch that would have helped, from what the plays and deaths say. If nothing ' +
      'clearly would, answer with the comment line only and no operations.',
  ].join('\n\n');
}

// The sparring gate: the same opponents, the seat with the current playbook
// and with the candidate, so many matches each, unrated; the candidate
// passes when it wins more.
export async function sparringGate(
  deps: NightCoachDeps,
  seatIndex: number,
  picks: readonly ReplayPick[],
  current: PlaybookDef,
  candidate: PlaybookDef,
  seedBase: number,
): Promise<{ currentWins: number; candidateWins: number; matches: number }> {
  const per = deps.sparringPerSide ?? SPARRING_PER_SIDE;
  const team = picks[seatIndex]?.team ?? 0;
  const wins = async (playbook: PlaybookDef): Promise<number> => {
    let n = 0;
    for (let i = 0; i < per; i++) {
      const trial = picks.map((p, j) => (j === seatIndex ? { ...p, playbook } : p));
      const r = await deps.runner.run({
        seed: seedBase + i,
        picks: trial,
        maxTicks: deps.maxTicks ?? SPARRING_MAX_TICKS,
      });
      if (r.winner === team) n += 1;
    }
    return n;
  };
  const currentWins = await wins(current);
  const candidateWins = await wins(candidate);
  return { currentWins, candidateWins, matches: per * 2 };
}

// One bot's night: the report, the coach's proposal, the gate, and either
// the stored proposal or, with auto-apply on, the new version. Returns
// what happened, for the log.
export async function coachBotOvernight(deps: NightCoachDeps, bot: BotRow): Promise<string> {
  const now = (deps.now ?? Date.now)();
  const since = deps.store.botLastCoachedAt(bot.id) ?? now - DAY_MS;
  const matches = botMatchesSince(deps.records(), bot.accountId, since);
  if (matches.length === 0) return `${bot.name}: no Arena match since the last briefing`;
  deps.store.setBotLastCoachedAt(bot.id, now);
  const reports = deps.store.listBotReports(bot.id, since);
  const plays = sumPlays(reports);
  if (!deps.coach) return `${bot.name}: no coach configured, report only`;
  const answer = await deps.coach(bot.accountId, bot.id, briefingPrompt(bot, matches, plays));
  if (!answer.ok) return `${bot.name}: the coach did not answer (${answer.error})`;
  if (answer.ops.length === 0) return `${bot.name}: the coach proposed no change`;
  const patched = applyPatch(bot.playbook, answer.ops);
  if (patched.refused || patched.applied === 0) return `${bot.name}: the proposal did not apply`;
  // The last Arena match's opponents are the sparring partners.
  const last = reports.at(-1);
  if (!last) return `${bot.name}: no opponents on record to spar against`;
  const gate = await sparringGate(
    deps,
    last.seatIndex,
    last.picks,
    bot.playbook,
    patched.def,
    now % 1_000_000,
  );
  const passed = gate.candidateWins > gate.currentWins;
  const proposalId = deps.store.addProposal({
    botId: bot.id,
    at: now,
    comment: answer.comment,
    ops: answer.ops,
    currentWins: gate.currentWins,
    candidateWins: gate.candidateWins,
    matches: gate.matches,
    status: passed ? 'pending' : 'dismissed',
  });
  if (!passed) {
    return `${bot.name}: proposal ${proposalId} lost the sparring (${gate.candidateWins} to ${gate.currentWins}), dismissed`;
  }
  if (bot.autoApply) {
    const version = applyProposalVersion(deps.store, bot, patched.def, proposalId, now);
    return `${bot.name}: proposal ${proposalId} won the sparring, applied as v${version}`;
  }
  return `${bot.name}: proposal ${proposalId} won the sparring, awaiting the owner`;
}

function applyProposalVersion(
  store: BotStore,
  bot: BotRow,
  def: PlaybookDef,
  proposalId: number,
  at: number,
): number {
  const version = (store.getBot(bot.id)?.version ?? bot.version) + 1;
  store.addVersion({ botId: bot.id, version, playbook: def, author: 'coach', at });
  store.updateBot(bot.id, {
    name: bot.name,
    sigils: bot.sigils,
    skin: bot.skin,
    playbook: def,
    version,
    updatedAt: at,
  });
  store.setProposalStatus(proposalId, 'applied', version);
  return version;
}

// The whole night: every deposited bot, one after another.
export async function runNight(deps: NightCoachDeps): Promise<string[]> {
  const lines: string[] = [];
  for (const bot of deps.store.listDeposited()) {
    try {
      lines.push(await coachBotOvernight(deps, bot));
    } catch (err) {
      lines.push(`${bot.name}: the night failed (${(err as Error).message})`);
    }
  }
  for (const line of lines) deps.log?.(`night coach: ${line}`);
  return lines;
}

export function nightDue(lastAt: number | null, now: number, everyMs = DAY_MS): boolean {
  return lastAt === null || now - lastAt >= everyMs;
}

// What the owner reads.
export function buildBriefing(deps: NightCoachDeps, bot: BotRow): Briefing {
  const now = (deps.now ?? Date.now)();
  const since = now - DAY_MS;
  const matches = botMatchesSince(deps.records(), bot.accountId, since);
  const reports = deps.store.listBotReports(bot.id, since);
  const wins = matches.filter((m) => m.win).length;
  return {
    since,
    matches,
    wins,
    losses: matches.length - wins,
    ratingDelta: matches.reduce((n, m) => n + m.delta, 0),
    rating: deps.store.botRating(bot.id, 'arena').rating,
    plays: sumPlays(reports),
    proposal: deps.store.pendingProposal(bot.id),
    autoApply: bot.autoApply,
  };
}

// The owner's answer to a pending proposal.
export function answerProposal(
  deps: NightCoachDeps,
  bot: BotRow,
  proposalId: unknown,
  action: unknown,
): BotOutcome<{ version?: number }> {
  if (typeof proposalId !== 'number' || (action !== 'apply' && action !== 'dismiss')) {
    return { ok: false, error: 'malformed request' };
  }
  const proposal = deps.store.getProposal(proposalId);
  if (!proposal || proposal.botId !== bot.id) return { ok: false, error: 'no such proposal' };
  if (proposal.status !== 'pending')
    return { ok: false, error: 'this proposal was already answered' };
  if (action === 'dismiss') {
    deps.store.setProposalStatus(proposalId, 'dismissed', null);
    return { ok: true };
  }
  const patched = applyPatch(bot.playbook, proposal.ops);
  if (patched.refused || patched.applied === 0) {
    deps.store.setProposalStatus(proposalId, 'dismissed', null);
    return { ok: false, error: 'the proposal no longer applies to this playbook' };
  }
  const version = applyProposalVersion(
    deps.store,
    bot,
    patched.def,
    proposalId,
    (deps.now ?? Date.now)(),
  );
  return { ok: true, version };
}
