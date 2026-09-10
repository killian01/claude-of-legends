// The sparring worker: one match at full speed off the main thread, so the
// Academy stays responsive while ten seconds of sim run. One request in,
// one result out, then the Academy terminates the worker.

import { type SparRequest, sparMatch } from './sparring_core';
import { loadStarOrchard } from './star_orchard_records';

self.onmessage = (e: MessageEvent<SparRequest>): void => {
  // The map's records, fetched by the worker itself (ADR 0021).
  loadStarOrchard()
    .then((orchard) => self.postMessage(sparMatch(orchard, e.data)))
    .catch((err: unknown) => self.postMessage({ error: (err as Error).message }));
};
