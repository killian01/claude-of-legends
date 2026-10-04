// The planet's tuning (CONTEXT.md: Wanderseed; ADR 0031): what each
// champion carries on the planet beyond its 5v5 self, so every pick is a
// threat in a free-for-all. `hp` multiplies the planet's health share
// (ROYALE_HP_SCALE, src/sim/royale/types.ts), `dmg` the champion's damage
// to champions (Unit.dmgScale, read once in src/sim/combat/damage.ts);
// RoyaleMode.seat applies both. A champion missing here plays at 1 and 1.
// Tuned in steps of 0.05 against the takedowns per seat of
// scripts/royale_report.mjs (Respawn, house bots, seeds 1 to 10): before
// the table Fenn took 58.2 a seat and Maera 1.9; with it every champion
// falls between 16.5 and 27 (Fenn still first). The tranche 1 tuning
// (2026-10-04, seeds 1 to 5, the duel matrix beside it) took Korrath, Torv
// and Sylra down a step or more, and Vesk, Ashvyn and Elowen up: Respawn
// from Maera's 12.2 to Fenn's 24.2, Korrath's duels from 96% won to 88%.
// Round 2 (seeds 1 to 20 at level 3 and at level 4, four pieces) gave the
// marksmen and Fenn health and took health and damage off the shells:
// every champion wins 36 to 61% of its duels after the calm, and Respawn
// runs from about 13 to 31 takedowns a seat (seeds 1 to 10). Health
// weighs most in a duel and damage in the last hits of a free-for-all,
// which is why the shells carry more damage than health and the marksmen
// the reverse. The stage after the calm is a median the duel script
// measures first, and it falls on level 3 or 4 as the table moves; the
// champions rank differently at each (Dain won 35% of his duels at level
// 3, and 83% at level 4 with 0.1 more damage), so a step is judged at
// both. Round 3 judged a step at four stages (level 3 with 0, 3 and 4
// pieces, level 4 with 4; seeds 1 to 20): Maera won 70 to 74% at level 3
// up to her third piece and gave back a step of health, Ashvyn lost most
// duels at every stage and took half a step. A whole step for Ashvyn (1.4)
// took him from 38% to 56% at four pieces (1.45 with 0.05 more damage, to
// 83%), and he won half the One life matches: his late items carry him. At
// landing, with nothing in the bag, the marksmen still lose most duels
// (Ashvyn 14%, Vesk 28%), and at three pieces the mages do (about 30%:
// two Heart Gems and no damage yet); a single scale cannot hold those
// stages and the ones after, which wait on the builds or the landing kit.
// scripts/royale_duel.ts measures them. The Grafts (tranche 2, seeds 1 to
// 3, then 1 to 6) moved two mages and a marksman: Elowen, whose bots take
// Hunter's Eye and Keen Edge twice, rose from 22.3 to 35.4 a seat and gave
// back two steps (1.5 to 1.4); Sylra fell from 16.5 to 10.9 and took three
// (1.35 to 1.5); Ashvyn, with Chainsap and Bloodsap, rose to 28.6 and gave
// back one (0.7 to 0.65): Respawn back to 13.4 to 24.7 a seat over seeds
// 1 to 6, a spread of 1.84.
//
// Data, but planet rules only: the 5v5 never reads it, so it stays out of
// the content fingerprint (fingerprint.ts) and a change moves
// ROYALE_RULES_VERSION instead, never REPLAY_VERSION.

export interface PlanetTuning {
  hp: number;
  dmg: number;
}

export const PLANET_TUNING: Readonly<Record<string, PlanetTuning>> = {
  fenn: { hp: 1.15, dmg: 0.75 },
  ashvyn: { hp: 1.35, dmg: 0.65 },
  rhoka: { hp: 1, dmg: 0.92 },
  vesk: { hp: 1.3, dmg: 0.95 },
  sylra: { hp: 1, dmg: 1.5 },
  elowen: { hp: 1, dmg: 1.4 },
  dain: { hp: 1.05, dmg: 0.95 },
  torv: { hp: 0.95, dmg: 1.55 },
  korrath: { hp: 0.9, dmg: 1.3 },
  maera: { hp: 1.05, dmg: 1.5 },
};

const NEUTRAL: PlanetTuning = { hp: 1, dmg: 1 };

export function planetTuning(championId: string | null): PlanetTuning {
  return (championId !== null ? PLANET_TUNING[championId] : undefined) ?? NEUTRAL;
}
