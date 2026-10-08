import { describe, expect, it } from 'vitest';
import { CONSUMABLE_LIST, ITEM_LIST } from '../src/sim/content/items';
import { shopSections } from '../src/ui/shop_sections';

describe('the shop sections', () => {
  it('shows the drinks right after the components, above the finished items', () => {
    const titles = shopSections().map((s) => s.title);
    expect(titles[0]).toBe('Components');
    expect(titles[1]).toMatch(/^Drinks/);
    expect(shopSections()[1]?.items).toEqual(CONSUMABLE_LIST);
  });

  it('sells every item in exactly one section', () => {
    const ids = shopSections().flatMap((s) => s.items.map((i) => i.id));
    const sold = [...ITEM_LIST, ...CONSUMABLE_LIST].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...sold].sort());
  });

  it('keeps the build tiers in climbing order', () => {
    const tiers = shopSections()
      .flatMap((s) => s.items)
      .filter((i) => !i.drink)
      .map((i) => i.tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });
});
