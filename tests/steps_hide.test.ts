import { describe, expect, it } from 'vitest';
import { GROUND_QUIET_S, HIDE_ARM_S, pressHide } from '../src/ui/steps_hide';

describe('the first steps hide button', () => {
  it('hides at once with a mouse', () => {
    expect(pressHide(null, 10, false)).toEqual({ heard: true, hide: true, armed: null });
  });

  it('only asks on the first tap of a touchscreen', () => {
    expect(pressHide(null, 10, true)).toEqual({ heard: true, hide: false, armed: 10 });
  });

  it('hides on a second tap in time', () => {
    const first = pressHide(null, 10, true);
    expect(pressHide(first.armed, 10 + HIDE_ARM_S - 0.1, true)).toEqual({
      heard: true,
      hide: true,
      armed: null,
    });
  });

  it('asks again when the second tap comes too late', () => {
    const first = pressHide(null, 10, true);
    expect(pressHide(first.armed, 10 + HIDE_ARM_S, true)).toEqual({
      heard: true,
      hide: false,
      armed: 10 + HIDE_ARM_S,
    });
  });

  it('does not hear taps in the middle of walking by taps on the ground', () => {
    // A thumb tapping the ground several times a second strays onto the card.
    let armed: number | null = null;
    for (let t = 10; t < 13; t += 0.25) {
      const press = pressHide(armed, t + 0.1, true, t);
      expect(press.heard).toBe(false);
      expect(press.hide).toBe(false);
      armed = press.armed;
    }
    expect(armed).toBeNull();
  });

  it('keeps an ask through a stray tap and hides on a deliberate one', () => {
    const first = pressHide(null, 10, true, 5);
    expect(first.armed).toBe(10);
    const stray = pressHide(first.armed, 10.5, true, 10.2);
    expect(stray).toEqual({ heard: false, hide: false, armed: 10 });
    expect(pressHide(stray.armed, 10.2 + GROUND_QUIET_S, true, 10.2)).toEqual({
      heard: true,
      hide: true,
      armed: null,
    });
  });

  it('a mouse click hides even right after a ground click', () => {
    expect(pressHide(null, 10, false, 9.9).hide).toBe(true);
  });
});
