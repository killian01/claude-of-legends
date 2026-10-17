import { seatShops } from './coach_bar';
import type { GuideMode } from './lane_guide';

// What the top of a match does about the shop, decided without the DOM:
// 'open' the shop opens itself over the base; 'none' it stays shut but the
// start of the match still runs (the feedback line); 'late' this is not the
// top of a live match (a rejoin, a replay), so neither happens.
export type OpeningShop = 'open' | 'none' | 'late';

export function openingShop(at: {
  time: number;
  finished: boolean;
  guide: GuideMode;
  // The Range (CONTEXT.md): the Strikeposts stand in front of the base,
  // where the shop would cover them; the shop stays one press away.
  range: boolean;
}): OpeningShop {
  if (at.time >= 5 || at.finished) return 'late';
  // A coach seat's bot buys its own kit (coach_bar.ts seatShops).
  if (!seatShops(at.guide)) return 'late';
  return at.range ? 'none' : 'open';
}
