// The power dial's arithmetic: amounts scale inside the engine's
// bounds, structure and rhythm never move, and the budget has the last
// word down a monotone cost curve.

import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../src/sim/combat/casting';
import { BASE_STAT_BOUNDS, EFFECT_BOUNDS, GROWTH_BOUNDS } from '../src/sim/forge/bounds';
import { budgetOf, POWER_BUDGET } from '../src/sim/forge/budget';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import {
  fitKitPower,
  grantSpellPower,
  POWER_DIAL_MAX,
  POWER_DIAL_MIN,
  scaleAbility,
} from '../src/sim/forge/spell_power';
import { FORGED_TWINS } from './forged_twins';

const BOLT: AbilityDef = {
  name: 'Test Bolt',
  manaCost: 40,
  cooldown: 8,
  castRange: 7,
  spec: {
    kind: 'skillshot',
    speed: 20,
    radius: 0.8,
    range: 7,
    onHit: [
      { kind: 'damage', base: 80, adRatio: 0.5, dtype: 'magic' },
      { kind: 'slow', pct: 0.3, duration: 1.5 },
    ],
  },
} as AbilityDef;

describe('scaleAbility', () => {
  it('scales amounts, clamps to bounds, and leaves structure and rhythm', () => {
    const up = scaleAbility(BOLT, 2);
    const spec = up.spec as Extract<AbilityDef['spec'], { kind: 'skillshot' }>;
    const dmg = spec.onHit[0] as { base: number; adRatio?: number };
    const slow = spec.onHit[1] as { pct: number; duration: number };
    expect(dmg.base).toBe(160);
    expect(dmg.adRatio).toBe(1);
    // slow pct doubles but clamps at its bound max.
    expect(slow.pct).toBe(Math.min(EFFECT_BOUNDS.slow?.pct?.max ?? 1, 0.6));
    // duration is a slow's structure here (not scaled: pct is the amount).
    expect(slow.duration).toBe(1.5);
    // Structure and rhythm untouched.
    expect(spec.range).toBe(7);
    expect(spec.speed).toBe(20);
    expect(up.cooldown).toBe(8);
    expect(up.manaCost).toBe(40);
    // The anchor itself was never mutated.
    expect((BOLT.spec as unknown as { onHit: { base?: number }[] }).onHit[0]?.base).toBe(80);
  });

  it('clamps down to the field floors at the dial minimum', () => {
    const down = scaleAbility(BOLT, POWER_DIAL_MIN);
    const spec = down.spec as Extract<AbilityDef['spec'], { kind: 'skillshot' }>;
    const dmg = spec.onHit[0] as { base: number };
    const slow = spec.onHit[1] as { pct: number };
    expect(dmg.base).toBe(20);
    expect(slow.pct).toBeCloseTo(Math.max(EFFECT_BOUNDS.slow?.pct?.min ?? 0, 0.075), 6);
  });
});

describe('grantSpellPower', () => {
  it('grants the asked factor when the budget holds, and never over it', () => {
    const def = structuredClone(FORGED_TWINS[0]!);
    const anchor = def.abilities.Q;
    const small = grantSpellPower(def, 'Q', anchor, 0.5);
    expect(small.factor).toBe(0.5);
    const maxed = grantSpellPower(def, 'Q', anchor, POWER_DIAL_MAX);
    expect(maxed.factor).toBeLessThanOrEqual(POWER_DIAL_MAX);
    expect(maxed.factor).toBeGreaterThanOrEqual(POWER_DIAL_MIN);
    const total = budgetOf({
      ...def,
      abilities: { ...def.abilities, Q: maxed.ability },
    }).total;
    // Whether the ask fit whole or was pulled back, the champion lands
    // on or under the line.
    expect(total).toBeLessThanOrEqual(POWER_BUDGET + 1e-6);
  });

  it('still hands back the floor when the champion is over budget anyway', () => {
    const def = structuredClone(FORGED_TWINS[0]!);
    // Blow the budget elsewhere: max hp beyond affordability.
    def.base.hp = 800;
    def.base.ad = 80;
    def.base.armor = 45;
    def.base.mr = 45;
    const out = grantSpellPower(def, 'Q', def.abilities.Q, POWER_DIAL_MAX);
    if (budgetOf(def).total > POWER_BUDGET) {
      expect(out.factor).toBe(POWER_DIAL_MIN);
    }
  });
});

