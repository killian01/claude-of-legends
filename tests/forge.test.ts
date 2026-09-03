// Forge phase 1 (plan-forge, ADR 0006): the forged schema, the passive
// template set, and the deterministic validator. Pins the budget
// arithmetic, exercises the bounds rejections, and proves the ten roster
// champions, converted to forged shape, all fit the power budget (the
// roster is the calibration set: what shipped is by definition affordable).

import { describe, expect, it } from 'vitest';
import type { EffectSpec } from '../src/sim/combat/effects';
import { CHAMPIONS } from '../src/sim/content/champions';
import {
  AVAIL_PIVOT,
  AVAIL_SOFT,
  budgetOf,
  CAST_PRICES,
  costOfAbility,
  costOfBaseStats,
  costOfEffect,
  costOfEffects,
  costOfPassive,
  EFFECT_PRICES,
  POWER_BUDGET,
} from '../src/sim/forge/budget';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { PASSIVE_TEMPLATE_LIST, PASSIVE_TEMPLATES } from '../src/sim/forge/passive_templates';
import { resolveForgedChampion } from '../src/sim/forge/resolve';
import { validateForged } from '../src/sim/forge/validate';
import { FORGED_TWINS, forgedTwin } from './forged_twins';

// A minimal valid forged champion: every stat at its hard floor (zero stat
// cost), four modest abilities, no passive hook. The mutation base for the
// rejection tests.
function mini(): ForgedChampionDef {
  return {
    id: 'forged_mini',
    name: 'Mini',
    title: 'the Baseline',
    tagline: 'A floor-stats probe.',
    role: 'Mage',
    creator: 'tester#0001',
    passive: { template: 'kit_inscribed', params: {}, name: 'Quiet' },
    base: {
      hp: 400,
      mana: 200,
      ad: 40,
      ap: 0,
      armor: 15,
      mr: 15,
      attackRange: 1,
      attackSpeed: 0.4,
      moveSpeed: 3.3,
      hpRegen: 0.5,
      manaRegen: 0.5,
      radius: 0.5,
    },
    growth: { hp: 40, mana: 10, ad: 1, armor: 1, mr: 0.5 },
    abilities: {
      Q: {
        name: 'Bolt',
        manaCost: 30,
        cooldown: 6,
        castRange: 8,
        spec: {
          kind: 'skillshot',
          speed: 20,
          radius: 0.5,
          range: 8,
          onHit: [{ kind: 'damage', base: 60, adRatio: 0.5, dtype: 'physical' }],
        },
      },
      W: {
        name: 'Field',
        manaCost: 40,
        cooldown: 10,
        castRange: 7,
        spec: {
          kind: 'zone',
          radius: 2.5,
          duration: 3,
          onTick: [{ kind: 'damage', base: 10, dtype: 'magic' }],
        },
      },
      E: {
        name: 'Step',
        manaCost: 30,
        cooldown: 9,
        castRange: 4,
        spec: { kind: 'dash', range: 3, speed: 14 },
      },
      R: {
        name: 'Comet',
        manaCost: 80,
        cooldown: 70,
        castRange: 9,
        windup: 0.3,
        spec: {
          kind: 'zone',
          radius: 3,
          duration: 1.5,
          detonateDelay: 1.2,
          onDetonate: [
            { kind: 'damage', base: 200, apRatio: 1, dtype: 'magic' },
            { kind: 'stun', duration: 1 },
          ],
        },
      },
    },
  };
}

function expectRejected(def: ForgedChampionDef, ...fragments: string[]): void {
  const v = validateForged(def);
  expect(v.ok).toBe(false);
  if (v.ok) return;
  for (const fragment of fragments) {
    expect(
      v.errors.some((e) => e.includes(fragment)),
      `expected an error mentioning '${fragment}', got:\n${v.errors.join('\n')}`,
    ).toBe(true);
  }
}

