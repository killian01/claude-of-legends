// The power dial's arithmetic: amounts scale inside the engine's
// bounds, structure and rhythm never move, and the kit envelope and the
// burst caps have the last word down a monotone curve, each stop named.

import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../src/sim/combat/casting';
import { BASE_STAT_BOUNDS, EFFECT_BOUNDS, GROWTH_BOUNDS } from '../src/sim/forge/bounds';
import { budgetOf } from '../src/sim/forge/budget';
import { BASICS_BURST_CAP, burstCapOf, burstOf, burstVerdict } from '../src/sim/forge/burst';
import { KIT_ENVELOPE, kitSpendOf } from '../src/sim/forge/envelopes';
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

function kitSpend(def: ForgedChampionDef): number {
  return kitSpendOf(budgetOf(def));
}

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
  it('grants the asked factor when the envelope holds, and never over it', () => {
    const def = structuredClone(FORGED_TWINS[0]!);
    const anchor = def.abilities.Q;
    const small = grantSpellPower(def, 'Q', anchor, 0.5);
    expect(small.factor).toBe(0.5);
    expect(small.stop).toBeNull();
    const maxed = grantSpellPower(def, 'Q', anchor, POWER_DIAL_MAX);
    expect(maxed.factor).toBeLessThanOrEqual(POWER_DIAL_MAX);
    expect(maxed.factor).toBeGreaterThanOrEqual(POWER_DIAL_MIN);
    const after = { ...def, abilities: { ...def.abilities, Q: maxed.ability } };
    // Whether the ask fit whole or was pulled back, the kit lands on or
    // under its envelope and under every cap.
    expect(kitSpend(after)).toBeLessThanOrEqual(KIT_ENVELOPE + 1e-6);
    expect(burstVerdict(after).ok).toBe(true);
    if (maxed.factor < POWER_DIAL_MAX) expect(maxed.stop).not.toBeNull();
  });

  it('names the envelope when the kit is what runs out', () => {
    const def = structuredClone(FORGED_TWINS[1]!);
    // Dain's kit sits on the envelope already: any raise is the envelope's no.
    expect(kitSpend(def)).toBeGreaterThan(0.95 * KIT_ENVELOPE);
    const out = grantSpellPower(def, 'E', def.abilities.E, POWER_DIAL_MAX);
    expect(out.factor).toBeLessThan(POWER_DIAL_MAX);
    expect(out.stop).toBe('envelope');
  });

  it('names the burst cap when one hit is what runs out, and stops there exactly', () => {
    const def = structuredClone(FORGED_TWINS[0]!);
    // A bare kit with one cheap nuke on a long cooldown: the envelope has
    // room to spare, the cap does not.
    const nuke: AbilityDef = {
      ...BOLT,
      cooldown: 20,
      manaCost: 120,
      spec: {
        ...BOLT.spec,
        onHit: [{ kind: 'damage', base: 100, adRatio: 1, dtype: 'physical' }],
      } as AbilityDef['spec'],
    };
    const faint = scaleAbility(BOLT, POWER_DIAL_MIN);
    def.abilities = { Q: nuke, W: faint, E: faint, R: { ...faint, cooldown: 60 } };
    const out = grantSpellPower(def, 'Q', nuke, POWER_DIAL_MAX);
    expect(out.stop).toBe('burst');
    const after = { ...def, abilities: { ...def.abilities, Q: out.ability } };
    expect(burstOf(after).abilities.Q).toBeLessThanOrEqual(burstCapOf('Q'));
    expect(burstOf(after).abilities.Q).toBeGreaterThan(0.99 * burstCapOf('Q'));
    expect(kitSpend(after)).toBeLessThan(KIT_ENVELOPE);
  });

  it('names the basics together when the other two already spent the room', () => {
    const def = structuredClone(FORGED_TWINS[0]!);
    const strike = (base: number, cooldown: number): AbilityDef => ({
      ...BOLT,
      cooldown,
      spec: {
        ...BOLT.spec,
        onHit: [{ kind: 'damage', base, dtype: 'magic' }],
      } as AbilityDef['spec'],
    });
    // W and E each under their own cap, together most of the basics' cap.
    const each = 0.42 * BASICS_BURST_CAP;
    def.abilities = {
      Q: strike(40, 12),
      W: strike(each, 12),
      E: strike(each, 12),
      R: { ...strike(40, 60) },
    };
    expect(burstVerdict(def).ok).toBe(true);
    const out = grantSpellPower(def, 'Q', def.abilities.Q, POWER_DIAL_MAX);
    expect(out.stop).toBe('kit_burst');
    const after = { ...def, abilities: { ...def.abilities, Q: out.ability } };
    expect(burstOf(after).basics).toBeLessThanOrEqual(BASICS_BURST_CAP);
  });

  it('still hands back the floor when the kit is over its envelope anyway', () => {
    const def = structuredClone(FORGED_TWINS[1]!);
    def.abilities.Q = scaleAbility(def.abilities.Q, 2.5);
    def.abilities.W = scaleAbility(def.abilities.W, 2.5);
    expect(kitSpend(def)).toBeGreaterThan(KIT_ENVELOPE);
    const out = grantSpellPower(def, 'E', def.abilities.E, POWER_DIAL_MAX);
    expect(out.factor).toBe(POWER_DIAL_MIN);
    expect(out.stop).toBe('envelope');
  });
});

