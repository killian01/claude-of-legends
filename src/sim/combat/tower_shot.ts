// Tower shots at champions (the dive punish). A tower's flat damage stops
// mattering the moment the diver stacks health, so the shot carries two
// ramping parts, both keyed on the tower's heat (consecutive shots at the
// same champion, reset by tower_ai on every target change):
//
//   - the attack damage itself ramps,
//   - and a slice of the victim's MAX HEALTH, as true damage, ramps with it.
//
// The health slice is what makes a tower dangerous to a tank: no armor stack
// and no shield ratio outruns a percentage. Minions never see either part.

export const TOWER_RAMP_PER_HIT = 0.35;
export const TOWER_RAMP_CAP = 4;

// Shot one takes 3 percent of max health, shot five (heat capped) takes 11.
export const TOWER_HP_PCT_BASE = 0.03;
export const TOWER_HP_PCT_PER_HIT = 0.02;

export function towerHeat(stacks: number): number {
  return Math.min(Math.max(0, stacks), TOWER_RAMP_CAP);
}

export function towerShotAd(baseAd: number, stacks: number): number {
  return baseAd * (1 + TOWER_RAMP_PER_HIT * towerHeat(stacks));
}

export function towerShotHpPct(stacks: number): number {
  return TOWER_HP_PCT_BASE + TOWER_HP_PCT_PER_HIT * towerHeat(stacks);
}