describe('budget arithmetic', () => {
  it('prices a damage effect as base plus ratio value', () => {
    const cost = costOfEffect({ kind: 'damage', base: 100, adRatio: 1, dtype: 'physical' });
    expect(cost).toBeCloseTo(100 + EFFECT_PRICES.ratioValue, 10);
  });

  it('prices hard crowd control per second', () => {
    expect(costOfEffect({ kind: 'stun', duration: 1 })).toBeCloseTo(
      EFFECT_PRICES.stunPerSecond,
      10,
    );
    expect(costOfEffect({ kind: 'root', duration: 1.5 })).toBeCloseTo(
      1.5 * EFFECT_PRICES.rootPerSecond,
      10,
    );
  });

  it('divides a mark trigger by the stacks needed to earn it', () => {
    const trigger: EffectSpec[] = [{ kind: 'damage', base: 90, dtype: 'magic' }];
    const cost = costOfEffect({
      kind: 'mark',
      duration: 4,
      stacksToTrigger: 3,
      onTrigger: trigger,
    });
    expect(cost).toBeCloseTo(EFFECT_PRICES.markOverhead + 90 / 3, 10);
  });

  it('charges a conditional for its strong branch plus a quarter of the weak one', () => {
    const cost = costOfEffect({
      kind: 'conditional',
      when: { kind: 'targetSlowed' },
      effects: [{ kind: 'damage', base: 100, dtype: 'magic' }],
      otherwise: [{ kind: 'damage', base: 40, dtype: 'magic' }],
    });
    expect(cost).toBeCloseTo(100 + EFFECT_PRICES.conditionalWeakBranch * 40, 10);
  });

  it('charges a bursting shield for its strongest detonation only', () => {
    const onBreak: EffectSpec[] = [{ kind: 'damage', base: 80, dtype: 'magic' }];
    const onExpire: EffectSpec[] = [{ kind: 'damage', base: 50, dtype: 'magic' }];
    const cost = costOfEffect({
      kind: 'shield',
      base: 100,
      duration: 3,
      burst: { radius: 2.5, onBreak, onExpire },
    });
    expect(cost).toBeCloseTo(
      100 * EFFECT_PRICES.shieldWeight + 80 * EFFECT_PRICES.shieldBurstWeight,
      10,
    );
  });

  it('scales an ability by availability and relieves mana and windup', () => {
    const q = mini().abilities.Q;
    const delivery =
      costOfEffects(q.spec.kind === 'skillshot' ? q.spec.onHit : []) *
      (0.85 + 0.5 * 0.25) *
      (1 + 8 * 0.015);
    const expected =
      delivery * (AVAIL_PIVOT / (AVAIL_SOFT + q.cooldown)) * (1 - q.manaCost * 0.0024);
    expect(costOfAbility(q)).toBeCloseTo(expected, 10);
  });

  it('prices atRank overrides at the priciest reachable spec', () => {
    const base = costOfAbility(CHAMPIONS.sylra!.abilities.R);
    const withoutOverride = costOfAbility({ ...CHAMPIONS.sylra!.abilities.R, atRank: undefined });
    expect(base).toBeGreaterThan(withoutOverride);
  });

  it('charges a flat premium for a recast', () => {
    const r = CHAMPIONS.fenn!.abilities.R;
    const withoutRecast = costOfAbility({ ...r, recast: undefined });
    expect(costOfAbility(r)).toBeCloseTo(withoutRecast + CAST_PRICES.recastCost, 10);
  });

  it('prices stats per point above the hard floor, so floor stats cost zero', () => {
    const m = mini();
    expect(costOfBaseStats(m.base)).toBe(0);
    expect(costOfBaseStats({ ...m.base, hp: 500 })).toBeCloseTo(100 * 0.15, 10);
  });

  it('prices a passive template linearly from its params', () => {
    const cost = costOfPassive({
      template: 'warding_aura',
      params: { radius: 6, armor: 8, mr: 0 },
      name: 'Aura',
    });
    expect(cost).toBeCloseTo(10 + 6 * 2 + 8 * 3, 10);
  });

  it('clamps a weak passive at zero instead of refunding points', () => {
    const cost = costOfPassive({
      template: 'rhythm_echo',
      params: { every: 5, adRatio: 0.2 },
      name: 'Echo',
    });
    expect(cost).toBe(0);
  });

  it('sums the breakdown into the total', () => {
    const b = budgetOf(forgedTwin(CHAMPIONS.torv!));
    expect(b.total).toBeCloseTo(
      b.stats +
        b.growth +
        b.passive +
        b.abilities.Q +
        b.abilities.W +
        b.abilities.E +
        b.abilities.R,
      10,
    );
  });

  it('pins the minimal kit golden total', () => {
    // Deliberate golden number: a price change must come here and say so.
    expect(budgetOf(mini()).total).toBeCloseTo(155.9, 1);
  });
});

