// The single abstraction behind every bot, scripted or trained (ADR 0002).
// A Policy is deterministic, does zero I/O, and sees only what its team sees.
// The observation/action space and the decision budget (ADR 0003) form a
// public contract: bump POLICY_CONTRACT_VERSION deliberately, never casually.

import type { Rng } from './rng';

export const POLICY_CONTRACT_VERSION = 0;

// Team vision only, never global sim state. Grows as systems land; every
// addition must remain derivable from what the participant's team can see.
export interface Observation {
  tick: number;
}

export type Action = { kind: 'noop' } | { kind: 'move'; x: number; z: number };

export type Policy = (obs: Observation, rng: Rng) => Action;
