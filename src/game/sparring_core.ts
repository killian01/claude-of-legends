// Local sparring (docs/design/bots.md): a whole match against house bots
// at full speed, in the browser, free and unrated. The DOM-free core: the
// seats, the run, and what comes back (the winner, the play report, and a
// replay record embedding the playbook that played), so the worker and the
// tests share one implementation.

import { buildMatchSim, REPLAY_VERSION, type ReplayPick, type ReplayRecord } from '../net/replay';
import { DEFAULT_BOT_ID } from '../sim/content/bots';
import { CHAMPION_LIST } from '../sim/content/champions';
import { PlayLedger, type PlayReport } from '../sim/playbook/report';
import type { PlaybookDef } from '../sim/playbook/types';
import type { TeamId } from '../sim/types';

export interface SparBot {
  name: string;
  championId: string;
  sigils: [string, string];
  skin: number;
  playbook: PlaybookDef;
}

export interface SparRequest {
  seed: number;
  picks: ReplayPick[];
  maxTicks: number;
}

export interface SparResult {
  winner: TeamId | null;
  ticks: number;
  report: PlayReport;
  // The sparring bot's unit id in the report and the replay.
  botUnitId: number;
  record: ReplayRecord;
}

// A full match at 20 Hz runs 18 to 25 minutes; past this the spar is
// called a draw rather than running forever.
export const SPAR_MAX_TICKS = 20 * 60 * 40;

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
  const { sim, unitIds } = buildMatchSim(req.seed, req.picks);
  const ledger = new PlayLedger();
  while (sim.winner === null && sim.tickCount < req.maxTicks) {
    ledger.observe(sim.tickCount + 1, sim.tick());
  }
  const record: ReplayRecord = {
    version: REPLAY_VERSION,
    seed: req.seed,
    picks: req.picks,
    events: [],
    ticks: sim.tickCount,
  };
  return {
    winner: sim.winner,
    ticks: sim.tickCount,
    report: ledger.report(),
    botUnitId: unitIds[0]!,
    record,
  };
}
