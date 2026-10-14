// The Range's Strikeposts (CONTEXT.md: Range, Strikepost;
// content/strikeposts.ts): neutral standing targets inside one team's
// base, set up by the sim when it runs as a Range (SimOptions.range). A
// post never moves or strikes back; the hit that would fell it fills it
// again instead (combat/damage.ts), so it pays nothing and is never in
// the dead. Left alone for a few seconds it fills, stands back on its
// spot and drops its statuses. Its spot is worked out from the map every
// time, so the post carries no state beyond its unit.

import type { GameMap } from './content/map';
import {
  STRIKEPOST_CALM_S,
  STRIKEPOST_GAP_M,
  STRIKEPOST_ORDER,
  STRIKEPOST_REACH_M,
  STRIKEPOSTS,
  type StrikepostKind,
} from './content/strikeposts';
import { copy, dirTo, offset, same, turnLeft } from './geo';
import { type Ground, landingOn } from './ground';
import type { CombatCtx } from './sim_context';
import type { TeamId, Vec2 } from './types';
import { createStrikepost, type Unit } from './unit';

// Where each post stands, in STRIKEPOST_ORDER: out from the team's
// Sanctum toward the map's middle, side by side across that line, each on
// open ground.
export function strikepostStands(map: GameMap, ground: Ground, team: TeamId): Vec2[] {
  const sanctum = map.sanctums.find((s) => s.team === team);
  if (!sanctum) return [];
  const middle = { x: map.size / 2, z: map.size / 2 };
  const out = dirTo(sanctum, middle) ?? { x: 1, z: 0 };
  const across = turnLeft(out, sanctum);
  const ahead = offset(sanctum, out, STRIKEPOST_REACH_M);
  const half = (STRIKEPOST_ORDER.length - 1) / 2;
  return STRIKEPOST_ORDER.map((_, i) => {
    const stand = offset(ahead, across, (i - half) * STRIKEPOST_GAP_M);
    return landingOn(ground, stand) ?? stand;
  });
}

// The posts of a Range, one per kind, ids from the sim's counter.
export function createStrikeposts(
  map: GameMap,
  ground: Ground,
  team: TeamId,
  allocId: () => number,
): Unit[] {
  const stands = strikepostStands(map, ground, team);
  return stands.map((at, i) => createStrikepost(allocId(), STRIKEPOSTS[STRIKEPOST_ORDER[i]!], at));
}

function standOf(stands: readonly Vec2[], kind: StrikepostKind | null): Vec2 | undefined {
  return kind === null ? undefined : stands[STRIKEPOST_ORDER.indexOf(kind)];
}

// Once a post has gone STRIKEPOST_CALM_S without a hit, it fills again and
// stands back where it belongs, clear of whatever it was left holding.
export function stepStrikeposts(ctx: CombatCtx, map: GameMap, team: TeamId): void {
  let stands: Vec2[] | null = null;
  for (const u of ctx.units.values()) {
    if (u.kind !== 'post') continue;
    if (ctx.time - u.lastDamagedAt < STRIKEPOST_CALM_S) continue;
    stands ??= strikepostStands(map, ctx.ground, team);
    const home = standOf(stands, u.postKind);
    const moved = home !== undefined && !same(u.pos, home);
    if (u.hp >= u.maxHp && !moved && u.statuses.length === 0) continue;
    u.hp = u.maxHp;
    if (home) u.pos = copy(home);
    u.path = [];
    u.statuses = [];
  }
}
