// The Range's Strikeposts (CONTEXT.md: Range, Strikepost;
// docs/plan-practice-range.md), data-as-code: the standing targets a
// champion's kit is felt out on. A post never moves, never strikes back
// and never falls; it fills again once left alone. One stands bare, one
// plated, so a kit's damage reads against no resistance and against a
// tank's. The sim reads this table (src/sim/strikeposts.ts).

export type StrikepostKind = 'bare' | 'plated';

export interface StrikepostDef {
  id: StrikepostKind;
  name: string;
  hp: number;
  armor: number;
  mr: number;
  radius: number;
}

export const STRIKEPOSTS: Record<StrikepostKind, StrikepostDef> = {
  bare: { id: 'bare', name: 'Bare Strikepost', hp: 5000, armor: 0, mr: 0, radius: 0.7 },
  plated: { id: 'plated', name: 'Plated Strikepost', hp: 5000, armor: 80, mr: 80, radius: 0.8 },
};

// In the order they stand, left to right as seen from the Sanctum.
export const STRIKEPOST_ORDER: readonly StrikepostKind[] = ['bare', 'plated'];

// Seconds without a hit before a post fills again and stands back on its
// spot, its statuses cleared.
export const STRIKEPOST_CALM_S = 4;
// How far from the team's Sanctum toward the map's middle the posts stand,
// and how far apart: on the Star Orchard, open ground inside the base, past
// the Sanctum's two towers (closer, the camera saw one post behind a tower)
// and short of the mid lane's last tower.
export const STRIKEPOST_REACH_M = 14;
export const STRIKEPOST_GAP_M = 6;
