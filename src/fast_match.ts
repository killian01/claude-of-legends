// A whole match at full speed with nobody watching (docs/design/bots.md):
// the Academy's sparring in the browser and the Arena on the server share
// this one runner, so a match played in a worker is exactly the match the
// replay viewer rebuilds. DOM-free and network-free; the callers own the
// threads.

import { buildMatchSim, REPLAY_VERSION, type ReplayPick, type ReplayRecord } from './net/replay';
import type { ForgedChampionDef } from './sim/forge/forged_def';
import { PlayLedger, type PlayReport } from './sim/playbook/report';
import type { ScoreRow, TeamId } from './sim/types';

export interface FastMatchRequest {
  seed: number;
  picks: ReplayPick[];
  maxTicks: number;
  forged?: ForgedChampionDef[];
}

export interface FastMatchResult {
  winner: TeamId | null;
  ticks: number;
  // Sim seconds at the end.
  time: number;
  report: PlayReport;
  // Unit ids in pick order.
  unitIds: number[];
  score: ScoreRow[];
  record: ReplayRecord;
}

// A full match at 20 Hz runs 18 to 25 minutes; past this the match is a
// draw rather than running forever.
export const FAST_MATCH_MAX_TICKS = 20 * 60 * 40;

export function runFastMatch(req: FastMatchRequest): FastMatchResult {
  const forged = req.forged ?? [];
  const { sim, unitIds } = buildMatchSim(req.seed, req.picks, forged);
  const ledger = new PlayLedger();
  while (sim.winner === null && sim.tickCount < req.maxTicks) {
    ledger.observe(sim.tickCount + 1, sim.tick(), sim);
  }
  const record: ReplayRecord = {
    version: REPLAY_VERSION,
    seed: req.seed,
    picks: req.picks,
    events: [],
    ticks: sim.tickCount,
    ...(forged.length > 0 ? { forged } : {}),
  };
  return {
    winner: sim.winner,
    ticks: sim.tickCount,
    time: sim.time,
    report: ledger.report(),
    unitIds,
    score: [...sim.scoreboard()],
    record,
  };
}
