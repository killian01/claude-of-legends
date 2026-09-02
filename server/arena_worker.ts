// The Arena worker: one match at full speed on its own thread, the request
// in workerData, the result posted back, then the thread ends. Bundled
// beside the server (scripts/build_server.mjs) and spawned by
// server/arena_runner.ts.

import { parentPort, workerData } from 'node:worker_threads';
import { type FastMatchRequest, runFastMatch } from '../src/fast_match';

parentPort?.postMessage(runFastMatch(workerData as FastMatchRequest));
