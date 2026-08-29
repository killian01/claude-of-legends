// How long a dead champion waits. The curve accelerates on purpose: an early
// death should cost you a wave, a late one should cost your team the map.
// A flat ramp (the old base + 1.3 per level) topped out at 29 s at level 18,
// which is under one wave's march, so late deaths bought the enemy nothing
// and trading yourself for a pick was close to free. The quadratic term is
// tuned to leave levels 1 to 6 exactly where the pacing review put them and
// to bite only afterwards.

import { MAX_LEVEL } from './stats';

const BASE = 6;
const PER_LEVEL = 0.7;
const PER_LEVEL_SQUARED = 0.1;

// Seconds between a champion's death and its respawn at the fountain.
export function respawnDelay(level: number): number {
  const l = level < 1 ? 1 : level > MAX_LEVEL ? MAX_LEVEL : level;
  return BASE + PER_LEVEL * l + PER_LEVEL_SQUARED * l * l;
}