describe('bounds rejections', () => {
  it('rejects a stat outside its hard bounds', () => {
    const def = mini();
    def.base.hp = 900;
    expectRejected(def, 'base.hp');
  });

  it('rejects non-finite numbers anywhere', () => {
    const def = mini();
    def.base.ad = Number.NaN;
    expectRejected(def, 'base.ad');
  });

  it('rejects an overlong crowd control duration', () => {
    const def = mini();
    def.abilities.Q.spec = {
      kind: 'skillshot',
      speed: 20,
      radius: 0.5,
      range: 8,
      onHit: [{ kind: 'stun', duration: 5 }],
    };
    expectRejected(def, 'abilities.Q.spec.onHit[0].duration');
  });

  it('holds ultimates and basics to different cooldown rails', () => {
    const shortUlt = mini();
    shortUlt.abilities.R.cooldown = 10;
    expectRejected(shortUlt, 'abilities.R.cooldown');
    const slowBasic = mini();
    slowBasic.abilities.Q.cooldown = 25;
    expectRejected(slowBasic, 'abilities.Q.cooldown');
  });

  it('rejects true damage in a forged kit', () => {
    const def = mini();
    def.abilities.Q.spec = {
      kind: 'skillshot',
      speed: 20,
      radius: 0.5,
      range: 8,
      onHit: [{ kind: 'damage', base: 60, dtype: 'true' }],
    };
    expectRejected(def, 'abilities.Q.spec.onHit[0].dtype');
  });

  it('rejects unknown cast and effect kinds', () => {
    const def = mini();
    def.abilities.W.spec = { kind: 'meteor_rain' } as never;
    expectRejected(def, "unknown cast kind 'meteor_rain'");
    const def2 = mini();
    def2.abilities.Q.spec = {
      kind: 'skillshot',
      speed: 20,
      radius: 0.5,
      range: 8,
      onHit: [{ kind: 'delete_enemy' } as never],
    };
    expectRejected(def2, "unknown effect kind 'delete_enemy'");
  });

  it('rejects over-deep nesting and oversized effect lists', () => {
    const deep = mini();
    let effect: EffectSpec = { kind: 'damage', base: 10, dtype: 'magic' };
    for (let i = 0; i < 6; i++) {
      effect = { kind: 'conditional', when: { kind: 'targetSlowed' }, effects: [effect] };
    }
    deep.abilities.Q.spec = {
      kind: 'skillshot',
      speed: 20,
      radius: 0.5,
      range: 8,
      onHit: [effect],
    };
    expectRejected(deep, 'nest deeper');

    const wide = mini();
    wide.abilities.Q.spec = {
      kind: 'skillshot',
      speed: 20,
      radius: 0.5,
      range: 8,
      onHit: Array.from({ length: 9 }, () => ({
        kind: 'damage' as const,
        base: 10,
        dtype: 'magic' as const,
      })),
    };
    expectRejected(wide, 'effects in one list');
  });

  it('rejects a missing or extra ability key', () => {
    const def = mini();
    delete (def.abilities as Record<string, unknown>).E;
    expectRejected(def, 'abilities.E: missing');
    const def2 = mini();
    (def2.abilities as Record<string, unknown>).T = def2.abilities.Q;
    expectRejected(def2, 'abilities.T: unknown ability key');
  });

  it('rejects a roster-colliding or malformed id', () => {
    const def = mini();
    def.id = 'sylra';
    expectRejected(def, 'id:');
    const def2 = mini();
    def2.id = 'forged_UPPER';
    expectRejected(def2, 'id:');
  });

  it('rejects an unknown passive template, out-of-range and undeclared params', () => {
    const def = mini();
    def.passive = { template: 'global_stun', params: {}, name: 'No' };
    expectRejected(def, "unknown template 'global_stun'");
    const def2 = mini();
    def2.passive = {
      template: 'warding_aura',
      params: { radius: 50, armor: 8, mr: 0 },
      name: 'Aura',
    };
    expectRejected(def2, 'passive.params.radius');
    const def3 = mini();
    def3.passive = {
      template: 'warding_aura',
      params: { radius: 6, armor: 8, mr: 0, lifesteal: 1 },
      name: 'Aura',
    };
    expectRejected(def3, 'passive.params.lifesteal: not a parameter');
  });

  it('rejects a non-integer where the param demands one', () => {
    const def = mini();
    def.passive = {
      template: 'rhythm_echo',
      params: { every: 2.5, adRatio: 0.5 },
      name: 'Echo',
    };
    expectRejected(def, 'passive.params.every');
  });

  it('demands a windup on instant hard crowd control', () => {
    const def = mini();
    def.abilities.E = {
      name: 'Clap',
      manaCost: 40,
      cooldown: 9,
      castRange: 0,
      spec: { kind: 'burst', radius: 3, effects: [{ kind: 'stun', duration: 1 }] },
    };
    expectRejected(def, 'abilities.E: instant hard crowd control');
    def.abilities.E.windup = 0.25;
    expect(validateForged(def).ok).toBe(true);
  });

  it('reports every violation, not just the first', () => {
    const def = mini();
    def.base.hp = 900;
    def.base.ad = 999;
    def.abilities.R.cooldown = 5;
    const v = validateForged(def);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the power budget is the balance authority', () => {
  it('accepts every roster champion converted to forged shape', () => {
    for (const twin of FORGED_TWINS) {
      const v = validateForged(twin);
      expect(v.ok, `${twin.id}: ${v.ok ? '' : v.errors.join('; ')}`).toBe(true);
    }
  });

  it('keeps the budget line tight against the priciest roster kit', () => {
    const totals = FORGED_TWINS.map((t) => budgetOf(t).total);
    const max = Math.max(...totals);
    expect(max).toBeLessThanOrEqual(POWER_BUDGET);
    // The line sits just above the roster ceiling: a forged kit cannot be
    // meaningfully stronger than everything that shipped.
    expect(max).toBeGreaterThan(0.9 * POWER_BUDGET);
  });

  it('rejects a max-everything kit on budget, not bounds', () => {
    const def = mini();
    def.base = {
      hp: 800,
      mana: 600,
      ad: 80,
      ap: 0,
      armor: 45,
      mr: 45,
      attackRange: 7.5,
      attackSpeed: 1,
      moveSpeed: 4.2,
      hpRegen: 3,
      manaRegen: 3,
      radius: 0.5,
    };
    def.growth = { hp: 130, mana: 60, ad: 7, armor: 4.5, mr: 3 };
    def.abilities.Q = {
      name: 'Everything Beam',
      manaCost: 0,
      cooldown: 2,
      castRange: 14,
      spec: {
        kind: 'skillshot',
        speed: 30,
        radius: 2,
        range: 14,
        pierce: true,
        onHit: [{ kind: 'damage', base: 320, adRatio: 2.2, dtype: 'physical' }],
      },
    };
    expectRejected(def, 'power budget:');
  });
});

describe('serialization and resolution', () => {
  it('survives a JSON round trip with an identical bill', () => {
    for (const twin of FORGED_TWINS) {
      const copy = JSON.parse(JSON.stringify(twin)) as ForgedChampionDef;
      const v = validateForged(copy);
      expect(v.ok, twin.id).toBe(true);
      expect(budgetOf(copy).total).toBe(budgetOf(twin).total);
    }
  });

  it('holds no functions anywhere in a forged def', () => {
    const walk = (value: unknown, path: string): void => {
      expect(typeof value, path).not.toBe('function');
      if (typeof value === 'object' && value !== null) {
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    for (const twin of FORGED_TWINS) walk(twin, twin.id);
  });

  it('resolves into a runnable ChampionDef with a derived description', () => {
    const resolved = resolveForgedChampion(forgedTwin(CHAMPIONS.torv!));
    expect(resolved.id).toBe('forged_torv_twin');
    expect(resolved.name).toBe('Torv, Stonehorn');
    expect(resolved.passive.name).toBe('Bulwark Aura');
    expect(resolved.passive.description).toBe(
      'Allied champions within 6 gain 8 bonus armor and 0 bonus magic resist.',
    );
    expect(typeof resolved.passive.onTick).toBe('function');
    expect(resolved.abilities.Q).toBe(CHAMPIONS.torv!.abilities.Q);
  });

  it('resolves kit_inscribed into a hookless passive', () => {
    const resolved = resolveForgedChampion(forgedTwin(CHAMPIONS.sylra!));
    expect(resolved.passive.onTick).toBeUndefined();
    expect(resolved.passive.onAttackHit).toBeUndefined();
    expect(resolved.passive.modifyDamage).toBeUndefined();
  });

  it('throws on an unresolved template instead of running half a champion', () => {
    const def = mini();
    def.passive = { template: 'nope', params: {}, name: 'X' };
    expect(() => resolveForgedChampion(def)).toThrow(/unknown passive template/);
  });
});

describe('the template set', () => {
  it('registers every template under its own id', () => {
    for (const tpl of PASSIVE_TEMPLATE_LIST) {
      expect(PASSIVE_TEMPLATES[tpl.id]).toBe(tpl);
    }
  });

  it('describes itself deterministically from params', () => {
    for (const tpl of PASSIVE_TEMPLATE_LIST) {
      const params = Object.fromEntries(tpl.params.map((p) => [p.key, p.min]));
      expect(tpl.describe(params)).toBe(tpl.describe({ ...params }));
      expect(tpl.describe(params).length).toBeGreaterThan(0);
    }
  });
});
