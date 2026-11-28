import { effectiveItemCost, ITEMS } from '../sim/content/items';
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

// The opening shop closes itself after a buy that leaves the gold short of
// every item but a drink: the first item is in hand and the match waits
// behind the shop. `gold` and `owned` are as they stand after the buy.
export function closesAfterBuy(gold: number, owned: readonly string[]): boolean {
  for (const def of Object.values(ITEMS)) {
    if (def.drink) continue;
    if (effectiveItemCost(def.id, owned) <= gold) return false;
  }
  return true;
}

// What the opening shop's own line says, so the buy reads as the way in.
export const OPENING_SHOP_LINE = 'Buy the glowing item to start: the shop then closes.';
