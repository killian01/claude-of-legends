// The stat fit (CONTEXT.md, Stat suggestion): a proposed stat line landed
// on its envelope lines the way the kit conversation's proposals land on
// the Kit envelope. A proposal's shape is its points above each floor;
// the fit scales that shape by one shared factor per group (base stats
// against the Stat envelope, growth against the Growth envelope), clamped
// to the hard bounds, searched rather than solved because clamping makes
// the spend monotone but not linear. What is never scaled: the melee or
// ranged choice and its reach (an identity, pinned or held as asked), AP
// (zero, like the roster), and body size (free). A shape with no point
// above any floor borrows the fresh draft's, so a flat answer still lands
// on the line instead of at the floors. Values come back rounded DOWN to
// the step the polygon reads them at, so rounding never crosses a line.

import { RANGED_THRESHOLD } from '../combat/auto_attack';
import type { ChampionBaseStats, ChampionGrowth } from '../content/champions';
import { BASE_STAT_BOUNDS, type Bound, GROWTH_BOUNDS } from './bounds';
import { BASE_STAT_PRICES, costOfBaseStats, costOfGrowth, GROWTH_PRICES } from './budget';
import { GROWTH_ENVELOPE, STAT_ENVELOPE } from './envelopes';
import { freshDraftDef } from './fresh_draft';

// The melee pin: the roster's standard melee reach, safely under the
// engine's ranged threshold (auto_attack.ts).
export const MELEE_REACH = 1.8;
// The ranged floor: clearly above the threshold, so a reach at its
// minimum never flips the champion back to melee by accident.
export const RANGED_MIN = RANGED_THRESHOLD + 0.5;

// The factor range the search covers: wide enough that one point above
// a floor reaches its rail.
export const STAT_FIT_MAX = 64;

// The base axes the fit scales, each with the step its value is read at.
// Reach, AP and body size are held, never scaled.
const BASE_STEPS = {
  hp: 1,
  mana: 1,
  ad: 0.1,
  armor: 0.1,
  mr: 0.1,
  attackSpeed: 0.01,
  moveSpeed: 0.01,
  hpRegen: 0.01,
  manaRegen: 0.01,
} as const;
const GROWTH_STEPS = { hp: 1, mana: 1, ad: 0.1, armor: 0.1, mr: 0.1 } as const;
type ScaledBase = keyof typeof BASE_STEPS;
const BASE_KEYS = Object.keys(BASE_STEPS) as ScaledBase[];
const GROWTH_KEYS = Object.keys(GROWTH_STEPS) as (keyof ChampionGrowth)[];

export interface StatFit {
  base: ChampionBaseStats;
  growth: ChampionGrowth;
  // The shared factor each group's shape was scaled by: 1 means the
  // proposal's own numbers, above it raised to the line, below it
  // trimmed to fit.
  factor: { stats: number; growth: number };
}

function clamp(v: number, b: Bound): number {
  return Math.min(b.max, Math.max(b.min, v));
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// Rounded down onto the step grid (every floor sits on it).
function floorTo(v: number, step: number): number {
  const decimals = step >= 1 ? 0 : Math.round(-Math.log10(step));
  return Number((Math.floor(v / step + 1e-9) * step).toFixed(decimals));
}

// The reach as the proposal means it: at or under the threshold, melee
// at the pin; above it, ranged inside the ranged rails.
export function reachOf(asked: number): number {
  if (!Number.isFinite(asked) || asked <= RANGED_THRESHOLD) return MELEE_REACH;
  return clamp(asked, { min: RANGED_MIN, max: BASE_STAT_BOUNDS.attackRange.max });
}

// The largest factor whose spend stays on or under the line: everything
// at its rail when even that fits, bisected otherwise.
function factorFor(spendAt: (f: number) => number, line: number): number {
  if (spendAt(STAT_FIT_MAX) <= line) return STAT_FIT_MAX;
  let lo = 0;
  let hi = STAT_FIT_MAX;
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    if (spendAt(mid) <= line) lo = mid;
    else hi = mid;
  }
  return lo;
}

// A group's shape: the points above each floor, the fresh draft's when
// the proposal has none (a flat answer would otherwise stay flat).
function shapeOf<K extends string>(
  keys: readonly K[],
  asked: Partial<Record<K, number>>,
  bounds: Record<K, Bound>,
  prices: Record<K, number>,
  fresh: Record<K, number>,
): Record<K, number> {
  const shape = {} as Record<K, number>;
  let weight = 0;
  for (const k of keys) {
    const b = bounds[k];
    shape[k] = Math.max(0, clamp(num(asked[k], b.min), b) - b.min);
    weight += shape[k] * prices[k];
  }
  if (weight > 0) return shape;
  for (const k of keys) shape[k] = fresh[k] - bounds[k].min;
  return shape;
}

export function fitStats(
  base: Partial<ChampionBaseStats>,
  growth: Partial<ChampionGrowth>,
): StatFit {
  const fresh = freshDraftDef('fit');

  // Base stats: the held fields, then the shape over the floors.
  const reach = reachOf(num(base.attackRange, fresh.base.attackRange));
  const radius = clamp(num(base.radius, fresh.base.radius), BASE_STAT_BOUNDS.radius);
  const baseShape = shapeOf(BASE_KEYS, base, BASE_STAT_BOUNDS, BASE_STAT_PRICES, fresh.base);
  const baseAt = (f: number): ChampionBaseStats => {
    const out: ChampionBaseStats = { ...fresh.base, ap: 0, attackRange: reach, radius };
    for (const k of BASE_KEYS) {
      const b = BASE_STAT_BOUNDS[k];
      out[k] = clamp(b.min + baseShape[k] * f, b);
    }
    return out;
  };
  const baseFactor = factorFor((f) => costOfBaseStats(baseAt(f)), STAT_ENVELOPE);
  const fitBase = baseAt(baseFactor);
  for (const k of BASE_KEYS) fitBase[k] = floorTo(fitBase[k], BASE_STEPS[k]);

  // Growth: every axis scales.
  const growthShape = shapeOf(GROWTH_KEYS, growth, GROWTH_BOUNDS, GROWTH_PRICES, fresh.growth);
  const growthAt = (f: number): ChampionGrowth => {
    const out: ChampionGrowth = { ...fresh.growth };
    for (const k of GROWTH_KEYS) {
      const b = GROWTH_BOUNDS[k];
      out[k] = clamp(b.min + growthShape[k] * f, b);
    }
    return out;
  };
  const growthFactor = factorFor((f) => costOfGrowth(growthAt(f)), GROWTH_ENVELOPE);
  const fitGrowth = growthAt(growthFactor);
  for (const k of GROWTH_KEYS) fitGrowth[k] = floorTo(fitGrowth[k], GROWTH_STEPS[k]);

  return {
    base: fitBase,
    growth: fitGrowth,
    factor: { stats: baseFactor, growth: growthFactor },
  };
}
