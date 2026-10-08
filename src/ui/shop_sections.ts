// The shop's sections in the order the window shows them (ui/hud.ts). The
// Drinks follow the components: a Sapdraught costs what a component does
// and is bought at the same moment, leaving the fountain, so it sits where
// the first purchase is made instead of under the legendaries, a scroll
// away. Every item the shop sells is in exactly one section.

import { CONSUMABLE_LIST, DRAUGHT_CARRY, ITEM_LIST, type ItemDef } from '../sim/content/items';

export interface ShopSection {
  title: string;
  items: readonly ItemDef[];
}

export function shopSections(): ShopSection[] {
  return [
    { title: 'Components', items: ITEM_LIST.filter((i) => i.tier === 1) },
    { title: `Drinks, ${DRAUGHT_CARRY} carried at most`, items: CONSUMABLE_LIST },
    {
      title: 'Finished items, built from two components',
      items: ITEM_LIST.filter((i) => i.tier === 2),
    },
    {
      title: 'Legendary upgrades, built from a finished item',
      items: ITEM_LIST.filter((i) => i.tier === 3),
    },
  ];
}
