// Map integrity: an inner tower must sit BEHIND its outer tower, not merely
// deeper in the lane. The playtest complaint was that the enemy's second
// tower was too easy to reach, and "easy to reach" has a precise meaning
// here: you could walk at it in nearly a straight line from the middle of
// the map without ever entering an outer tower's reach, because each half
// was an open field on one side of its mid lane.
//
// The gate measures that walk. Narrow jungle routes into a half are good
// design and stay legal; a stroll is not. The safe route has to be a real
// detour: at least the floor for its lane times the straight-line distance,
// or no route at all. Before the round 3 map pass the ratios were 1.29 (side
// lanes) and 1.98 (mid), where 1.26 is what a four-connected grid can express
// at its shortest.
//
// The two floors part company since the river opened. Round 3 measured 4.77
// (mid) and 3.65 (side) on a map whose river was a chain of walled-off
// pockets: the whole middle of the map was closed, so every walk into a half
// went the long way round. A river you can travel is by definition a short
// way round, and the side lanes pay for it, measuring 1.84 against mid's
// 2.63. Both are still detours, not strolls, and the alternative measured on
// the way here was worse: walling the gorge back up seals each half outright,
// with no jungle route into it at all.

import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../src/sim/content/map';
import { Sim } from '../src/sim/sim';
import type { TeamId } from '../src/sim/types';

// A tower reaches 9 plus its own radius plus the diver's: standing this
// close means taking shots. Bots use the same figure for tower discipline.
const TOWER_REACH = 11;
// Close enough to hit the tower itself, melee included.
const STRIKE_GAP = 4;
// Per lane, because the river costs the side lanes more than it costs mid.
const DETOUR_MIN: Record<string, number> = { mid: 2.5, top: 1.8, bot: 1.8 };

const sim = new Sim(7);
const grid = sim.nav;
const n = grid.cells;

function outerTowers(team: TeamId) {
  return GAME_MAP.towers.filter((t) => t.team === team && t.tier === 1 && t.lane !== 'sanctum');
}

function innerTowers(team: TeamId) {
  return GAME_MAP.towers.filter((t) => t.team === team && t.tier === 2 && t.lane !== 'sanctum');
}

// Step distance from the map center to every cell reachable without ever
// standing in one of `guards`' reach; -1 where no such walk exists.
function safeStepMap(guards: readonly { x: number; z: number }[]): Int32Array {
  const open = new Uint8Array(n * n);
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      if (!grid.isWalkableCell(cx, cz)) continue;
      const x = cx + 0.5;
      const z = cz + 0.5;
      if (guards.some((g) => Math.hypot(x - g.x, z - g.z) <= TOWER_REACH)) continue;
      open[cz * n + cx] = 1;
    }
  }
  const dist = new Int32Array(n * n).fill(-1);
  const s = Math.floor(GAME_MAP.size / 2);
  const start = s * n + s;
  dist[start] = 0;
  const queue: number[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const cx = i % n;
    const cz = (i - cx) / n;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const j = nz * n + nx;
      if (dist[j]! >= 0 || !open[j]) continue;
      dist[j] = dist[i]! + 1;
      queue.push(j);
    }
  }
  return dist;
}

function safeStepsTo(dist: Int32Array, at: { x: number; z: number }): number {
  let best = Number.POSITIVE_INFINITY;
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      const d = dist[cz * n + cx]!;
      if (d < 0) continue;
      if (Math.hypot(cx + 0.5 - at.x, cz + 0.5 - at.z) <= STRIKE_GAP) best = Math.min(best, d);
    }
  }
  return best;
}

describe('lane approach', () => {
  it('starts the walk from the middle of the map on open ground', () => {
    expect(grid.isWalkableAt(GAME_MAP.size / 2, GAME_MAP.size / 2)).toBe(true);
  });

  for (const team of [0, 1] as const) {
    it(`makes reaching team ${team}'s inner towers a detour, not a stroll`, () => {
      const guards = outerTowers(team);
      expect(guards).toHaveLength(3);
      const dist = safeStepMap(guards);
      const inners = innerTowers(team);
      expect(inners).toHaveLength(3);
      for (const inner of inners) {
        const steps = safeStepsTo(dist, inner);
        const straight = Math.hypot(inner.x - GAME_MAP.size / 2, inner.z - GAME_MAP.size / 2);
        expect(
          steps / straight,
          `team ${team} ${inner.lane} inner tower is a ${steps}-step walk over ${straight.toFixed(0)}`,
        ).toBeGreaterThanOrEqual(DETOUR_MIN[inner.lane]!);
      }
    });
  }

  // The mirror check below compares team 0 with team 1 and cannot see a half
  // that is lopsided about its OWN mid lane. Round 3 made each half a
  // matching pair of jungles by adding every blob's transpose, and the first
  // river pass quietly undid that for the blobs authored on the diagonal,
  // which are their own transpose: top measured 2.75 while bot measured 1.72.
  for (const team of [0, 1] as const) {
    it(`keeps team ${team}'s two side lanes equally hard to walk into`, () => {
      const dist = safeStepMap(outerTowers(team));
      const inners = innerTowers(team);
      const top = inners.find((t) => t.lane === 'top');
      const bot = inners.find((t) => t.lane === 'bot');
      expect(top && bot).toBeTruthy();
      if (!top || !bot) return;
      const a = safeStepsTo(dist, top);
      const b = safeStepsTo(dist, bot);
      expect(Math.abs(a - b), `top ${a} vs bot ${b}`).toBeLessThanOrEqual(4);
    });
  }

  it('keeps both halves equally hard to walk into', () => {
    const zero = safeStepMap(outerTowers(0));
    const one = safeStepMap(outerTowers(1));
    for (const inner of innerTowers(0)) {
      const mirrored = { x: GAME_MAP.size - inner.x, z: GAME_MAP.size - inner.z };
      const a = safeStepsTo(zero, inner);
      const b = safeStepsTo(one, mirrored);
      // Point symmetry is exact in the map data; the grid rounds, so allow
      // a couple of cells of slack rather than demanding equality.
      expect(Math.abs(a - b), `${inner.lane}: ${a} vs ${b}`).toBeLessThanOrEqual(4);
    }
  });
});
