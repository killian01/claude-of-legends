// Local sparring from the Academy: runs the DOM-free core in a worker and
// hands the result back as a promise. Vite bundles the worker from the
// module URL; nothing else on the page notices the ten seconds of sim.

import { SPAR_MAX_TICKS, type SparBot, type SparResult, sparringPicks } from './sparring_core';

export function runSparring(bot: SparBot, seed: number): Promise<SparResult> {
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
    worker.postMessage({ seed, picks: sparringPicks(bot), maxTicks: SPAR_MAX_TICKS });
  });
}
