// The bout kinds (CONTEXT.md: Bout; ADR 0035): one line per kind, each its
// own file beside this one. The pool a Thornfray draws from is the
// released kinds; a kind in progress is registered with `released: false`
// and stays out of it. A kind's record carries its version, its
// fingerprint (computed here from its data: functions are left out, so the
// kind's modules are held by its own `version` and by
// tests/thornfray_bout_versions.test.ts) and BOUT_ENGINE_VERSION.

import { fingerprintOf } from '../fingerprint';
import { LASTWICK } from './lastwick';
import { STARGLEAN } from './starglean';
import type { BoutKind, BoutKindId } from './types';

export const BOUT_KINDS: readonly BoutKind[] = [LASTWICK, STARGLEAN];

// The released pool, in registry order.
export function boutPool(kinds: readonly BoutKind[] = BOUT_KINDS): BoutKind[] {
  return kinds.filter((k) => k.released);
}

export function boutKindOf(
  id: BoutKindId,
  kinds: readonly BoutKind[] = BOUT_KINDS,
): BoutKind | undefined {
  return kinds.find((k) => k.id === id);
}

// The fingerprint of a kind's data: any change to a number, a list or a
// word moves it by itself.
export function boutFingerprint(kind: BoutKind): string {
  return fingerprintOf(kind);
}
