import { describe, expect, it } from 'vitest';
import { WALK_HINT_GAP_S, WALK_HINT_TIMES, WalkHint, walkHintLine } from '../src/ui/walk_hint';

describe('the walk hint', () => {
  it('shows on a W A S D press before any click order', () => {
    for (const k of ['w', 'a', 's', 'd']) expect(new WalkHint().key(k, 1)).toBe(true);
  });

  it('never shows for the other keys', () => {
    const hint = new WalkHint();
    for (const k of ['q', 'e', 'r', 'f', 'p', 'g', 'b']) expect(hint.key(k, 1)).toBe(false);
  });

  it('never shows once the player has given a click order', () => {
    const hint = new WalkHint();
    hint.clickOrdered();
    expect(hint.key('w', 1)).toBe(false);
    expect(hint.key('s', 100)).toBe(false);
  });

  it('waits its gap between two hints and stops after its count', () => {
    const hint = new WalkHint();
    expect(hint.key('w', 0)).toBe(true);
    expect(hint.key('a', 1)).toBe(false);
    expect(hint.key('s', WALK_HINT_GAP_S - 0.1)).toBe(false);
    let shown = 1;
    for (let t = WALK_HINT_GAP_S; t < 200; t += WALK_HINT_GAP_S) {
      if (hint.key('d', t)) shown += 1;
    }
    expect(shown).toBe(WALK_HINT_TIMES);
  });

  it('a click order between hints ends them', () => {
    const hint = new WalkHint();
    expect(hint.key('w', 0)).toBe(true);
    hint.clickOrdered();
    expect(hint.key('w', WALK_HINT_GAP_S * 2)).toBe(false);
  });

  it('names the click the player walks with', () => {
    expect(walkHintLine(true)).toMatch(/^Click the ground or hold the arrow keys to walk\./);
    expect(walkHintLine(false)).toMatch(/^Right-click the ground or hold the arrow keys to walk\./);
  });
});
