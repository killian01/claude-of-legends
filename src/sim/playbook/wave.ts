// Wave management (plan-bots phase 16): the genre's freeze and shove as
// engine execution behind one macro intent. A shove hits the wave to send
// it at the enemy tower. A freeze keeps the enemy wave in front of the
// bot's own lane tower: last hits only, standing just ahead of the tower
// and holding (the S verb, so idle defense does not push the wave), so the
// wave dies to the tower, the gold is the bot's, and the enemy laner must
// come deep, past its own wave, for any farm at all. The last hit reads
// the minion's health and the bot's attack damage off the observation
// (additive fields, plan-bots phase 16).

import type { LaneId } from '../content/map';
import { hypot } from '../exact';
import type { Action, ObsUnit } from '../policy';
import { dist, FARM_RANGE, laneDistance, nearest, type SlotContext } from './micro';
import type { WaveIntent } from './types';

// How far ahead of its own tower a freezing bot stands: inside the tower's
// protection (an enemy in reach of the bot is in reach of the tower),
// outside the brawl of the two waves.
export const FREEZE_AHEAD = 9;
// A lane tower stands this close to its lane's path, and farther than this
// from the own Sanctum (the Sanctum's towers sit where every lane starts).
const LANE_TOWER_RANGE = 8;
const SANCTUM_TOWER_RANGE = 12;
// Standing at the spot means within this much of it.
const AT_SPOT = 2;

// A minion the bot's next strike kills: health at or under its attack
// damage. Minions wear no armor; the Vanguard's twenty makes a strike on
// it land late once in a while, never wasted.
export function killable(minion: ObsUnit, attackDamage: number): boolean {
  return minion.hp !== undefined && minion.hp <= attackDamage;
}

// The last hit in reach: the killable enemy minion lowest in health, or
// nothing (a strike on a healthy minion pushes the wave, which is the
// shove's business).
export function lastHit(ctx: SlotContext): Action | null {
  const { s } = ctx;
  const ad = s.attackDamage;
  if (ad === undefined) return null;
  let best: ObsUnit | null = null;
  for (const m of ctx.enemies) {
    if (m.kind !== 'minion' || dist(s.x, s.z, m) > FARM_RANGE || !killable(m, ad)) continue;
    if (!best || (m.hp ?? 0) < (best.hp ?? 0)) best = m;
  }
  return best ? { kind: 'attack', targetId: best.id } : null;
}

// The shove: the nearest enemy minion in reach, whatever its health.
export function shove(ctx: SlotContext): Action | null {
  const { s } = ctx;
  const minion = nearest(
    ctx.enemies.filter((u) => u.kind === 'minion'),
    s.x,
    s.z,
  );
  if (minion && dist(s.x, s.z, minion) <= FARM_RANGE) {
    return { kind: 'attack', targetId: minion.id };
  }
  return null;
}

// The bot's lane tower: the live allied tower on the bot's lane nearest
// the enemy end (the front one); null with none standing or no lane.
export function laneTower(ctx: SlotContext): ObsUnit | null {
  const lane = ctx.s.lane;
  if (lane === null) return null;
  const path = ctx.map.lanes[lane];
  const home = ctx.map.sanctums.find((c) => c.team === ctx.s.team)!;
  let best: ObsUnit | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of ctx.obs.units) {
    // Own dead units stay in team vision (observe.ts); a dead tower is no
    // shelter.
    if (!t.friendly || t.kind !== 'tower' || t.hpFrac <= 0) continue;
    if (laneDistance(path, t.x, t.z) > LANE_TOWER_RANGE) continue;
    if (hypot(t.x - home.x, t.z - home.z) <= SANCTUM_TOWER_RANGE) continue;
    const d = hypot(t.x - ctx.enemySanctum.x, t.z - ctx.enemySanctum.z);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

// Where a freeze stands: FREEZE_AHEAD units from the tower down the lane
// toward the enemy end.
export function freezeSpot(ctx: SlotContext, tower: ObsUnit): { x: number; z: number } {
  const lane = ctx.s.lane as LaneId;
  const path = ctx.map.lanes[lane];
  const oriented = ctx.s.team === 0 ? path : [...path].reverse();
  let idx = 0;
  let best = Number.POSITIVE_INFINITY;
  oriented.forEach((p, i) => {
    const d = hypot(p.x - tower.x, p.z - tower.z);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  const next = oriented[Math.min(idx + 1, oriented.length - 1)]!;
  let dx = next.x - tower.x;
  let dz = next.z - tower.z;
  if (hypot(dx, dz) < 0.5) {
    dx = ctx.enemySanctum.x - tower.x;
    dz = ctx.enemySanctum.z - tower.z;
  }
  const len = hypot(dx, dz) || 1;
  return { x: tower.x + (dx / len) * FREEZE_AHEAD, z: tower.z + (dz / len) * FREEZE_AHEAD };
}

// The freeze: the last hit when one is there; otherwise stand at the spot
// and hold. Passes the turn with no lane tower left to freeze in front of.
export function freeze(ctx: SlotContext): Action | null {
  const tower = laneTower(ctx);
  if (!tower) return null;
  const hit = lastHit(ctx);
  if (hit) return hit;
  const { s } = ctx;
  const spot = freezeSpot(ctx, tower);
  if (hypot(spot.x - s.x, spot.z - s.z) <= AT_SPOT) {
    return s.holding === true ? { kind: 'noop' } : { kind: 'stop' };
  }
  const { jx, jz } = ctx.jitter();
  return { kind: 'move', x: spot.x + jx, z: spot.z + jz };
}

export function manageWave(ctx: SlotContext, intent: WaveIntent): Action | null {
  return intent === 'shove' ? shove(ctx) : freeze(ctx);
}
