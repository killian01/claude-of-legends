import { describe, expect, it } from 'vitest';
import { HIDE_ARM_S, pressHide } from '../src/ui/steps_hide';

describe('the first steps hide button', () => {
  it('hides at once with a mouse', () => {
    expect(pressHide(null, 10, false)).toEqual({ hide: true, armed: null });
  });

  it('only asks on the first tap of a touchscreen', () => {
    expect(pressHide(null, 10, true)).toEqual({ hide: false, armed: 10 });
  });

  it('hides on a second tap in time', () => {
    const first = pressHide(null, 10, true);
    expect(pressHide(first.armed, 10 + HIDE_ARM_S - 0.1, true)).toEqual({
      hide: true,
      armed: null,
    });
  });

  it('asks again when the second tap comes too late', () => {
    const first = pressHide(null, 10, true);
    expect(pressHide(first.armed, 10 + HIDE_ARM_S, true)).toEqual({
      hide: false,
      armed: 10 + HIDE_ARM_S,
    });
  });
});