// Every base and growth stat at its rail: the heaviest body the bounds
// allow, for kits that must overspend no matter the amounts.
function maxedBody(def: ForgedChampionDef): ForgedChampionDef {
  const base = { ...def.base };
  const growth = { ...def.growth };
  for (const key of Object.keys(BASE_STAT_BOUNDS) as (keyof typeof BASE_STAT_BOUNDS)[]) {
    base[key] = BASE_STAT_BOUNDS[key].max;
  }
  for (const key of Object.keys(GROWTH_BOUNDS) as (keyof typeof GROWTH_BOUNDS)[]) {
    growth[key] = GROWTH_BOUNDS[key].max;
  }
  return { ...def, base, growth };
}

function withKit(def: ForgedChampionDef, ability: AbilityDef): ForgedChampionDef {
  return { ...def, abilities: { Q: ability, W: ability, E: ability, R: ability } };
}

describe('fitKitPower', () => {
  it('raises a light kit to the line at one shared factor, structure and rhythm untouched', () => {
    const base = FORGED_TWINS[0]!;
    expect(budgetOf(base).total).toBeLessThan(POWER_BUDGET);
    const fit = fitKitPower(base);
    expect(fit).not.toBeNull();
    if (!fit) return;
    expect(fit.factor).toBeGreaterThan(1);
    const total = budgetOf({ ...base, abilities: fit.abilities }).total;
    expect(total).toBeLessThanOrEqual(POWER_BUDGET);
    expect(total).toBeGreaterThan(POWER_BUDGET - 0.5);
    for (const key of ['Q', 'W', 'E', 'R'] as const) {
      expect(fit.abilities[key].spec.kind).toBe(base.abilities[key].spec.kind);
      expect(fit.abilities[key].cooldown).toBe(base.abilities[key].cooldown);
      expect(fit.abilities[key].manaCost).toBe(base.abilities[key].manaCost);
      expect(fit.abilities[key].castRange).toBe(base.abilities[key].castRange);
    }
  });

  it('trims a heavy kit down to the line', () => {
    const base = FORGED_TWINS[1]!;
    const heavy: ForgedChampionDef = {
      ...base,
      abilities: {
        Q: scaleAbility(base.abilities.Q, 2),
        W: scaleAbility(base.abilities.W, 2),
        E: scaleAbility(base.abilities.E, 2),
        R: scaleAbility(base.abilities.R, 2),
      },
    };
    expect(budgetOf(heavy).total).toBeGreaterThan(POWER_BUDGET);
    const fit = fitKitPower(heavy);
    expect(fit).not.toBeNull();
    if (!fit) return;
    expect(fit.factor).toBeLessThan(1);
    const total = budgetOf({ ...heavy, abilities: fit.abilities }).total;
    expect(total).toBeLessThanOrEqual(POWER_BUDGET);
    expect(total).toBeGreaterThan(POWER_BUDGET - 0.5);
  });

  it('stops at the dial maximum when even that stays under the line', () => {
    const faint: AbilityDef = {
      ...BOLT,
      cooldown: 20,
      spec: {
        ...BOLT.spec,
        onHit: [{ kind: 'damage', base: 5, dtype: 'magic' }],
      } as AbilityDef['spec'],
    };
    const fit = fitKitPower(withKit(FORGED_TWINS[0]!, faint));
    expect(fit?.factor).toBe(POWER_DIAL_MAX);
  });

  it('finds no factor when the structure overspends at the floor', () => {
    // Four long blinks, untargetable in flight, on the shortest cooldown:
    // all delivery, no amounts to trim, on the heaviest body allowed.
    const blink = {
      name: 'Blink',
      manaCost: 0,
      cooldown: 2,
      castRange: 8,
      spec: {
        kind: 'dash',
        range: 8,
        landRadius: 0,
        onLand: [],
        selfEffects: [],
        passThrough: [],
        untargetableDuringTravel: true,
      },
    } as unknown as AbilityDef;
    const def = maxedBody(withKit(FORGED_TWINS[0]!, blink));
    expect(fitKitPower(def)).toBeNull();
  });
});
