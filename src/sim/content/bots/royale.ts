// The battle royale bot (ADR 0031): the house bot of the Wanderseed, one
// brain (src/sim/royale/bot/) at three skills (royale_skills.ts). Scoped to
// the mode: it is not in the 5v5's bot table (index.ts), whose content
// the 5v5 replays are fingerprinted by. A Policy like every bot, bound to
// the planet it plays (what any player knows of the map), under the same
// decision budget and the same sight as a person. A seat keeps its skill
// for the match, so the stand-in that takes a seat a person left plays
// that seat's skill, live and replayed alike.

import type { Policy } from '../../policy';
import { decide } from '../../royale/bot/brain';
import type { RoyaleLayout } from '../../royale/layout';
import type { Sim } from '../../sim';
import { ROYALE_SKILLS, type RoyaleSkillId } from './royale_skills';

export const ROYALE_BOT_ID = 'royale';

export function royalePolicy(layout: RoyaleLayout, skill: RoyaleSkillId): Policy {
  const s = ROYALE_SKILLS[skill];
  return (obs, rng) => decide(obs, rng, layout, s);
}

// The seat's bot in a battle royale sim, at the seat's skill; null outside
// one.
export function royaleBotPolicy(sim: Sim, unitId: number): Policy | null {
  const mode = sim.royaleMode;
  if (!mode) return null;
  return royalePolicy(mode.layout, mode.skillOf(unitId));
}

// Seats the seat's bot: the house seats at the start, a stand-in when a
// person leaves.
export function attachRoyaleBot(sim: Sim, unitId: number): void {
  const policy = royaleBotPolicy(sim, unitId);
  if (policy) sim.attachPolicy(unitId, policy);
}

export const ROYALE_BOT_CONTENT = {
  id: ROYALE_BOT_ID,
  skills: ROYALE_SKILLS,
};
