// The battle royale bot's Graft pick (CONTEXT.md: Graft): a policy rule
// over the seat's own open offer, the same three cards and deadline a
// person sees. Each card scores GRAFT_ROLE_SCORE when its role tag matches
// the champion's role (the card's weight in the draw, content/grafts.ts),
// Second Breath one more while the champion is under half its health, and
// Thornhide one more for a champion of the shell; ties go to the lowest
// card. Taken at the bot's first decision with the offer open, dead or
// alive, flying or dropping.

import { GRAFTS, graftRoleOf } from '../../content/grafts';
import type { Action, Observation } from '../../policy';

export const GRAFT_ROLE_SCORE = 3;
export const SECOND_BREATH_HURT = 0.5;

// The card a bot takes from its open offer, or null with none open.
export function graftPick(obs: Observation): Action | null {
  const offer = obs.royale?.offer;
  if (!offer) return null;
  const role = graftRoleOf(obs.self.championId ?? null);
  const hurt = obs.self.maxHp > 0 && obs.self.hp / obs.self.maxHp < SECOND_BREATH_HURT;
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < offer.cards.length; i++) {
    const id = offer.cards[i]!;
    const def = GRAFTS[id];
    let score = def?.roles.includes(role) ? GRAFT_ROLE_SCORE : 0;
    if (id === 'second_breath' && hurt) score += 1;
    if (id === 'thornhide' && role === 'shell') score += 1;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return { kind: 'graft', pick: best as 0 | 1 | 2 };
}
