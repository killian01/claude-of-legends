// What build the server runs, as a replay reads it (src/net/replay.ts): the
// replay version and the content fingerprint. Served on /api/public/build
// so a page opened before a deploy can tell an old record from its own old
// self: a record the server wrote under the build it runs is playable, and
// a client that refuses it is the one out of date (the maintainer's
// evening of 2026-09-11: two deploys, one open tab, "replay unavailable"
// twice for a replay that played fine on a fresh page).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildIdIn } from '../src/net/build_watch';
import { REPLAY_VERSION } from '../src/net/replay';
import { contentFingerprint } from '../src/sim/content/fingerprint';
import type { StarOrchard } from '../src/sim/content/star_orchard';

export interface BuildInfo {
  version: number;
  content: string;
  // The entry bundle this server serves, index-XXXX, or null with no
  // dist (development). A client whose own bundle differs reloads
  // (src/net/build_watch.ts): a change to the interface moves this and
  // neither of the two numbers above.
  build: string | null;
}

// Read once at boot off the built page: the name is Vite's fingerprint of
// the bundle, so it moves with every build and with nothing else.
export function readBuildId(distDir: string): string | null {
  try {
    return buildIdIn(readFileSync(path.join(distDir, 'index.html'), 'utf8'));
  } catch {
    return null;
  }
}

export function buildInfo(orchard: StarOrchard, build: string | null): BuildInfo {
  return { version: REPLAY_VERSION, content: contentFingerprint(orchard), build };
}
