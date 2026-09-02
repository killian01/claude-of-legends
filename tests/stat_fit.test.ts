// The stat fit (ADR 0013's envelopes, the stat conversation): a proposed
// stat line lands on the Stat and Growth envelope lines by one shared
// factor per group, shape kept, rails respected, reach and AP and body
// size held, and a flat answer borrows the fresh draft's shape.

import { describe, expect, it } from 'vitest';
import { BASE_STAT_BOUNDS, GROWTH_BOUNDS } from '../src/sim/forge/bounds';
import { budgetOf, costOfBaseStats, costOfGrowth } from '../src/sim/forge/budget';
import { ENVELOPES, envelopeSpend } from '../src/sim/forge/envelopes';
import { freshDraftDef } from '../src/sim/forge/fresh_draft';
import { fitStats, MELEE_REACH, RANGED_MIN, reachOf } from '../src/sim/forge/stat_fit';
import { validateForged } from '../src/sim/forge/validate';
import { FORGED_TWINS } from './forged_twins';

// Landing within the rounding step of the line: never over, and short
// by no more than what rounding down every axis can cost.
const ROUNDING_ROOM = 3;

describe('fitStats', () => {
  it('lands a light line and a heavy line on both envelopes', () => {
    const fresh = freshDraftDef('x');
    const light = fitStats(
      { ...fresh.base, hp: 420, ad: 42, armor: 16 },
      { ...fresh.growth, hp: 45, ad: 1.5 },
    );
    expect(costOfBaseStats(light.base)).toBeLessThanOrEqual(ENVELOPES.stats);
    expect(costOfBaseStats(light.base)).toBeGreaterThan(ENVELOPES.stats - ROUNDING_ROOM);
    expect(costOfGrowth(light.growth)).toBeLessThanOrEqual(ENVELOPES.growth);
    expect(costOfGrowth(light.growth)).toBeGreaterThan(ENVELOPES.growth - ROUNDING_ROOM);
    expect(light.factor.stats).toBeGreaterThan(1);
    expect(light.factor.growth).toBeGreaterThan(1);

    const heavy = fitStats(
      { ...fresh.base, hp: 800, ad: 80, armor: 45, mr: 45, moveSpeed: 4.2 },
      { hp: 130, mana: 60, ad: 7, armor: 4.5, mr: 3 },
    );
    expect(costOfBaseStats(heavy.base)).toBeLessThanOrEqual(ENVELOPES.stats);
    expect(costOfBaseStats(heavy.base)).toBeGreaterThan(ENVELOPES.stats - ROUNDING_ROOM);
    expect(costOfGrowth(heavy.growth)).toBeLessThanOrEqual(ENVELOPES.growth);
    expect(heavy.factor.stats).toBeLessThan(1);
    expect(heavy.factor.growth).toBeLessThan(1);
  });

  it('keeps the shape: points above the floors scale together', () => {
    const fresh = freshDraftDef('x');
    // Twice as much HP above the floor as armor above its floor, priced
    // apart; after the fit the ratio of the points above the floors holds.
    const fit = fitStats(
      { ...fresh.base, hp: 400 + 200, armor: 15 + 10, mr: 15 + 10, ad: 40 + 10 },
      fresh.growth,
    );
    const hpAbove = fit.base.hp - BASE_STAT_BOUNDS.hp.min;
    const armorAbove = fit.base.armor - BASE_STAT_BOUNDS.armor.min;
    expect(hpAbove / armorAbove).toBeCloseTo(20, 0);
  });

  it('holds an axis at its rail while the others rise, and never crosses a bound', () => {
    const fresh = freshDraftDef('x');
    const fit = fitStats({ ...fresh.base, ad: 80, hp: 410, armor: 16 }, fresh.growth);
    expect(fit.base.ad).toBe(BASE_STAT_BOUNDS.ad.max);
    expect(fit.base.hp).toBeGreaterThan(410);
    for (const k of Object.keys(BASE_STAT_BOUNDS) as (keyof typeof BASE_STAT_BOUNDS)[]) {
      expect(fit.base[k]).toBeGreaterThanOrEqual(BASE_STAT_BOUNDS[k].min);
      expect(fit.base[k]).toBeLessThanOrEqual(BASE_STAT_BOUNDS[k].max);
    }
    for (const k of Object.keys(GROWTH_BOUNDS) as (keyof typeof GROWTH_BOUNDS)[]) {
      expect(fit.growth[k]).toBeGreaterThanOrEqual(GROWTH_BOUNDS[k].min);
      expect(fit.growth[k]).toBeLessThanOrEqual(GROWTH_BOUNDS[k].max);
    }
  });

  it('holds the reach as asked: melee at the pin, ranged inside its rails, never scaled', () => {
    expect(reachOf(1)).toBe(MELEE_REACH);
    expect(reachOf(2)).toBe(MELEE_REACH);
    expect(reachOf(2.1)).toBe(RANGED_MIN);
    expect(reachOf(5.5)).toBe(5.5);
    expect(reachOf(40)).toBe(BASE_STAT_BOUNDS.attackRange.max);
    const fresh = freshDraftDef('x');
    const melee = fitStats({ ...fresh.base, attackRange: 1.5, hp: 420 }, fresh.growth);
    expect(melee.base.attackRange).toBe(MELEE_REACH);
    const ranged = fitStats({ ...fresh.base, attackRange: 6, hp: 420 }, fresh.growth);
    expect(ranged.base.attackRange).toBe(6);
    // AP stays the roster's zero; body size is kept, clamped, and free.
    expect(ranged.base.ap).toBe(0);
    const wide = fitStats({ ...fresh.base, radius: 3 }, fresh.growth);
    expect(wide.base.radius).toBe(BASE_STAT_BOUNDS.radius.max);
  });

  it('gives a flat answer the fresh draft shape, and fills in missing fields', () => {
    const floors = Object.fromEntries(
      Object.entries(BASE_STAT_BOUNDS).map(([k, b]) => [k, b.min]),
    ) as Parameters<typeof fitStats>[0];
    const flat = fitStats(floors, {});
    expect(costOfBaseStats(flat.base)).toBeGreaterThan(ENVELOPES.stats - ROUNDING_ROOM);
    expect(costOfGrowth(flat.growth)).toBeGreaterThan(ENVELOPES.growth - ROUNDING_ROOM);
    const partial = fitStats({ hp: 700 }, { ad: 5 });
    expect(Number.isFinite(partial.base.moveSpeed)).toBe(true);
    expect(Number.isFinite(partial.growth.armor)).toBe(true);
  });

  it('validates on every roster twin, sitting on both lines', () => {
    for (const twin of FORGED_TWINS) {
      const fit = fitStats(twin.base, twin.growth);
      const def = { ...twin, base: fit.base, growth: fit.growth };
      const v = validateForged(def);
      expect(v.ok ? [] : v.errors).toEqual([]);
      const spend = envelopeSpend(budgetOf(def));
      expect(spend.stats).toBeLessThanOrEqual(ENVELOPES.stats);
      expect(spend.stats).toBeGreaterThan(ENVELOPES.stats - ROUNDING_ROOM);
      expect(spend.growth).toBeLessThanOrEqual(ENVELOPES.growth);
      expect(spend.growth).toBeGreaterThan(ENVELOPES.growth - ROUNDING_ROOM);
    }
  });
});
