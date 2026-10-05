// The rain of stones a Voidmaul slam throws (combat/voidmaul_slam.ts): the
// rock its paw breaks flies from the contact and lands across its ring's
// platform. The sim decides where and when each stone lands, so a stone
// that comes down on a unit hurts it; the renderer draws these very stones
// (render/vfx/voidmaul_attack_fx.ts) from the same pure layout. Hashing and
// angles are exact (ADR 0019): the same slam throws the same rain on every
// engine.

import { VOIDMAUL_SLAM } from '../content/voidmaul_slam';
import { dist, heading, offset, within } from '../geo';
import type { CombatCtx } from '../sim_context';
import type { Vec2 } from '../types';
import { hostile, type Unit } from '../unit';
import { dealDamage } from './damage';
import { isUntargetable } from './status';

// Eight sectors of four rings each: enough to read as a rain over the whole
// platform, few enough that each block is seen (128 was a blizzard).
const SECTORS = 8;
const BANDS = 4;
export const VOIDMAUL_STONE_COUNT = SECTORS * BANDS;
const TAU = 6.283185307179586;

// Where the stones come down: the creature's ring, or, off a ring (a test
// fixture), a disk around the contact.
export interface StoneArena {
  center: Vec2;
  radius: number;
}

export interface VoidmaulStone {
  // Where it leaves the broken ground, near the paw, and where it lands.
  origin: Vec2;
  target: Vec2;
  // Seconds after the contact: when it leaves, and how long it flies.
  born: number;
  flight: number;
  // Its scale; the stone's footprint is about this, the shard's mean reach.
  size: number;
}

// A stone in the air, waiting to land: when, where, and how far it reaches.
export interface FallingStone {
  pos: Vec2;
  at: number;
  r: number;
}

// The stones of one slam still in the air, and who the rain already hit.
export interface StoneRain {
  stones: FallingStone[];
  hit: number[];
  ad: number;
  bitePct: number;
}

// A fixed integer hash into [0, 1): exact on every engine.
export function stoneRandom(index: number): number {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function stoneArena(home: StoneArena | null | undefined, point: Vec2, radius: number) {
  return home && home.radius > 0 ? home : { center: point, radius: radius * 2.7 };
}

// Every one of eight sectors gets landings from the center to the rim, the
// rings staggered half a sector so no spoke lines up; every stone starts
// close to the paw, and every one is a block.
export function voidmaulStones(
  point: Vec2,
  radius: number,
  arena: StoneArena,
  // A crush's two paws: the even stones leave from under the first, the
  // odd ones from under the second.
  paws?: readonly [Vec2, Vec2],
): VoidmaulStone[] {
  const out: VoidmaulStone[] = [];
  for (let i = 0; i < VOIDMAUL_STONE_COUNT; i++) {
    const band = i % BANDS;
    const sector = Math.floor(i / BANDS);
    const size = Math.min(arena.radius * 0.045, radius * (0.065 + stoneRandom(i + 19) * 0.083));
    const radial = [0.2, 0.45, 0.7, 0.92][band]! + (stoneRandom(i + 5) - 0.5) * 0.1;
    const margin = size * 1.5 + 0.08;
    const reach = Math.max(0, Math.min(arena.radius - margin, arena.radius * radial));
    const angle =
      ((sector + 0.5 + (band % 2) * 0.5) / SECTORS) * TAU + (stoneRandom(i + 2) - 0.5) * 0.5;
    const target = offset(arena.center, heading(arena.center, angle), reach);
    const originAngle = i * 2.399963 + stoneRandom(i + 10) * 0.5;
    const from = paws ? paws[i % 2]! : point;
    const origin = offset(
      from,
      heading(from, originAngle),
      radius * (0.11 + stoneRandom(i + 11) * 0.25),
    );
    const flight = 1.95 + stoneRandom(i + 16) * 0.52 + (dist(origin, target) / arena.radius) * 0.36;
    out.push({ origin, target, born: stoneRandom(i + 8) * 0.12, flight, size });
  }
  return out;
}

// The slam's rain, armed at the contact: each stone lands at its time.
export function throwStones(
  ctx: CombatCtx,
  u: Unit,
  point: Vec2,
  radius: number,
  paws?: readonly [Vec2, Vec2],
): void {
  const arena = stoneArena(u.ringHome, point, radius);
  const stones = voidmaulStones(point, radius, arena, paws)
    .map((s) => ({ pos: s.target, at: ctx.time + s.born + s.flight, r: s.size }))
    .sort((a, b) => a.at - b.at);
  const rain: StoneRain = { stones, hit: [], ad: u.stats.ad, bitePct: u.bitePct };
  u.stoneRains = [...(u.stoneRains ?? []), rain];
}

// Lands every stone whose time has come. A stone hurts each hostile unit it
// comes down on, once per slam however many stones fall on it.
export function stepStoneRains(ctx: CombatCtx, u: Unit): void {
  const rains = u.stoneRains;
  if (!rains || rains.length === 0) return;
  for (const rain of rains) {
    while (rain.stones.length > 0 && rain.stones[0]!.at <= ctx.time) {
      const stone = rain.stones.shift()!;
      for (const other of ctx.units.values()) {
        if (
          rain.hit.includes(other.id) ||
          !hostile(u, other) ||
          other.dead ||
          ctx.dead.has(other.id) ||
          isUntargetable(other, ctx.time) ||
          !within(stone.pos, other.pos, stone.r + other.radius)
        ) {
          continue;
        }
        rain.hit.push(other.id);
        dealDamage(ctx, u.id, other, rain.ad * VOIDMAUL_SLAM.stoneRatio, 'physical', 'attack');
        if (rain.bitePct > 0 && other.kind === 'champion') {
          const bite = rain.bitePct * other.maxHp * VOIDMAUL_SLAM.stoneRatio;
          dealDamage(ctx, u.id, other, bite, 'true', 'attack');
        }
      }
    }
  }
  u.stoneRains = rains.filter((rain) => rain.stones.length > 0);
}
