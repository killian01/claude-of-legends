// Minion wave spawning: every WAVE_EVERY seconds, each team sends melee and
// caster minions down each lane from its base end; every third wave adds a
// siege minion, and waves scale with game time, so lanes eventually PUSH
// instead of annihilating each other exactly (review finding F.0). A team
// holding the Warden's Boon sends a siege minion with EVERY wave while it
// lasts (plan-bots phase 16): objective control becomes lane pressure, the
// genre's trade, so a team that wins the pit and a team that takes towers
// meanwhile have traded something real.

import type { GameMap, LaneId } from './content/map';
import { hypot } from './exact';
import type { CombatCtx } from './sim_context';
import { laneFullyOpen } from './structure_rules';
import type { Vec2 } from './types';
import { createMinion, type MinionVariant } from './unit';

export const FIRST_WAVE_AT = 10;
// 24 s, down from 30: shorter gaps between waves keep the lanes in near
// constant contact (pacing review: matches felt empty between fights).
export const WAVE_EVERY = 24;
export const MELEE_PER_WAVE = 3;
export const CASTERS_PER_WAVE = 2;
export const SIEGE_WAVE_EVERY = 3;
// Waves grow 3 percent per minute of game time.
export const WAVE_SCALING_PER_MIN = 0.03;
// Past this, EVERY wave carries a siege minion so late games close out
// instead of stalling on the defender's infinite home waves.
export const LATE_GAME_S = 18 * 60;
// After LATE_GAME_S the growth slope triples: matches must CONVERGE on the
// 20-25 minute target instead of drifting as champions get harder to kill
// (dodging bots, escape sigils, scaling sustain all lengthen fights).
export const LATE_WAVE_SCALING_PER_MIN = 0.09;

// The wave stat multiplier at a given sim time; exported for the pacing gate.
export function waveScale(time: number): number {
  const lateS = Math.max(0, time - LATE_GAME_S);
  return (
    1 +
    WAVE_SCALING_PER_MIN * (Math.min(time, LATE_GAME_S) / 60) +
    LATE_WAVE_SCALING_PER_MIN * (lateS / 60)
  );
}

const LANES: readonly LaneId[] = ['top', 'mid', 'bot'];

export function spawnWave(ctx: CombatCtx, map: GameMap, waveIndex: number): void {
  const scale = waveScale(ctx.time);
  const siegeWave =
    waveIndex % SIEGE_WAVE_EVERY === SIEGE_WAVE_EVERY - 1 || ctx.time >= LATE_GAME_S;
  for (const team of [0, 1] as const) {
    const withSiege = siegeWave || ctx.teamBuffs.boon(team, ctx.time) !== null;
    for (const lane of LANES) {
      const pts = map.lanes[lane];
      const a = team === 0 ? pts[0]! : pts[pts.length - 1]!;
      const b = team === 0 ? pts[1]! : pts[pts.length - 2]!;
      const len = hypot(b.x - a.x, b.z - a.z);
      const dir: Vec2 = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      const perp: Vec2 = { x: -dir.z, z: dir.x };
      let slot = 0;
      const spawnAt = (variant: MinionVariant): void => {
        const along = 1.2 + slot * 1.1;
        const side = slot % 2 === 0 ? 0.5 : -0.5;
        const pos: Vec2 = {
          x: a.x + dir.x * along + perp.x * side,
          z: a.z + dir.z * along + perp.z * side,
        };
        const id = ctx.allocId();
        ctx.units.set(id, createMinion(id, team, variant, lane, pos, scale));
        slot += 1;
      };
      for (let i = 0; i < CASTERS_PER_WAVE; i++) spawnAt('caster');
      if (withSiege) spawnAt('siege');
      // Lane escalation: once the ENEMY's towers on this lane are down,
      // every wave here carries a Vanguard, so winning a lane visibly
      // changes the map (systems review).
      if (laneFullyOpen(ctx.units, 1 - team, lane)) spawnAt('vanguard');
      for (let i = 0; i < MELEE_PER_WAVE; i++) spawnAt('melee');
    }
  }
}
