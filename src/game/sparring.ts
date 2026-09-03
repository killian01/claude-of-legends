// Local sparring from the Academy: runs the DOM-free core in a worker and
// hands the result back as a promise. Vite bundles the worker from the
// module URL; nothing else on the page notices the ten seconds of sim.

import type { PlaybookDef } from '../sim/playbook/types';
import type { TeamId } from '../sim/types';
import {
  SPAR_MAX_TICKS,
  type SeriesMatch,
  type SparBot,
  type SparRequest,
  type SparResult,
  seriesPicks,
  sparringPicks,
} from './sparring_core';

// One match in its own worker, terminated when the result lands.
function runMatch(req: SparRequest): Promise<SparResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sparring_worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<SparResult | { error: string }>): void => {
      worker.terminate();
      if ('error' in e.data) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker.onerror = (e): void => {
      worker.terminate();
      reject(new Error(e.message || 'the sparring worker failed'));
    };
    worker.postMessage(req);
  });
}

export function runSparring(bot: SparBot, seed: number): Promise<SparResult> {
  return runMatch({ seed, picks: sparringPicks(bot, seed), maxTicks: SPAR_MAX_TICKS });
}

// The series: every seed in its own worker at once, the bot's side
// alternating, `onProgress` told after each match lands.
export function runSeries(
  bot: SparBot,
  previous: PlaybookDef | null,
  seeds: readonly number[],
  onProgress?: (done: number) => void,
): Promise<SeriesMatch[]> {
  let done = 0;
  return Promise.all(
    seeds.map((seed, i) => {
      const team = (i % 2) as TeamId;
      const { picks, botIndex } = seriesPicks(bot, previous, seed, team);
      return runMatch({ seed, picks, maxTicks: SPAR_MAX_TICKS, botIndex }).then((result) => {
        done += 1;
        onProgress?.(done);
        return { seed, team, result };
      });
    }),
  );
}