// Every base and growth stat at its rail: the heaviest body the bounds
// allow. Under the envelopes a body never weighs on the kit; it stays
// here to prove exactly that.
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
  it('raises a light kit to the envelope at one shared factor, structure and rhythm untouched', () => {
    const base = FORGED_TWINS[0]!;
    expect(kitSpend(base)).toBeLessThan(KIT_ENVELOPE);
    const fit = fitKitPower(base);
    expect(fit).not.toBeNull();
    if (!fit) return;
    expect(fit.factor).toBeGreaterThan(1);
    const spend = kitSpend({ ...base, abilities: fit.abilities });
    expect(spend).toBeLessThanOrEqual(KIT_ENVELOPE);
    expect(spend).toBeGreaterThan(KIT_ENVELOPE - 0.5);
    for (const key of ['Q', 'W', 'E', 'R'] as const) {
      expect(fit.abilities[key].spec.kind).toBe(base.abilities[key].spec.kind);
      expect(fit.abilities[key].cooldown).toBe(base.abilities[key].cooldown);
      expect(fit.abilities[key].manaCost).toBe(base.abilities[key].manaCost);
      expect(fit.abilities[key].castRange).toBe(base.abilities[key].castRange);
    }
  });

  it('trims a heavy kit down to the envelope', () => {
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
    expect(kitSpend(heavy)).toBeGreaterThan(KIT_ENVELOPE);
    const fit = fitKitPower(heavy);
    expect(fit).not.toBeNull();
    if (!fit) return;
    expect(fit.factor).toBeLessThan(1);
    const spend = kitSpend({ ...heavy, abilities: fit.abilities });
    expect(spend).toBeLessThanOrEqual(KIT_ENVELOPE);
    expect(spend).toBeGreaterThan(KIT_ENVELOPE - 0.5);
  });

  it('holds the spell a burst cap catches and lets the others take the room', () => {
    const base = FORGED_TWINS[0]!;
    // A kit whose Q is a nuke on a long cooldown beside three faint spells:
    // one shared factor would stop at Q's cap with the envelope half
    // empty. The fit holds Q there and keeps raising the rest.
    const nuke: AbilityDef = {
      ...BOLT,
      cooldown: 20,
      manaCost: 120,
      spec: {
        ...BOLT.spec,
        onHit: [{ kind: 'damage', base: 120, adRatio: 1, dtype: 'physical' }],
      } as AbilityDef['spec'],
    };
    const light = scaleAbility(BOLT, 0.5);
    const def: ForgedChampionDef = {
      ...base,
      abilities: { Q: nuke, W: light, E: light, R: { ...light, cooldown: 60 } },
    };
    const fit = fitKitPower(def);
    expect(fit).not.toBeNull();
    if (!fit) return;
    expect(fit.held).toContain('Q');
    const after = { ...def, abilities: fit.abilities };
    expect(burstVerdict(after).ok).toBe(true);
    expect(burstOf(after).abilities.Q).toBeGreaterThan(0.99 * burstCapOf('Q'));
    const spend = kitSpend(after);
    expect(spend).toBeLessThanOrEqual(KIT_ENVELOPE);
    // The kit reached its line or the dial's ceiling, never tiptoed under.
    expect(spend > KIT_ENVELOPE - 0.5 || fit.factor === POWER_DIAL_MAX).toBe(true);
    // The held spell stayed where the cap caught it while the others rose.
    const qFactor =
      (fit.abilities.Q.spec as unknown as { onHit: { base: number }[] }).onHit[0]!.base / 120;
    expect(fit.factor).toBeGreaterThan(qFactor);
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
    expect(fit?.held).toEqual([]);
  });

  it('ignores the body: the heaviest body allowed leaves the kit its whole envelope', () => {
    const base = FORGED_TWINS[0]!;
    const light = fitKitPower(base);
    const heavy = fitKitPower(maxedBody(base));
    expect(heavy?.factor).toBeCloseTo(light?.factor ?? -1, 6);
  });

  it('finds no factor when the structure overspends at the floor', () => {
    // Four long blinks, untargetable in flight, on the shortest cooldown:
    // all delivery, no amounts to trim.
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
    const def = withKit(FORGED_TWINS[0]!, blink);
    expect(fitKitPower(def)).toBeNull();
  });
});
