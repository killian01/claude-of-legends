// The kinds a Thornfray draws its bouts from on this server (ADR 0035):
// the released pool (src/sim/content/bouts/index.ts boutPool), empty until
// the kinds are released, which keeps the mode closed. A local stack can
// open it on every registered kind, released or not, to play a kind in
// progress (docs/dev-local.md): THORNFRAY_UNRELEASED=1 in its environment.
// Production never sets it.

import { BOUT_KINDS, boutPool } from '../src/sim/content/bouts';
import type { BoutKind } from '../src/sim/content/bouts/types';

// The knob's name, for a test to set.
export const THORNFRAY_UNRELEASED = 'THORNFRAY_UNRELEASED';

export function thornfrayPool(
  env: Readonly<Record<string, string | undefined>>,
  kinds: readonly BoutKind[] = BOUT_KINDS,
): BoutKind[] {
  return env.THORNFRAY_UNRELEASED?.trim() === '1' ? [...kinds] : boutPool(kinds);
}
