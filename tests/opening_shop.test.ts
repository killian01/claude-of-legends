import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/content/items';
import { closesAfterBuy, OPENING_SHOP_LINE, openingShop } from '../src/ui/opening_shop';

describe('openingShop', () => {
  const top = { time: 0, finished: false, guide: 'play' as const, range: false };

  it('opens the shop at the top of a match', () => {
    expect(openingShop(top)).toBe('open');
    expect(openingShop({ ...top, time: 4.9 })).toBe('open');
  });

  it('keeps it shut in the Range, where it would cover the posts', () => {
    expect(openingShop({ ...top, range: true })).toBe('none');
  });

  it('does nothing past the top of a match', () => {
    expect(openingShop({ ...top, time: 5 })).toBe('late');
    expect(openingShop({ ...top, finished: true })).toBe('late');
    expect(openingShop({ ...top, range: true, time: 30 })).toBe('late');
  });

  it('leaves a coach seat and a replay to themselves', () => {
    expect(openingShop({ ...top, guide: 'coach' })).toBe('late');
    expect(openingShop({ ...top, guide: 'watch', time: 30 })).toBe('late');
  });
});

describe('closesAfterBuy', () => {
  // The cheapest item but a drink: below it, only a drink is left to buy.
  const cheapest = Math.min(
    ...Object.values(ITEMS)
      .filter((d) => !d.drink)
      .map((d) => d.cost),
  );

  it('closes once the first item leaves the gold short of every other', () => {
    // 505 starting gold, a 400g Heart Gem bought: 105 left.
    expect(closesAfterBuy(105, ['heart_gem'])).toBe(true);
    expect(closesAfterBuy(cheapest - 1, ['heart_gem'])).toBe(true);
  });

  it('stays open while the gold still buys an item, a drink first included', () => {
    expect(closesAfterBuy(455, ['sapdraught'])).toBe(false);
    expect(closesAfterBuy(cheapest, ['heart_gem'])).toBe(false);
  });

  it('counts what the bag already holds toward an upgrade', () => {
    // Owning a component makes its upgrade cheaper than its sticker price.
    const upgrade = Object.values(ITEMS).find((d) => (d.buildsFrom?.length ?? 0) > 0);
    expect(upgrade).toBeDefined();
    if (!upgrade?.buildsFrom) return;
    const owned = [...upgrade.buildsFrom];
    const rest = upgrade.cost - owned.reduce((n, id) => n + (ITEMS[id]?.cost ?? 0), 0);
    expect(closesAfterBuy(rest, owned)).toBe(false);
  });

  it('tells the opening shop that the buy is the way in', () => {
    expect(OPENING_SHOP_LINE).toMatch(/closes/);
  });
});
