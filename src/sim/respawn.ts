// How long a dead champion waits. Scales with GAME TIME first, the design
// doc's promise (docs/design/game-definition.md): an early death costs a
// wave, a late one costs your team the map, whatever level the victim
// reached. A small level term keeps the fed carry's death worth more than a
// tagalong's. The previous curve scaled with level alone, so a level 9
// death at minute 20 still cost only ~19 s and kills never opened the map.

import { MAX_LEVEL } from './stats';

const BASE = 6;
const PER_LEVEL = 0.4;
const PER_MIN = 1.7;
// A mini MOBA: even the worst death stays under a minute.
const MAX_DELAY_S = 55;

// Seconds between a champion's death and its respawn at the fountain.
export function respawnDelay(level: number, time: number): number {
  const l = level < 1 ? 1 : level > MAX_LEVEL ? MAX_LEVEL : level;
  const minutes = Math.max(0, time) / 60;
  return Math.min(MAX_DELAY_S, BASE + PER_LEVEL * l + PER_MIN * minutes);
}
