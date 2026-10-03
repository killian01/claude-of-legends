// Which skill each seat's bot plays (content/bots/royale_skills.ts): the
// mix's counts dealt over the seats and shuffled on the match's stream, so
// the same seed seats the same mix and the strong ones are not always the
// first seats. Softer when the server says only Guests play.

import {
  ROYALE_MIX,
  ROYALE_MIX_GUESTS,
  ROYALE_SKILLS,
  type RoyaleSkill,
  type RoyaleSkillId,
} from '../../content/bots/royale_skills';
import type { Rng } from '../../rng';

export function skillMix(count: number, rng: Rng, guestsOnly = false): RoyaleSkillId[] {
  const mix = guestsOnly ? ROYALE_MIX_GUESTS : ROYALE_MIX;
  const gentle = Math.round(count * mix.gentle);
  const normal = Math.min(count - gentle, Math.round(count * mix.normal));
  const out: RoyaleSkillId[] = [];
  for (let i = 0; i < count; i++) {
    out.push(i < gentle ? 'gentle' : i < gentle + normal ? 'normal' : 'strong');
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

export function skillOf(id: RoyaleSkillId): RoyaleSkill {
  return ROYALE_SKILLS[id];
}
