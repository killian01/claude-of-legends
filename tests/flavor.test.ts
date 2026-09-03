// The flavor line (CONTEXT.md): one authored sentence per spell and for
// the passive, validated with the card texts, shown above the derived
// mechanics text, escaped like every authored string, and carried by the
// resolved passive.

import { describe, expect, it } from 'vitest';
import { FLAVOR_MAX } from '../src/sim/forge/bounds';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { resolveForgedChampion } from '../src/sim/forge/resolve';
import { validateForged } from '../src/sim/forge/validate';
import { describeAbility } from '../src/ui/describe';
import { FORGED_TWINS } from './forged_twins';

function twin(): ForgedChampionDef {
  return structuredClone({ ...FORGED_TWINS[0]!, id: 'forged_f', creator: 'alice' });
}

describe('the flavor line', () => {
  it('validates when short and textual, and is refused otherwise', () => {
    const def = twin();
    def.abilities.Q.flavor = 'A shard of frozen night streaks from her palm.';
    def.passive.flavor = 'The cold remembers every wound.';
    expect(validateForged(def).ok).toBe(true);
    def.abilities.Q.flavor = 'x'.repeat(FLAVOR_MAX + 1);
    const long = validateForged(def);
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors.join(' ')).toContain('abilities.Q.flavor');
    def.abilities.Q.flavor = undefined;
    (def.passive as { flavor?: unknown }).flavor = 42;
    const wrong = validateForged(def);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.errors.join(' ')).toContain('passive.flavor');
  });

  it('shows above the derived text, escaped, and the roster reads as before', () => {
    const def = twin();
    const before = describeAbility('Q', def.abilities.Q);
    def.abilities.Q.flavor = 'Night <falls> & "shatters"';
    def.abilities.Q.name = 'Sh<ard';
    const lines = describeAbility('Q', def.abilities.Q);
    expect(lines[0]).toBe('Sh&lt;ard (Q)');
    expect(lines[1]).toContain('tt-flavor');
    expect(lines[1]).toContain('Night &lt;falls&gt; &amp; &quot;shatters&quot;');
    expect(lines[1]).not.toContain('<falls>');
    expect(lines.slice(2)).toEqual(before.slice(1));
  });

  it('rides the resolved passive ahead of what the template does', () => {
    const def = twin();
    const plain = resolveForgedChampion(def).passive.description;
    def.passive.flavor = 'The cold remembers.';
    const withFlavor = resolveForgedChampion(def).passive.description;
    expect(withFlavor).toBe(`The cold remembers. ${plain}`);
  });
});
