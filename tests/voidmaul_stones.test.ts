// The Voidmaul slam's rain of stones (src/sim/combat/voidmaul_stones.ts):
// a fixed layout across the ring, each stone hurting what it lands on at
// its landing beat, once per slam, and the renderer drawing those stones.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VoidmaulAttackFx } from '../src/render/vfx/voidmaul_attack_fx';
import { stepAutoAttacks } from '../src/sim/combat/auto_attack';
import { voidmaulSlamPoint } from '../src/sim/combat/voidmaul_slam';
import {
  stoneArena,
  VOIDMAUL_STONE_COUNT,
  voidmaulStones,
} from '../src/sim/combat/voidmaul_stones';
import { CREATURES, VOIDMAUL_SLAM_WINDUP_S } from '../src/sim/content/rings';
import { VOIDMAUL_SLAM } from '../src/sim/content/voidmaul_slam';
import { dist, heading, offset } from '../src/sim/geo';
import { Sim } from '../src/sim/sim';
import type { CombatCtx } from '../src/sim/sim_context';
import type { Vec2 } from '../src/sim/types';
import { createCreature } from '../src/sim/unit';

function fixture() {
  const sim = new Sim(17);
  sim.units.clear();
  const pos = { x: 75, z: 75 };
  const boss = createCreature(100_000, CREATURES.voidmaul, pos, 'bulwark', 390);
  boss.stats.ad = 100;
  boss.bitePct = 0;
  boss.ringHome = { center: { x: 72, z: 78 }, radius: 16.35 };
  sim.units.set(boss.id, boss);
  const add = (at: Vec2) => {
    const u = sim.addChampion(1, at, 'korrath');
    u.hp = 1000;
    u.maxHp = 1000;
    u.stats.armor = 0;
    return u;
  };
  const target = add(offset(pos, heading(pos, Math.PI / 2), 2.5));
  boss.attackTargetId = target.id;
  let nextId = 200_000;
  const ctx: CombatCtx & { time: number } = {
    time: 0,
    rng: sim.rng,
    nav: sim.nav,
    ground: sim.ground,
    units: sim.units,
    projectiles: sim.projectiles,
    zones: sim.zones,
    walls: sim.walls,
    teamBuffs: sim.teamBuffs,
    dead: new Set(),
    killers: new Map(),
    events: [],
    allocId: () => nextId++,
  };
  const step = (at: number) => {
    ctx.time = at;
    stepAutoAttacks(ctx);
  };
  const point = voidmaulSlamPoint(boss, target.pos);
  const stones = voidmaulStones(
    point,
    VOIDMAUL_SLAM.radius,
    stoneArena(boss.ringHome, point, VOIDMAUL_SLAM.radius),
  );
  return { boss, ctx, step, add, point, stones };
}

describe('the Voidmaul slam rain of stones', () => {
  it('throws the same stones across the ring every time, each landing inside it', () => {
    const arena = { center: { x: 72, z: 78 }, radius: 16.35 };
    const a = voidmaulStones({ x: 75, z: 75 }, 5.5, arena);
    const b = voidmaulStones({ x: 75, z: 75 }, 5.5, arena);
    expect(a).toEqual(b);
    expect(a).toHaveLength(VOIDMAUL_STONE_COUNT);
    let far = 0;
    for (const s of a) {
      expect(dist(s.target, arena.center)).toBeLessThan(arena.radius);
      expect(s.born + s.flight).toBeGreaterThan(1.9);
      far = Math.max(far, dist(s.target, arena.center));
    }
    expect(far).toBeGreaterThan(14);
  });

  it('hurts a unit a stone lands on, on its landing beat, and only once per slam', () => {
    const { ctx, step, add, point, stones } = fixture();
    // A stone well outside the paw's disk, and a champion under it.
    const stone = stones.find(
      (s) => dist(s.target, point) > VOIDMAUL_SLAM.radius + 3 && s.size > 0.3,
    )!;
    const under = add(stone.target);
    step(0);
    step(VOIDMAUL_SLAM_WINDUP_S);
    expect(under.hp).toBe(1000);
    const lands = VOIDMAUL_SLAM_WINDUP_S + stone.born + stone.flight;
    step(lands - 0.01);
    expect(under.hp).toBe(1000);
    for (let t = lands; t < lands + 3; t += 0.05) step(t);
    expect(under.hp).toBe(1000 - 100 * VOIDMAUL_SLAM.stoneRatio);
    const hits = ctx.events.filter((e) => e.type === 'damage' && e.targetId === under.id);
    expect(hits).toHaveLength(1);
  });

  it('spares a unit no stone comes down on', () => {
    const { boss, step, add, point, stones } = fixture();
    const spot = offset(boss.ringHome!.center, heading(boss.ringHome!.center, 0), 40);
    const clear = add(spot);
    expect(stones.every((s) => dist(s.target, spot) > 2)).toBe(true);
    expect(dist(spot, point)).toBeGreaterThan(VOIDMAUL_SLAM.radius);
    for (let t = 0; t < VOIDMAUL_SLAM_WINDUP_S + 4; t += 0.05) step(t);
    expect(clear.hp).toBe(1000);
  });

  it('lands each drawn stone on its sim target at its sim time', () => {
    const arena = { center: { x: -3, z: -4 }, radius: 16.35 };
    const stones = voidmaulStones({ x: 0, z: 0 }, 5.5, arena);
    const fx = new VoidmaulAttackFx(5.5, { centerX: -3, centerZ: -4, radius: 16.35 }, stones);
    fx.conformGround(() => 0);
    const meshes = fx.root.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
    );
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    for (const i of [0, 9, 37, 101]) {
      const s = stones[i]!;
      fx.update(s.born + s.flight);
      meshes[i % 4]!.getMatrixAt(Math.floor(i / 4), matrix);
      at.setFromMatrixPosition(matrix);
      expect(Math.hypot(at.x - s.target.x, at.z - s.target.z)).toBeLessThan(0.05);
    }
    fx.dispose();
  });
});
