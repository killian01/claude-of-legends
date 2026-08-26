// Minion wave spawning: every WAVE_EVERY seconds, each team sends melee and
// caster minions down each lane from its base end; every third wave adds a
// siege minion, and waves scale with game time, so lanes eventually PUSH
// instead of annihilating each other exactly (review finding F.0).

import type { GameMap, LaneId } from './content/map';
import type { CombatCtx } from './sim_context';
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

const LANES: readonly LaneId[] = ['top', 'mid', 'bot'];

export function spawnWave(ctx: CombatCtx, map: GameMap, waveIndex: number): void {
  const scale = 1 + WAVE_SCALING_PER_MIN * (ctx.time / 60);
  const withSiege =
    waveIndex % SIEGE_WAVE_EVERY === SIEGE_WAVE_EVERY - 1 || ctx.time >= LATE_GAME_S;
  for (const team of [0, 1] as const) {
    for (const lane of LANES) {
      const pts = map.lanes[lane];
      const a = team === 0 ? pts[0]! : pts[pts.length - 1]!;
      const b = team === 0 ? pts[1]! : pts[pts.length - 2]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
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
      for (let i = 0; i < MELEE_PER_WAVE; i++) spawnAt('melee');
    }
  }
}
