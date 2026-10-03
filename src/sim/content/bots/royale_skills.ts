// The battle royale bot's skill mix (ADR 0031, docs/plan-royale.md),
// data-as-code: three levels of the same brain (src/sim/royale/bot/),
// told apart by parameters only, and the share of the seats each takes.
// About half gentle, a third normal, the rest strong; softer when only
// Guests play. The brain is in src/sim/content/bots/royale.ts.

export type RoyaleSkillId = 'gentle' | 'normal' | 'strong';

export interface RoyaleSkill {
  id: RoyaleSkillId;
  // Each decision slot, the chance the bot takes in an enemy in sight that
  // has not hit it lately: a slower eye, not a blinder one.
  attention: number;
  // The share of the target's motion a skillshot leads by (1 aims where it
  // will be, 0 where it stands).
  aimLead: number;
  // Meters of scatter on every aim point.
  aimError: number;
  // The odds (the bot's share of the strength in reach, 0.5 even) a fight
  // must show before the bot starts it: every skill takes an even duel (a
  // playtest, 2026-10-03: gentle bots that only answered one stood beside
  // each other), a stronger one a worse fight too.
  fightOdds: number;
  // Below this share of its health the bot backs off.
  retreatHp: number;
  // The chance it sidesteps a bolt coming at it.
  dodge: number;
  // How far it follows a target.
  chase: number;
  // Steps back between strikes when its reach allows (a ranged kit).
  kite: boolean;
  // Seconds of margin it keeps ahead of the Dusk's next cap.
  duskMargin: number;
  // Takes on the big creatures once strong enough.
  creatures: boolean;
}

export const ROYALE_SKILLS: Readonly<Record<RoyaleSkillId, RoyaleSkill>> = {
  gentle: {
    id: 'gentle',
    attention: 0.45,
    aimLead: 0.25,
    aimError: 1.8,
    fightOdds: 0.5,
    retreatHp: 0.45,
    dodge: 0.2,
    chase: 9,
    kite: false,
    duskMargin: 8,
    creatures: false,
  },
  normal: {
    id: 'normal',
    attention: 0.8,
    aimLead: 0.7,
    aimError: 0.8,
    fightOdds: 0.45,
    retreatHp: 0.32,
    dodge: 0.55,
    chase: 13,
    kite: true,
    duskMargin: 14,
    creatures: false,
  },
  strong: {
    id: 'strong',
    attention: 1,
    aimLead: 1,
    aimError: 0.25,
    fightOdds: 0.4,
    retreatHp: 0.24,
    dodge: 0.85,
    chase: 17,
    kite: true,
    duskMargin: 22,
    creatures: true,
  },
};

// The shares of the seats: gentle, then normal, the rest strong.
export const ROYALE_MIX: Readonly<{ gentle: number; normal: number }> = {
  gentle: 0.5,
  normal: 1 / 3,
};
// With only Guests in the match: softer.
export const ROYALE_MIX_GUESTS: Readonly<{ gentle: number; normal: number }> = {
  gentle: 0.7,
  normal: 0.25,
};
