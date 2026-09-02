// Local sparring (docs/design/bots.md): a whole match against house bots
// at full speed, in the browser, free and unrated. The DOM-free half: the
// seats and what comes back (the winner, the play report, and a replay
// record embedding the playbook that played), on the one fast runner the
// Arena uses too (src/fast_match.ts), so the worker and the tests share
// one implementation.

import { FAST_MATCH_MAX_TICKS, type FastMatchRequest, runFastMatch } from '../fast_match';
import type { ReplayPick, ReplayRecord } from '../net/replay';
import { DEFAULT_BOT_ID } from '../sim/content/bots';
import { fillTeam } from '../sim/fill';
import type { PlayReport } from '../sim/playbook/report';
import type { PlaybookDef } from '../sim/playbook/types';
import { Rng } from '../sim/rng';
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
// from the fill (src/sim/fill.ts) drawn from the seed: its own team
// completed around its champion, the other team drawn whole, so two
// sparrings on different seeds meet different lineups. The same shape the
// offline practice match builds.
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
    for (const [i, championId] of fillTeam(
      held.map((id) => ({ championId: id })),
      rng,
    ).entries()) {
      picks.push({
        name: 'House bot',
        team,
        championId,
        sigils: ['riftstep', 'mend'],
        skin: i % 3,
        bot: DEFAULT_BOT_ID,
      });
    }
  };
  house(0, [bot.championId]);
  house(1, []);
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
