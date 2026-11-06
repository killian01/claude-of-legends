// The spells' call in a first fight (ui/spell_call.ts): the ready spells
// glow while a hit was taken lately, until the first cast of the match.

import { describe, expect, it } from 'vitest';
import { SPELL_CALL_S, SpellCall } from '../src/ui/spell_call';

describe('the spells glow in a first fight', () => {
  it('calls a ready spell only while a hit is fresh', () => {
    const c = new SpellCall();
    c.step('Q', false);
    expect(c.calls(null, true)).toBe(false);
    expect(c.calls(0, true)).toBe(true);
    expect(c.calls(SPELL_CALL_S - 0.1, true)).toBe(true);
    expect(c.calls(SPELL_CALL_S, false)).toBe(false);
    expect(c.calls(SPELL_CALL_S, true)).toBe(false);
  });

  it('never calls a spell that is not ready', () => {
    const c = new SpellCall();
    expect(c.calls(1, false)).toBe(false);
  });

  it('stops for good at the first cast seen', () => {
    const c = new SpellCall();
    c.step('W', false);
    c.step('W', false);
    expect(c.done).toBe(false);
    c.step('W', true);
    expect(c.done).toBe(true);
    c.step('W', false);
    expect(c.calls(1, true)).toBe(false);
  });

  it('does not count a cooldown the seat came with as a cast', () => {
    const c = new SpellCall();
    c.step('E', true);
    c.step('E', true);
    c.step('E', false);
    expect(c.done).toBe(false);
    expect(c.calls(1, true)).toBe(true);
  });
});
