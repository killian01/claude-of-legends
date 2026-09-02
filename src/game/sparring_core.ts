// Local sparring (docs/design/bots.md): a whole match against house bots
// at full speed, in the browser, free and unrated. The DOM-free half: the
// seats and what comes back (the winner, the play report, and a replay
// record embedding the playbook that played), on the one fast runner the
// Arena uses too (src/fast_match.ts), so the worker and the tests share
// one implementation.

import { FAST_MATCH_MAX_TICKS, type FastMatchRequest, runFastMatch } from '../fast_match';
import type { ReplayPick, ReplayRecord } from '../net/replay';
import { DEFAULT_BOT_ID } from '../sim/content/bots';
import { CHAMPION_LIST } from '../sim/content/champions';
import type { PlayReport } from '../sim/playbook/report';
import type { PlaybookDef } from '../sim/playbook/types';
import type { TeamId } from '../sim/types';

export interface SparBot {
  name: string;
  championId: string;
  sigils: [string, string];
  skin: number;
  playbook: PlaybookDef;
}

export type SparRequest = FastMatchRequest;

export interface SparResult {
  winner: TeamId | null;
  ticks: number;
  report: PlayReport;
  // The sparring bot's unit id in the report and the replay.
  botUnitId: number;
  record: ReplayRecord;
}

export const SPAR_MAX_TICKS = FAST_MATCH_MAX_TICKS;

// The sparring bot on team 0, seat 0, then house bots on every other seat
// in roster order, no duplicate champion inside a team: the same shape the
// offline practice match builds.
export function sparringPicks(bot: SparBot): ReplayPick[] {
  const roster = CHAMPION_LIST.filter((c) => c.id !== bot.championId).map((c) => c.id);
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
  for (let i = 0; i < 4; i++) {
    picks.push({
      name: 'House bot',
      team: 0,
      championId: roster[i]!,
      sigils: ['riftstep', 'mend'],
      skin: i % 3,
      bot: DEFAULT_BOT_ID,
    });
  }
  for (let i = 0; i < 5; i++) {
    picks.push({
      name: 'House bot',
      team: 1,
      championId: roster[(i + 4) % roster.length]!,
      sigils: ['riftstep', 'mend'],
      skin: i % 3,
      bot: DEFAULT_BOT_ID,
    });
  }
  return picks;
}

export function sparMatch(req: SparRequest): SparResult {
  const r = runFastMatch(req);
  return {
    winner: r.winner,
    ticks: r.ticks,
    report: r.report,
    botUnitId: r.unitIds[0]!,
    record: r.record,
  };
}
