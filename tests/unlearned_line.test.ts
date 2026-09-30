// The line under a spell pressed before it was learned
// (src/ui/unlearned_line.ts): keyboard words for a mouse, finger words for
// a touchscreen.

import { describe, expect, it } from 'vitest';
import { ULT_RANK_LEVELS } from '../src/sim/stats';
import { unlearnedLine } from '../src/ui/unlearned_line';

describe('the unlearned spell line', () => {
  it('tells a mouse the key and the click', () => {
    expect(unlearnedLine('Thorn Bolt', 'Q', 1, false)).toBe(
      'Thorn Bolt needs a skill point: Alt+Q or click the +.',
    );
  });

  it('tells a finger to tap the gold +, with no key in it', () => {
    const line = unlearnedLine('Thorn Bolt', 'Q', 1, true);
    expect(line).toBe('Thorn Bolt needs a skill point. Tap the gold + to learn it.');
    expect(line).not.toContain('Alt');
    expect(line).not.toContain('click');
  });

  it('says when the ultimate unlocks, on either', () => {
    const at = ULT_RANK_LEVELS[0]!;
    for (const touch of [false, true]) {
      expect(unlearnedLine('Last Word', 'R', at - 1, touch)).toBe(
        `Last Word unlocks at level ${at}.`,
      );
    }
    expect(unlearnedLine('Last Word', 'R', at, true)).toContain('Tap the gold +');
  });
});
