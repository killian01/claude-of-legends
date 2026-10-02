// The battle royale bot (ADR 0031): the house bot of the Wanderseed, one
// brain (src/sim/royale/bot/) at three skills (royale_skills.ts). Scoped to
// the mode: it is not in the 5v5's bot table (index.ts), whose content
// the 5v5 replays are fingerprinted by. A Policy like every bot, bound to
// the planet it plays (what any player knows of the map), under the same
// decision budget and the same sight as a person.

import type { Policy } from '../../policy';
import { decide } from '../../royale/bot/brain';
import type { RoyaleLayout } from '../../royale/layout';
import { ROYALE_SKILLS, type RoyaleSkillId } from './royale_skills';

export const ROYALE_BOT_ID = 'royale';

export function royalePolicy(layout: RoyaleLayout, skill: RoyaleSkillId): Policy {
  const s = ROYALE_SKILLS[skill];
  return (obs, rng) => decide(obs, rng, layout, s);
}

export const ROYALE_BOT_CONTENT = {
  id: ROYALE_BOT_ID,
  skills: ROYALE_SKILLS,
};
