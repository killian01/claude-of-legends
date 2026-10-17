import { describe, expect, it } from 'vitest';
import { openingShop } from '../src/ui/opening_shop';

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
