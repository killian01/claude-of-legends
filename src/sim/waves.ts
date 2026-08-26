// Minion wave spawning: every WAVE_EVERY seconds, each team sends melee and
// caster minions down each lane from its base end.

import type { GameMap, LaneId } from './content/map';
import type { CombatCtx } from './sim_context';
import type { Vec2 } from './types';
import { createMinion } from './unit';

export const FIRST_WAVE_AT = 10;
export const WAVE_EVERY = 30;
export const MELEE_PER_WAVE = 3;
export const CASTERS_PER_WAVE = 2;

const LANES: readonly LaneId[] = ['top', 'mid', 'bot'];

export function spawnWave(ctx: CombatCtx, map: GameMap): void {
  for (const team of [0, 1] as const) {
    for (const lane of LANES) {
      const pts = map.lanes[lane];
      const a = team === 0 ? pts[0]! : pts[pts.length - 1]!;
      const b = team === 0 ? pts[1]! : pts[pts.length - 2]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const dir: Vec2 = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      const perp: Vec2 = { x: -dir.z, z: dir.x };
      // Melee up front (larger offsets along the lane), casters behind.
      let slot = 0;
      const spawnAt = (variant: 'melee' | 'caster'): void => {
        const along = 1.2 + slot * 1.1;
        const side = slot % 2 === 0 ? 0.5 : -0.5;
        const pos: Vec2 = {
          x: a.x + dir.x * along + perp.x * side,
          z: a.z + dir.z * along + perp.z * side,
        };
        const id = ctx.allocId();
        ctx.units.set(id, createMinion(id, team, variant, lane, pos));
        slot += 1;
      };
      for (let i = 0; i < CASTERS_PER_WAVE; i++) spawnAt('caster');
      for (let i = 0; i < MELEE_PER_WAVE; i++) spawnAt('melee');
    }
  }
}
