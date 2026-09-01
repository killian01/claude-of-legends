// The icon prompt's mechanics phrase: derived from the spec itself,
// delivery first, at most three effect motifs, imagery words not rules.

import { describe, expect, it } from 'vitest';
import { iconPhrase } from '../server/icon_phrase';
import type { AbilityDef } from '../src/sim/combat/casting';

function ability(spec: AbilityDef['spec']): AbilityDef {
  return { name: 'X', manaCost: 10, cooldown: 8, castRange: 6, spec } as AbilityDef;
}

describe('iconPhrase', () => {
  it('reads the delivery and the effects', () => {
    expect(
      iconPhrase(
        ability({
          kind: 'skillshot',
          speed: 20,
          radius: 0.8,
          range: 8,
          onHit: [
            { kind: 'damage', base: 60, dtype: 'magic' },
            { kind: 'slow', pct: 0.3, duration: 1.5 },
          ],
        }),
      ),
    ).toBe('a flying projectile that brings magic damage and a chilling slow');
  });

  it('caps at three motifs and keeps the priority order', () => {
    const phrase = iconPhrase(
      ability({
        kind: 'burst',
        radius: 3,
        effects: [
          { kind: 'slow', pct: 0.3, duration: 1 },
          { kind: 'stun', duration: 0.5 },
          { kind: 'damage', base: 40, dtype: 'physical' },
          { kind: 'heal', base: 30 },
        ],
      }),
    );
    expect(phrase).toBe(
      'a blast around the caster that brings physical damage, healing and a stun',
    );
  });

  it('speaks for effectless deliveries too', () => {
    expect(iconPhrase(ability({ kind: 'wall', length: 4, duration: 3 }))).toBe(
      'a conjured wall that blocks the path',
    );
    expect(iconPhrase(ability({ kind: 'dash', range: 5 }))).toBe('a swift dash');
  });
});
