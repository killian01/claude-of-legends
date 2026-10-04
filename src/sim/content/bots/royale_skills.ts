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
  // Bystanders this close weigh in the odds as much as the target: a
  // strong bot reads the champion beside the fight as a third fighter.
  // Zero for the others (fight.ts BYSTANDER_WEIGHT).
  bystanderFullM: number;
  // How far it hears a Seedfall called, and a Clamor; zero for never.
  seedfallM: number;
  clamorM: number;
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
    bystanderFullM: 0,
    seedfallM: 30,
    clamorM: 0,
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
    bystanderFullM: 0,
    seedfallM: 55,
    clamorM: 30,
  },
  strong: {
    id: 'strong',
    attention: 1,
    aimLead: 1,
    aimError: 0.25,
    // 0.40 sent the strong bots into every fight they met, and they fell
    // first of the three (1:03 on average in One life, 2026-10-03).
    fightOdds: 0.46,
    retreatHp: 0.24,
    // 0.85 sidestepped half its strikes away: strong bots lost most of
    // their fights against normal ones (38% of them, the report,
    // 2026-10-03); at the normal's 0.55 they win most (61%).
    dodge: 0.55,
    chase: 17,
    kite: true,
    duskMargin: 22,
    creatures: true,
    bystanderFullM: 8,
    seedfallM: 55,
    clamorM: 45,
  },
};

// The shares of the seats: gentle, then normal, the rest strong.
export const ROYALE_MIX: Readonly<{ gentle: number; normal: number }> = {
  gentle: 0.5,
  normal: 1 / 3,
};
// With only Guests in the match: a little softer. Seven in ten gentle
// left a field that loots and never fights back.
export const ROYALE_MIX_GUESTS: Readonly<{ gentle: number; normal: number }> = {
  gentle: 0.5,
  normal: 0.35,
};

// The sharpening (bots with intent): a seat plays at least as well as the
// match has shown it to be. A score of SHARPEN_NORMAL_AT takedowns plays
// as normal, SHARPEN_STRONG_AT as strong, and from the Dusk's
// SHARPEN_GENTLE_PHASE a gentle seat plays as normal: by the last closings
// the ones left play like the field's best.
export const SHARPEN_NORMAL_AT = 2;
export const SHARPEN_STRONG_AT = 4;
export const SHARPEN_GENTLE_PHASE = 3;
// One life's calm (the Dusk's phase 0): the odds a fight must show rise by
// this much unless the bot was struck, so the first minute is a loot and
// not a cull. A sharp dial: at 0.10 up to ten fell in the first minute, at
// 0.13 none did and the field met all at once when the calm ended (17 to
// 23 in the second minute); 0.12 gives five to nine, then fewer (the
// report, seeds 1 to 10, 2026-10-04).
export const CALM_NERVE = 0.12;
// One life's pace: the champions still in at each minute from the landing
// that the bots hold to. A bot that is not struck asks PACE_NERVE_PER_SEAT
// more of a fight's odds for every champion fallen ahead of that pace (up
// to PACE_NERVE_MAX; never less than its own nerve, PACE_NERVE_MIN): the
// field's own clock, read off the count everyone sees. With fights that
// end, the field fell to a third by the third minute without it (the
// report, 2026-10-03), and to a sixth by the fifth. The match is measured
// against 50, 44, 36, 27, 19, 12, 7, 4, 2, 1 (scripts/royale_report.ts);
// the bots hold to a curve a few champions over it, because fights already
// under way end whatever the pace says and the field runs two to five
// ahead of the curve it holds to. Held to the measured curve itself, the
// field fell to 33 by the second minute and the match ended before 7:30;
// held 43 at the second minute, the calm's end no longer releases every
// fight at once (the report, seeds 1 to 10, 2026-10-04). Held 44 through
// the second minute, fewer of the calm's fights carry over past it; held
// 3 at the eighth, about half the matches ended before 8:00 and the
// eighth minute counted 1.4 standing against 2, while 4 ran several past
// 8:30; 3.75 counts 1.8 to 2 with the end at 7:40 to 8:45 (median 8:22).
// A sixteenth at the fifth minute keeps the fourth from running three
// under 19 (the report, seeds 1 to 10, tranche 1 round 3).
export const ONE_LIFE_PACE: readonly number[] = [50, 44, 44, 31, 22, 16, 10, 6, 3.75, 1];
export const PACE_NERVE_PER_SEAT = 0.08;
export const PACE_NERVE_MIN = 0;
export const PACE_NERVE_MAX = 0.6;

// The calls (src/sim/royale/bot/calls.ts), data: a bot answers only at
// CALL_HP of its health or more, a Clamor at CLAMOR_HP.
export const CALL_HP = 0.6;
export const CLAMOR_HP = 0.7;
// A Seedfall call sets off only while the walk there at CALL_WALK_SPEED
// takes no longer than the time to its landing plus SEEDFALL_LATE_S: a bot
// that would arrive later lets that race go. Once landed, its cache is a
// goal like any other within the skill's reach. Before the landing a bot
// waits SEEDFALL_STANDOFF_M from the point, out of the impact's reach.
export const CALL_WALK_SPEED = 3.7;
export const SEEDFALL_LATE_S = 5;
export const SEEDFALL_STANDOFF_M = 5.5;
// The ambush: a bot within AMBUSH_REACH_M of a Seedfall it called that
// finds a champion within AMBUSH_SEED_M of the point waits in the nearest
// bush within AMBUSH_REACH_M of it, until the opening starts, the opener
// falls under AMBUSH_STRIKE_HP, or AMBUSH_WAIT_S past the landing.
export const AMBUSH_REACH_M = 12;
export const AMBUSH_SEED_M = 6;
export const AMBUSH_STRIKE_HP = 0.6;
export const AMBUSH_WAIT_S = 10;
// One life's Clamor draws the packs from the Dusk's CLAMOR_PHASE, or once
// CLAMOR_ALIVE or fewer are left.
export const CLAMOR_PHASE = 2;
export const CLAMOR_ALIVE = 25;
// A wander never starts while a cache or a Seedfall stands this close.
export const ROAM_GOAL_M = 80;
