// Map integrity gate: the launch map stays point-symmetric and every gameplay
// anchor (fountain, Sanctum, tower, lane waypoint) sits on walkable ground.

import { describe, expect, it } from 'vitest';
import { GAME_MAP } from '../src/sim/content/map';
import { NavGrid } from '../src/sim/navgrid';

const grid = new NavGrid(GAME_MAP.size, GAME_MAP.walls, GAME_MAP.borderMargin);
const mirror = (x: number, z: number) => ({ x: GAME_MAP.size - x, z: GAME_MAP.size - z });
const close = (a: number, b: number) => Math.abs(a - b) < 0.01;

describe('the launch map', () => {
  it('has 8 towers, 1 fountain, and 1 Sanctum per team', () => {
    for (const team of [0, 1] as const) {
      expect(GAME_MAP.towers.filter((t) => t.team === team)).toHaveLength(8);
      expect(GAME_MAP.fountains.filter((f) => f.team === team)).toHaveLength(1);
      expect(GAME_MAP.sanctums.filter((s) => s.team === team)).toHaveLength(1);
    }
  });

  it('is point-symmetric between the teams', () => {
    for (const t of GAME_MAP.towers.filter((t) => t.team === 0)) {
      const m = mirror(t.x, t.z);
      const twin = GAME_MAP.towers.find(
        (o) => o.team === 1 && close(o.x, m.x) && close(o.z, m.z) && o.tier === t.tier,
      );
      expect(twin, `mirrored tower for ${t.lane} tier ${t.tier}`).toBeDefined();
    }
    for (const list of [GAME_MAP.fountains, GAME_MAP.sanctums] as const) {
      const a = list.find((e) => e.team === 0);
      const b = list.find((e) => e.team === 1);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a && b) {
        const m = mirror(a.x, a.z);
        expect(close(b.x, m.x) && close(b.z, m.z)).toBe(true);
      }
    }
    for (const w of GAME_MAP.walls) {
      const m = mirror(w.x, w.z);
      const twin = GAME_MAP.walls.find((o) => close(o.x, m.x) && close(o.z, m.z) && o.r === w.r);
      expect(twin, `mirrored wall at ${w.x},${w.z}`).toBeDefined();
    }
  });

  it('keeps every gameplay anchor on walkable ground', () => {
    const anchors: { x: number; z: number; what: string }[] = [];
    for (const f of GAME_MAP.fountains) anchors.push({ x: f.x, z: f.z, what: 'fountain' });
    for (const s of GAME_MAP.sanctums) anchors.push({ x: s.x, z: s.z, what: 'sanctum' });
    for (const t of GAME_MAP.towers) anchors.push({ x: t.x, z: t.z, what: `tower ${t.lane}` });
    for (const [lane, pts] of Object.entries(GAME_MAP.lanes)) {
      for (const p of pts) anchors.push({ x: p.x, z: p.z, what: `lane ${lane}` });
    }
    const offenders = anchors.filter((a) => !grid.isWalkableAt(a.x, a.z));
    expect(offenders).toEqual([]);
  });

  it('keeps each lane walkable end to end along its polyline', () => {
    for (const pts of Object.values(GAME_MAP.lanes)) {
      for (let i = 0; i + 1 < pts.length; i++) {
        expect(grid.lineOfWalk(pts[i]!, pts[i + 1]!)).toBe(true);
      }
    }
  });
});
