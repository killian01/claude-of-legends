// What build the server runs, as a replay reads it (src/net/replay.ts): the
// replay version and the content fingerprint. Served on /api/public/build
// so a page opened before a deploy can tell an old record from its own old
// self: a record the server wrote under the build it runs is playable, and
// a client that refuses it is the one out of date (the maintainer's
// evening of 2026-09-11: two deploys, one open tab, "replay unavailable"
// twice for a replay that played fine on a fresh page).

import { REPLAY_VERSION } from '../src/net/replay';
import { contentFingerprint } from '../src/sim/content/fingerprint';
import type { StarOrchard } from '../src/sim/content/star_orchard';

export interface BuildInfo {
  version: number;
  content: string;
}

export function buildInfo(orchard: StarOrchard): BuildInfo {
  return { version: REPLAY_VERSION, content: contentFingerprint(orchard) };
}
