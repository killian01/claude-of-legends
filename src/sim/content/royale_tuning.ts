// The planet's tuning (CONTEXT.md: Wanderseed; ADR 0031): what each
// champion carries on the planet beyond its 5v5 self, so every pick is a
// threat in a free-for-all. `hp` multiplies the planet's health share
// (ROYALE_HP_SCALE, src/sim/royale/types.ts), `dmg` the champion's damage
// to champions (Unit.dmgScale, read once in src/sim/combat/damage.ts);
// RoyaleMode.seat applies both. A champion missing here plays at 1 and 1.
// Tuned in steps of 0.05 against scripts/royale_duel.ts and the
// takedowns per seat of scripts/royale_report.mjs.
//
// Data, but planet rules only: the 5v5 never reads it, so it stays out of
// the content fingerprint (fingerprint.ts) and a change moves
// ROYALE_RULES_VERSION instead, never REPLAY_VERSION.

export interface PlanetTuning {
  hp: number;
  dmg: number;
}

export const PLANET_TUNING: Readonly<Record<string, PlanetTuning>> = {
  fenn: { hp: 0.9, dmg: 0.82 },
  ashvyn: { hp: 0.95, dmg: 0.9 },
  rhoka: { hp: 0.95, dmg: 0.92 },
  vesk: { hp: 1, dmg: 1 },
  sylra: { hp: 1, dmg: 1 },
  elowen: { hp: 1, dmg: 1 },
  dain: { hp: 1, dmg: 1.05 },
  torv: { hp: 1.15, dmg: 1.25 },
  korrath: { hp: 1.15, dmg: 1.25 },
  maera: { hp: 1.15, dmg: 1.3 },
};

const NEUTRAL: PlanetTuning = { hp: 1, dmg: 1 };

export function planetTuning(championId: string | null): PlanetTuning {
  return (championId !== null ? PLANET_TUNING[championId] : undefined) ?? NEUTRAL;
}
