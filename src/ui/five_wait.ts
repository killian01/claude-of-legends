// A 5v5 fall's wait (CONTEXT.md "First steps"): the wash under
// SLAIN and the pause menu opened over it say when the champion stands at
// its fountain again, and, while the gold reaches the shop's suggested
// item (ui/shop_suggestion.ts), that the wait is the time to buy it: the
// shop takes a fallen champion's order from anywhere (src/sim/sim.ts
// buyItem). Pure: the HUD hands in what it reads (ui/hud.ts).

import type { StepsInput } from './first_steps';

// The wash's subtitle and the pause menu's title row over a fall.
export function fiveBackLine(left: number): string {
  return `Back at your fountain in ${Math.max(0, left).toFixed(1)} s`;
}

export interface FiveWaitView {
  // The seat buys its own items (a coach seat's bot buys for it).
  shops: boolean;
  // The gold reaches the suggested item.
  afford: boolean;
  // The shop is already open.
  shopOpen: boolean;
  // The player hid the first steps' guide.
  guideOff: boolean;
}

// The line under the wait, or null: only while there is something to buy
// and the shop is not already up, and never once the guide is hidden.
export function fiveShopLine(v: FiveWaitView, input: StepsInput): string | null {
  if (!v.shops || !v.afford || v.shopOpen || v.guideOff) return null;
  return input === 'mouse'
    ? 'Shop while you wait: press P, the glowing item suits your champion.'
    : 'Shop while you wait: tap Shop, the glowing item suits your champion.';
}
