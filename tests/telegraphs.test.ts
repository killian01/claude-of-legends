// Counterplay gate: an INSTANT ability (burst, cone, or point-and-click)
// that lands a heavy hit or hard crowd control must carry a windup, so its
// telegraph shows and the victim gets a beat to react. Skillshots and zones
// already telegraph through travel and ground shapes; dashes stay instant
// (mobility is the fun); light pokes and self-buffs are exempt.

import { describe, expect, it } from 'vitest';
import { CHAMPION_LIST } from '../src/sim/content/champions';
import type { AbilityKey } from '../src/sim/types';

const INSTANT_KINDS = new Set(['burst', 'cone', 'enemy_target']);
const HARD_CC = new Set(['stun', 'taunt', 'root', 'knockup', 'pull']);
const HEAVY_BASE_DAMAGE = 60;
const MIN_WINDUP = 0.2;

interface EffectLike {
  kind: string;
  base?: number;
}

function hostileEffects(spec: Record<string, unknown>): EffectLike[] {
  const out: EffectLike[] = [];
  for (const field of ['effects', 'onHit']) {
    const list = spec[field];
    if (Array.isArray(list)) out.push(...(list as EffectLike[]));
  }
  return out;
}

describe('instant abilities telegraph their heavy hits', () => {
  it('every heavy or hard-CC instant ability declares a windup', () => {
    const keys: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
    for (const champion of CHAMPION_LIST) {
      for (const key of keys) {
        const def = champion.abilities[key];
        const spec = def.spec as unknown as Record<string, unknown>;
        if (!INSTANT_KINDS.has(spec.kind as string)) continue;
        const effects = hostileEffects(spec);
        const damage = effects
          .filter((e) => e.kind === 'damage')
          .reduce((acc, e) => acc + (e.base ?? 0), 0);
        const hardCc = effects.some((e) => HARD_CC.has(e.kind));
        if (damage < HEAVY_BASE_DAMAGE && !hardCc) continue;
        expect(
          def.windup ?? 0,
          `${champion.id} ${key} (${def.name}) is an instant ` +
            `${spec.kind} with ${hardCc ? 'hard CC' : `${damage} base damage`} ` +
            'and owes its victims a windup',
        ).toBeGreaterThanOrEqual(MIN_WINDUP);
      }
    }
  });
});
