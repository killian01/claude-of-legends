// The Warden's body (CONTEXT.md: Warden), data-as-code beside the rings'
// creatures: written at the 4:00 mark like theirs and carried to its rise
// by the same growth (rings.ts, bodyGrowth and biteGrowth). Sized for a
// team (docs/plan-rings.md, round two): a duo takes it in a minute and
// leaves bleeding, five in twenty to thirty seconds, a lone champion dies
// first. Its clock and its Boon live with the sim (src/sim/objectives.ts,
// src/sim/team_buffs.ts).

import type { CreatureBody } from './rings';

export const WARDEN_BODY: CreatureBody = {
  hp: 12500,
  ad: 10,
  bitePct: 0.008,
  armor: 50,
  mr: 50,
  attackRange: 2,
  attackSpeed: 0.6,
  moveSpeed: 3.0,
  radius: 1.1,
  xpBounty: 200,
};

// The last-hit bounty the Warden pays on top of the Boon.
export const WARDEN_GOLD_BOUNTY = 150;

export const WARDEN_CONTENT = { body: WARDEN_BODY, goldBounty: WARDEN_GOLD_BOUNTY };
