// The planet's tuning (CONTEXT.md: Wanderseed; ADR 0031): what each
// champion carries on the planet beyond its 5v5 self, so every pick is a
// threat in a free-for-all. `hp` multiplies the planet's health share
// (ROYALE_HP_SCALE, src/sim/royale/types.ts), `dmg` the champion's damage
// to champions (Unit.dmgScale, read once in src/sim/combat/damage.ts);
// RoyaleMode.seat applies both. A champion missing here plays at 1 and 1.
// Tuned in steps of 0.05 against the takedowns per seat of
// scripts/royale_report.mjs (Respawn, house bots, seeds 1 to 10): before
// the table Fenn took 58.2 a seat and Maera 1.9; with it every champion
// falls between 16.5 and 27 (Fenn still first). Health weighs most in a
// duel and damage in the last hits of a free-for-all, which is why the
// shells carry more damage than health and the marksmen the reverse;
// scripts/royale_duel.ts measures the duels.
//
// Data, but planet rules only: the 5v5 never reads it, so it stays out of
// the content fingerprint (fingerprint.ts) and a change moves
// ROYALE_RULES_VERSION instead, never REPLAY_VERSION.

export interface PlanetTuning {
  hp: number;
  dmg: number;
}

export const PLANET_TUNING: Readonly<Record<string, PlanetTuning>> = {
  fenn: { hp: 0.9, dmg: 0.75 },
  ashvyn: { hp: 1.05, dmg: 0.65 },
  rhoka: { hp: 0.95, dmg: 0.92 },
  vesk: { hp: 1.1, dmg: 0.8 },
  sylra: { hp: 1, dmg: 1.5 },
  elowen: { hp: 1, dmg: 1.35 },
  dain: { hp: 1, dmg: 0.95 },
  torv: { hp: 1.05, dmg: 1.8 },
  korrath: { hp: 1.05, dmg: 1.65 },
  maera: { hp: 1.2, dmg: 1.4 },
};

const NEUTRAL: PlanetTuning = { hp: 1, dmg: 1 };

export function planetTuning(championId: string | null): PlanetTuning {
  return (championId !== null ? PLANET_TUNING[championId] : undefined) ?? NEUTRAL;
}
