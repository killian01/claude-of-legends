// The royale bot's calls (src/sim/royale/bot/brain.ts): somewhere to go
// when no enemy is in sight, read off the public observation only (a
// Seedfall, an ambush beside it, a Clamor, a Rising, a mark). No memory
// beyond the observation; the first call that applies wins. None applies
// yet: the brain does not consult it until the calls land here.

import type { Observation } from '../../policy';

// A call's goal: a point to walk to, and why.
export interface RoyaleCall {
  kind: 'seedfall' | 'ambush' | 'clamor' | 'rising' | 'mark';
  x: number;
  y: number;
  z: number;
}

// The call that applies to this observation, or null.
export function royaleCall(_obs: Observation): RoyaleCall | null {
  return null;
}
