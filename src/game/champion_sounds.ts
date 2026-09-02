// Which sound a champion's cast and basic attack play (sfx.ts). A forged
// creator picks from the palette (src/sim/content/sounds.ts) and the
// picks ride the definition; without one, a cast sounds like its school
// (derived from what the spell does, render/ability_vfx.ts) and an
// attack like a whip of air, or a rifle when the model carries a muzzle.

import { schoolTagOf } from '../render/ability_vfx';
import type { AbilityDef } from '../sim/combat/casting';
import type { AttackSoundId } from '../sim/content/sounds';

export function castSoundOf(ability: AbilityDef): string {
  return ability.sound ?? schoolTagOf(ability.spec);
}

export function attackSoundOf(
  def: { attackSound?: AttackSoundId } | null | undefined,
  firearm: boolean,
): AttackSoundId {
  return def?.attackSound ?? (firearm ? 'gunshot' : 'swing');
}
