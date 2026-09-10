// Where the shop answers (game definition: "shop at fountain, and while
// dead"). One rule for the sim, the HUD and the bots: within SHOP_RANGE_PAD
// of the team's fountain pad, or of any disc the map lists beside it
// (FountainSpot.shop in content/map.ts). The Star Orchard's spawn terrace is
// a band around the Sanctum four times the pad's width, and a champion
// seated at either end of it stood eleven meters from a shop it could see.
// The death waiver is the caller's: a corpse respawns at its own fountain,
// so the sim lets it buy from wherever it fell.

import type { GameMap } from './content/map';
import { hypot } from './exact';
import type { TeamId, Vec2 } from './types';

// How far past a pad's edge the shop still answers.
export const SHOP_RANGE_PAD = 2;

export function atShop(map: GameMap, team: TeamId, pos: Vec2): boolean {
  const fountain = map.fountains.find((f) => f.team === team);
  if (!fountain) return false;
  if (hypot(pos.x - fountain.x, pos.z - fountain.z) <= fountain.r + SHOP_RANGE_PAD) return true;
  return (fountain.shop ?? []).some(
    (disc) => hypot(pos.x - disc.x, pos.z - disc.z) <= disc.r + SHOP_RANGE_PAD,
  );
}
