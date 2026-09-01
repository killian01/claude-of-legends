// A short plain-words mechanics phrase for an ability, derived from its
// spec the same way tooltips are (the tooltip rule: text from the data
// itself, never hand-kept). It rides the icon generation prompt so the
// image matches what the spell DOES without the creator typing anything:
// the ability name alone told the image model nothing (playtest ask).
// Deliberately compact and imagery-first: an icon needs one readable
// motif, not a rules card.

import type { AbilityDef, CastSpec } from '../src/sim/combat/casting';
import type { EffectSpec } from '../src/sim/combat/effects';

const DELIVERY: Record<CastSpec['kind'], string> = {
  skillshot: 'a flying projectile',
  zone: 'a lingering ground area',
  self_or_ally: 'a protective cast',
  enemy_target: 'a direct strike at one enemy',
  cone: 'a sweeping cone blast',
  burst: 'a blast around the caster',
  dash: 'a swift dash',
  wall: 'a conjured wall that blocks the path',
};

// The effect kinds worth drawing, in the order they should be mentioned;
// at most three make the phrase.
const EFFECT_WORDS: readonly { kind: EffectSpec['kind']; word: string }[] = [
  { kind: 'damage', word: 'damage' },
  { kind: 'dot', word: 'lingering damage over time' },
  { kind: 'heal', word: 'healing' },
  { kind: 'shield', word: 'a shield' },
  { kind: 'stun', word: 'a stun' },
  { kind: 'root', word: 'rooting in place' },
  { kind: 'knockup', word: 'a launch into the air' },
  { kind: 'knockback', word: 'a shove backward' },
  { kind: 'pull', word: 'a pull inward' },
  { kind: 'taunt', word: 'a taunt' },
  { kind: 'slow', word: 'a chilling slow' },
  { kind: 'blind', word: 'blinding' },
  { kind: 'stealth', word: 'vanishing from sight' },
  { kind: 'untargetable', word: 'untouchability' },
  { kind: 'grievous', word: 'wound-deepening' },
  { kind: 'buff', word: 'empowerment' },
  { kind: 'mark', word: 'a mark that detonates' },
  { kind: 'empower', word: 'an empowered next blow' },
];

// The top-level effect lists a cast delivers; nested triggers stay out,
// one motif is enough.
function effectLists(spec: CastSpec): readonly (readonly EffectSpec[] | undefined)[] {
  switch (spec.kind) {
    case 'skillshot':
      return [spec.onHit, spec.allyEffects];
    case 'zone':
      return [spec.onEnter, spec.onTick, spec.onDetonate, spec.allyOnTick];
    case 'self_or_ally':
      return [spec.effects];
    case 'enemy_target':
      return [spec.effects, spec.selfEffects];
    case 'cone':
      return [spec.onHit];
    case 'burst':
      return [spec.effects, spec.selfEffects];
    case 'dash':
      return [spec.onLand, spec.selfEffects, spec.passThrough];
    case 'wall':
      return [];
  }
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// "a flying projectile that deals magic damage and a chilling slow".
export function iconPhrase(def: AbilityDef): string {
  const spec = def.spec;
  const kinds = new Set<string>();
  const dtypes = new Set<string>();
  for (const list of effectLists(spec)) {
    for (const e of list ?? []) {
      kinds.add(e.kind);
      if (e.kind === 'damage') dtypes.add(e.dtype);
    }
  }
  const words: string[] = [];
  for (const { kind, word } of EFFECT_WORDS) {
    if (!kinds.has(kind)) continue;
    if (kind === 'damage') {
      const flavored = dtypes.has('magic') ? 'magic damage' : 'physical damage';
      words.push(flavored);
    } else {
      words.push(word);
    }
    if (words.length === 3) break;
  }
  const delivery = DELIVERY[spec.kind];
  return words.length === 0 ? delivery : `${delivery} that brings ${joinAnd(words)}`;
}
