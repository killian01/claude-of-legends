// Runs Arena matches off the live loop: one at a time in a worker thread
// (node:worker_threads, built in), queued behind each other with a bound,
// so ten seconds of sim never block a snapshot. Without a worker file
// (tests, or a host without the bundle) the match runs inline instead:
// the same runner, the same result, on the calling thread.

import { Worker } from 'node:worker_threads';
import { type FastMatchRequest, type FastMatchResult, runFastMatch } from '../src/fast_match';

export const ARENA_QUEUE_MAX = 20;

export class ArenaRunner {
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  constructor(
    private readonly workerFile: string | null,
    private readonly queueMax = ARENA_QUEUE_MAX,
  ) {}

  get queued(): number {
    return this.waiting;
  }

  get hasWorker(): boolean {
    return this.workerFile !== null;
  }

  // Resolves with the match once its turn came; rejects at once when the
  // queue is full, so a busy Arena says so instead of piling up.
  run(req: FastMatchRequest): Promise<FastMatchResult> {
    if (this.waiting >= this.queueMax) {
      return Promise.reject(new Error('the Arena is busy right now; try again in a moment'));
    }
    this.waiting += 1;
    const turn = this.chain.then(
      () => this.runOne(req),
      () => this.runOne(req),
    );
    this.chain = turn.finally(() => {
      this.waiting -= 1;
    });
    return turn;
  }

  private runOne(req: FastMatchRequest): Promise<FastMatchResult> {
    if (this.workerFile === null) return Promise.resolve(runFastMatch(req));
    const file = this.workerFile;
    return new Promise((resolve, reject) => {
      const worker = new Worker(file, { workerData: req });
      let settled = false;
      worker.once('message', (result: FastMatchResult) => {
        settled = true;
        resolve(result);
      });
      worker.once('error', (err) => {
        settled = true;
        reject(err);
      });
      worker.once('exit', (code) => {
        if (!settled) reject(new Error(`the Arena worker exited with code ${code}`));
      });
    });
  }
}
