// The line under a spell pressed before it was learned
// (src/ui/unlearned_line.ts): keyboard words for a mouse, finger words for
// a touchscreen, and the next level when there is no point to spend.

import { describe, expect, it } from 'vitest';
import { ULT_RANK_LEVELS } from '../src/sim/stats';
import { unlearnedLine } from '../src/ui/unlearned_line';

describe('the unlearned spell line', () => {
  it('tells a mouse the key and the click', () => {
    expect(unlearnedLine('Thorn Bolt', 'Q', 1, false, 1)).toBe(
      'Thorn Bolt needs a skill point: Alt+Q or click the +.',
    );
  });

  it('tells a finger to tap the gold +, with no key in it', () => {
    const line = unlearnedLine('Thorn Bolt', 'Q', 1, true, 1);
    expect(line).toBe('Thorn Bolt needs a skill point. Tap the gold + to learn it.');
    expect(line).not.toContain('Alt');
    expect(line).not.toContain('click');
  });

  it('points at the next level, not at a + that is not there, once the points are spent', () => {
    for (const touch of [false, true]) {
      const line = unlearnedLine('Wildgrowth', 'W', 1, touch, 0);
      expect(line).toBe('Wildgrowth needs a skill point. The next level brings one.');
      expect(line).not.toContain('+');
    }
  });

  it('says when the ultimate unlocks, on either', () => {
    const at = ULT_RANK_LEVELS[0]!;
    for (const touch of [false, true]) {
      for (const points of [0, 1]) {
        expect(unlearnedLine('Last Word', 'R', at - 1, touch, points)).toBe(
          `Last Word unlocks at level ${at}.`,
        );
      }
    }
    expect(unlearnedLine('Last Word', 'R', at, true, 1)).toContain('Tap the gold +');
  });
});
