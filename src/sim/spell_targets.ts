// Structures are not spell targets. A tower or a Sanctum falls to attacks
// and to minions, never to an ability: spells pass over them, skillshots are
// not eaten by them, and targeted spells never lock onto them. Every ability
// delivery filters its victims through this, and applyEffects (combat/
// effects.ts) drops ability payloads on structures as the final backstop.

import type { Unit } from './unit';

export function isSpellTarget(u: Unit): boolean {
  return u.kind !== 'tower' && u.kind !== 'sanctum';
}
