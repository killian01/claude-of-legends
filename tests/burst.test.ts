// The burst cap (ADR 0015): what one cast deals to a single target at
// rank 1, against the reference target. The arithmetic pinned effect by
// effect, the window on ticked damage, what is left out and why, and
// the caps against the roster (the roster is the proof the caps fit).

import { describe, expect, it } from 'vitest';
import type { AbilityDef } from '../src/sim/combat/casting';
import {
  BASICS_BURST_CAP,
  BURST_CAPS,
  BURST_REF,
  burstCapOf,
  burstErrors,
  burstOf,
  burstOfAbility,
  burstOfSpec,
  burstVerdict,
} from '../src/sim/forge/burst';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { freshDraftDef } from '../src/sim/forge/fresh_draft';
import { validateForged } from '../src/sim/forge/validate';
import { FORGED_TWINS } from './forged_twins';

const HIT = { kind: 'damage', base: 100, adRatio: 0.5, apRatio: 1, dtype: 'physical' } as const;

function bolt(spec: AbilityDef['spec']): AbilityDef {
  return { name: 'Probe', manaCost: 40, cooldown: 8, castRange: 8, spec };
}

describe('the measure', () => {
  it('reads a damage effect at the attack rail, no AP, health fraction of the reference', () => {
    expect(burstOfSpec({ kind: 'burst', radius: 2, effects: [HIT] })).toBe(
      100 + 0.5 * BURST_REF.ad + 1 * BURST_REF.ap,
    );
    expect(
      burstOfSpec({
        kind: 'burst',
        radius: 2,
        effects: [{ kind: 'damage', base: 0, maxHpPct: 0.1, dtype: 'magic' }],
      }),
    ).toBeCloseTo(0.1 * BURST_REF.hp, 6);
  });

  it('counts ticked damage inside the window only, ticks landing one interval in', () => {
    const dot = burstOfSpec({
      kind: 'burst',
      radius: 2,
      effects: [{ kind: 'dot', perSecond: 10, duration: 4, dtype: 'magic' }],
    });
    expect(dot).toBe(10 * BURST_REF.tickWindow);
    // A 3 second zone ticking every half second: 4 ticks in 2 seconds,
    // not 6; a short zone keeps its own tick count.
    const zone = (duration: number): number =>
      burstOfSpec({
        kind: 'zone',
        radius: 2,
        duration,
        tickEvery: 0.5,
        onTick: [{ kind: 'damage', base: 10, dtype: 'magic' }],
      });
    expect(zone(3)).toBe(40);
    expect(zone(1)).toBe(20);
  });

  it('sums every list one target can be in, and leaves the chain to another enemy', () => {
    const spec: AbilityDef['spec'] = {
      kind: 'skillshot',
      speed: 20,
      radius: 0.8,
      range: 8,
      onHit: [HIT],
      chain: { radius: 3, onHit: [HIT] },
      aftershock: { delay: 1, radius: 1, spacing: 2, effects: [HIT] },
    };
    expect(burstOfSpec(spec)).toBe(2 * (100 + 0.5 * BURST_REF.ad));
    const dash: AbilityDef['spec'] = {
      kind: 'dash',
      range: 4,
      speed: 16,
      onLand: [HIT],
      passThrough: [HIT],
    };
    expect(burstOfSpec(dash)).toBe(2 * (100 + 0.5 * BURST_REF.ad));
  });

  it('takes the stronger conditional branch, a mark trigger whole, and no heal or control', () => {
    const spec: AbilityDef['spec'] = {
      kind: 'burst',
      radius: 2,
      effects: [
        {
          kind: 'conditional',
          when: { kind: 'targetIsChampion' },
          effects: [HIT],
          otherwise: [{ kind: 'damage', base: 10, dtype: 'magic' }],
        },
        { kind: 'mark', duration: 3, stacksToTrigger: 3, onTrigger: [HIT] },
        { kind: 'heal', base: 500 },
        { kind: 'stun', duration: 1.5 },
        { kind: 'shield', base: 300, duration: 2 },
      ],
    };
    expect(burstOfSpec(spec)).toBe(2 * (100 + 0.5 * BURST_REF.ad));
  });

  it('measures a spell at its hardest rank override', () => {
    const ability: AbilityDef = {
      ...bolt({ kind: 'burst', radius: 2, effects: [HIT] }),
      atRank: [
        {
          rank: 3,
          spec: {
            kind: 'burst',
            radius: 2,
            effects: [{ kind: 'damage', base: 300, dtype: 'magic' }],
          },
        },
      ],
    };
    expect(burstOfAbility(ability)).toBe(300);
  });
});

describe('the caps', () => {
  it('sit just above the roster measured the same way', () => {
    let basic = 0;
    let ult = 0;
    let basics = 0;
    for (const twin of FORGED_TWINS) {
      const v = burstVerdict(twin);
      expect(v.ok, twin.id).toBe(true);
      const r = burstOf(twin);
      basic = Math.max(basic, r.abilities.Q, r.abilities.W, r.abilities.E);
      ult = Math.max(ult, r.abilities.R);
      basics = Math.max(basics, r.basics);
    }
    // The roster is the calibration set: the burstiest roster spell sits
    // within a tenth of its cap, so the cap says "no more than shipped".
    expect(basic).toBeGreaterThan(0.9 * burstCapOf('Q'));
    expect(ult).toBeGreaterThan(0.9 * burstCapOf('R'));
    expect(basics).toBeGreaterThan(0.9 * BASICS_BURST_CAP);
    expect(BURST_CAPS.basic).toBeLessThan(BURST_CAPS.ult);
  });

  it('reject a level-1 nuke the budget was happy to sell', () => {
    const def = freshDraftDef('forged_nuke');
    def.abilities.Q = bolt({
      kind: 'skillshot',
      speed: 22,
      radius: 0.7,
      range: 9,
      onHit: [{ kind: 'damage', base: 320, adRatio: 2.2, dtype: 'physical' }],
    });
    def.abilities.Q.cooldown = 20;
    def.abilities.Q.manaCost = 120;
    const v = validateForged(def);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.some((e) => e.startsWith('burst cap: Q'))).toBe(true);
    expect(v.errors.some((e) => e.startsWith('power budget:'))).toBe(false);
  });

  it('reject three spells that each pass alone but kill together', () => {
    const def = freshDraftDef('forged_combo');
    // Each basic at nine tenths of its own cap: fine alone, 270 percent
    // of the basics cap together.
    const each = 0.9 * burstCapOf('Q');
    const strike = (): AbilityDef =>
      bolt({ kind: 'burst', radius: 2, effects: [{ kind: 'damage', base: each, dtype: 'magic' }] });
    def.abilities.Q = strike();
    def.abilities.W = strike();
    def.abilities.E = strike();
    const errors = burstErrors(def);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Q, W and E together');
    const v = burstVerdict(def);
    expect(v.abilities.Q && v.abilities.W && v.abilities.E).toBe(true);
    expect(v.basics).toBe(false);
  });

  it('give the ultimate more room than a basic, and name the cap in the error', () => {
    const def: ForgedChampionDef = freshDraftDef('forged_ult');
    const big = bolt({
      kind: 'burst',
      radius: 2,
      effects: [{ kind: 'damage', base: burstCapOf('R') - 1, dtype: 'magic' }],
    });
    def.abilities.R = { ...big, cooldown: 60 };
    expect(burstVerdict(def).abilities.R).toBe(true);
    def.abilities.Q = big;
    const errors = burstErrors(def);
    expect(errors.some((e) => e.startsWith('burst cap: Q') && e.includes('a basic spell'))).toBe(
      true,
    );
  });
});
