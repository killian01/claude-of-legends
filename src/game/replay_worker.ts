// The replay's second pass, off the main thread (playtest round 3): the
// match played once ahead of the viewer at full speed, a world checkpoint
// posted every ten seconds of match time and the timeline's marks as they
// happen, so that by the time the viewer wants to seek, the tick is a
// restore and a few steps away, forward or back. One record in, a stream
// of checkpoints out, then done; the viewer terminates the worker when it
// leaves.

import { applyReplayEvent, buildMatchSim, type ReplayRecord } from '../net/replay';
import type { SimSnapshot } from '../sim/snapshot';
import type { TeamId } from '../sim/types';
import { CHECKPOINT_TICKS } from './replay_cursor';
import { MarkCollector, type ReplayMark } from './replay_marks';

export type ReplayWorkerIn = { record: ReplayRecord };

export type ReplayWorkerOut =
  | { kind: 'checkpoint'; snapshot: SimSnapshot; marks: ReplayMark[] }
  | { kind: 'done'; ticks: number; marks: ReplayMark[] }
  | { kind: 'error'; message: string };

// Checkpoints are posted in order with the marks found since the last one.
export function runReplayPass(rec: ReplayRecord, post: (msg: ReplayWorkerOut) => void): void {
  const { sim, unitIds } = buildMatchSim(rec.seed, rec.picks, rec.forged ?? []);
  const unitTeams = new Map<number, TeamId>();
  rec.picks.forEach((p, i) => unitTeams.set(unitIds[i]!, p.team));
  const marks = new MarkCollector();
  let next = 0;
  let pending: ReplayMark[] = [];
  let sent = 0;
  post({ kind: 'checkpoint', snapshot: sim.snapshot(), marks: [] });
  while (sim.tickCount < rec.ticks) {
    while (next < rec.events.length && rec.events[next]!.k <= sim.tickCount) {
      applyReplayEvent(sim, unitTeams, rec.events[next]!);
      next++;
    }
    marks.note(sim.units);
    marks.observe(sim.tickCount + 1, sim.tick());
    if (sim.tickCount % CHECKPOINT_TICKS === 0) {
      pending = marks.marks.slice(sent);
      sent = marks.marks.length;
      post({ kind: 'checkpoint', snapshot: sim.snapshot(), marks: pending });
    }
  }
  post({ kind: 'done', ticks: sim.tickCount, marks: marks.marks.slice(sent) });
}

// The worker entry: guarded so a bundler importing this module for its
// exports (tests) never runs it.
declare const self: Worker & { onmessage: ((e: MessageEvent<ReplayWorkerIn>) => void) | null };
if (
  typeof self !== 'undefined' &&
  typeof (self as unknown as { document?: unknown }).document === 'undefined'
) {
  self.onmessage = (e: MessageEvent<ReplayWorkerIn>): void => {
    try {
      runReplayPass(e.data.record, (msg) => self.postMessage(msg));
    } catch (err) {
      self.postMessage({
        kind: 'error',
        message: (err as Error).message,
      } satisfies ReplayWorkerOut);
    }
  };
}
