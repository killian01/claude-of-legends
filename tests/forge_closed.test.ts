// The Forge's vocabulary stays closed to what the roster has and the Forge
// does not offer yet (forge/bounds.ts): the fumble, a hidden pod, a store of
// charges, an empower arming several strikes, a dot's ratios and renewal.
// The kit that brought them still prices on the same scale: its bill fits
// the Kit envelope (the calibration set leaves it out, tests/forged_twins.ts).

import { describe, expect, it } from 'vitest';
import type { EffectSpec } from '../src/sim/combat/effects';
import { CHAMPIONS } from '../src/sim/content/champions';
import { budgetOf } from '../src/sim/forge/budget';
import { burstVerdict } from '../src/sim/forge/burst';
import { KIT_ENVELOPE, kitSpendOf } from '../src/sim/forge/envelopes';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { validateForged } from '../src/sim/forge/validate';
import { FORGED_TWINS, forgedTwin, OUTSIDE_FORGE } from './forged_twins';

function withQ(over: Partial<ForgedChampionDef['abilities']['Q']>): ForgedChampionDef {
  const def = structuredClone(FORGED_TWINS[0]!);
  def.id = 'forged_closed';
  def.abilities.Q = { ...def.abilities.Q, ...over };
  return def;
}

function errorsOf(def: ForgedChampionDef): readonly string[] {
  const v = validateForged(def);
  return v.ok ? [] : v.errors;
}

const bolt = (onHit: EffectSpec[]) =>
  withQ({ spec: { kind: 'skillshot', speed: 22, radius: 0.6, range: 9, onHit } });

describe('the Forge refuses what it does not offer', () => {
  it('refuses Nisk converted to forged shape', () => {
    expect(OUTSIDE_FORGE).toContain('nisk');
    expect(validateForged(forgedTwin(CHAMPIONS.nisk!)).ok).toBe(false);
  });

  it('refuses each new primitive on its own', () => {
    expect(errorsOf(bolt([{ kind: 'fumble', duration: 1 }])).join(' ')).toContain(
      "unknown effect kind 'fumble'",
    );
    const pod = withQ({
      spec: {
        kind: 'trap',
        radius: 1,
        duration: 20,
        armDelay: 1,
        maxLive: 2,
        burst: { radius: 2, duration: 1 },
      },
    });
    expect(errorsOf(pod).join(' ')).toContain("unknown cast kind 'trap'");
    expect(errorsOf(withQ({ charges: { max: 3, every: 10 } })).join(' ')).toContain(
      'charges: not offered',
    );
    const ratio = bolt([{ kind: 'dot', duration: 2, perSecond: 10, adRatio: 0.2, dtype: 'magic' }]);
    expect(errorsOf(ratio).join(' ')).toContain('adRatio: not offered');
    const renewed = bolt([
      { kind: 'dot', duration: 2, perSecond: 10, dtype: 'magic', refresh: true },
    ]);
    expect(errorsOf(renewed).join(' ')).toContain('refresh: not offered');
    const many = bolt([
      {
        kind: 'empower',
        duration: 3,
        bonus: [{ kind: 'damage', base: 10, dtype: 'magic' }],
        hits: 4,
      },
    ]);
    expect(errorsOf(many).join(' ')).toContain('hits: not offered');
  });

  it('still accepts every twin of the calibration set', () => {
    for (const twin of FORGED_TWINS) expect(validateForged(twin).ok, twin.id).toBe(true);
  });
});

describe("Nisk's bill", () => {
  it('fits the Kit envelope and the burst caps the roster is held to', () => {
    const twin = forgedTwin(CHAMPIONS.nisk!);
    expect(kitSpendOf(budgetOf(twin))).toBeLessThanOrEqual(KIT_ENVELOPE);
    expect(burstVerdict(twin).ok).toBe(true);
  });
});
