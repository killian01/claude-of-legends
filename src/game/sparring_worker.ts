// The sparring worker: one match at full speed off the main thread, so the
// Academy stays responsive while ten seconds of sim run. One request in,
// one result out, then the Academy terminates the worker.

import { type SparRequest, sparMatch } from './sparring_core';

self.onmessage = (e: MessageEvent<SparRequest>): void => {
  try {
    self.postMessage(sparMatch(e.data));
  } catch (err) {
    self.postMessage({ error: (err as Error).message });
  }
};
