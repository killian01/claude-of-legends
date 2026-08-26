// Tier 3 gate: legendary upgrades exist, build from a finished item plus a
// component with the full discount, apply their stats through the one
// recalc, and stay affordable for a real kill lead.

import { describe, expect, it } from 'vitest';
import { effectiveItemCost, ITEM_LIST, ITEMS } from '../src/sim/content/items';
import { Sim } from '../src/sim/sim';
import { recalcChampion } from '../src/sim/stats';

describe('tier 3 items', () => {
  it('every legendary consumes a finished item and discounts it fully', () => {
    const t3 = ITEM_LIST.filter((i) => i.tier === 3);
    expect(t3.length).toBeGreaterThanOrEqual(5);
    for (const item of t3) {
      const comps = item.buildsFrom ?? [];
      expect(comps.length).toBe(2);
      expect(comps.some((id) => ITEMS[id]?.tier === 2)).toBe(true);
      const compCost = comps.reduce((acc, id) => acc + (ITEMS[id]?.cost ?? 0), 0);
      expect(effectiveItemCost(item.id, [...comps])).toBe(item.cost - compCost);
      // A legendary is a strict upgrade in raw price over its finished part.
      expect(item.cost).toBeGreaterThan(Math.max(...comps.map((id) => ITEMS[id]?.cost ?? 0)));
    }
  });

  it('buying a legendary consumes the parts and applies the stat line', () => {
    const sim = new Sim(11);
    const a = sim.addChampion(0);
    a.items = ['warbrand', 'iron_blade'];
    recalcChampion(a);
    const adBefore = a.stats.ad;
    a.gold = 5000;
    expect(sim.buyItem(a.id, 'doombrand')).toBe(true);
    expect(a.items).toEqual(['doombrand']);
    // 95 from Doombrand replaces Warbrand's 56 and Iron Blade's 10.
    expect(a.stats.ad - adBefore).toBe(95 - 56 - 10);
    expect(a.gold).toBe(5000 - (2900 - 1300 - 350));
  });
});
