// The status chips (src/ui/chip_text.ts): a short word that reads at a
// glance, a small sub line with the whole seconds or the number, the whole
// fact in the tooltip. The battle royale's playtest could not read "BO",
// "MA x1" or "AI 0.1".

import { describe, expect, it } from 'vitest';
import type { Status } from '../src/sim/combat/status';
import {
  aspectGlyph,
  boonChipFace,
  favorChipFace,
  statusChip,
  statusWord,
  wrathChipFace,
} from '../src/ui/chip_text';

const T = 100;

describe('status chips', () => {
  it('say what the playtest could not read', () => {
    const boost: Status = { kind: 'buff', until: T + 5.4, msPct: 0, asPct: 0.2, armor: 0, mr: 0 };
    expect(statusChip(boost, T)).toEqual({
      glyph: 'Boost',
      sub: '6s',
      tip: 'Boosted, 6 s left',
    });
    const mark: Status = { kind: 'mark', until: T + 3, stacks: 1, sourceId: 7 };
    expect(statusChip(mark, T)).toEqual({ glyph: 'Mark', sub: '', tip: 'Marked, 3 s left' });
    const lift: Status = { kind: 'airborne', until: T + 0.1 };
    expect(statusChip(lift, T)).toEqual({
      glyph: 'Airborne',
      sub: '1s',
      tip: 'Knocked airborne, 1 s left',
    });
  });

  it('never show a decimal, and count a mark past one', () => {
    const stun: Status = { kind: 'stun', until: T + 1.2 };
    expect(statusChip(stun, T).sub).toBe('2s');
    const marks: Status = { kind: 'mark', until: T + 3, stacks: 3, sourceId: 7 };
    expect(statusChip(marks, T)).toMatchObject({ sub: 'x3', tip: 'Marked 3 times, 3 s left' });
    const slow: Status = { kind: 'slow', until: T + 2, pct: 0.35 };
    expect(statusChip(slow, T)).toEqual({ glyph: 'Slow', sub: '35%', tip: 'Slowed 35%, 2 s left' });
    const shield: Status = { kind: 'shield', until: T + 2, remaining: 119.6 };
    expect(statusChip(shield, T)).toMatchObject({ glyph: 'Shield', sub: '120' });
    for (const s of [stun, marks, slow, shield, lift()]) {
      expect(statusChip(s, T).sub).not.toMatch(/\./);
    }
  });

  it('give every status a word, never two capitals', () => {
    const kinds: Status['kind'][] = [
      'slow',
      'root',
      'recall',
      'stun',
      'airborne',
      'untargetable',
      'taunt',
      'stealth',
      'blind',
      'shield',
      'empower',
      'mark',
      'dot',
      'grievous',
      'buff',
    ];
    for (const kind of kinds) {
      const word = statusWord(kind);
      expect(word, kind).toMatch(/^[A-Z][a-z]{2,}$/);
      expect(word.length, kind).toBeLessThanOrEqual(11);
    }
  });
});

function lift(): Status {
  return { kind: 'airborne', until: T + 0.05 };
}

describe('team chips', () => {
  it('name the Boon, the Wrath and the favors', () => {
    expect(aspectGlyph('might')).toBe('Might');
    expect(aspectGlyph('swiftness')).toBe('Swiftness');
    expect(boonChipFace(8, 41.2, false)).toEqual({
      glyph: 'Boon',
      sub: '42s',
      tip: 'BOON +8% damage, 42s left',
    });
    expect(boonChipFace(16, 3, true).tip).toBe('ENEMY BOON +16% damage, 3s left');
    expect(wrathChipFace('WRATH execute under 20%', 10, true)).toEqual({
      glyph: 'Wrath',
      sub: '10s',
      tip: 'ENEMY WRATH execute under 20%',
    });
    expect(favorChipFace('tide', 1, 'TIDE 2% missing HP every 5s', false)).toEqual({
      glyph: 'Tide',
      sub: '',
      tip: 'TIDE 2% missing HP every 5s',
    });
    expect(favorChipFace('tide', 2, 'TIDE 4%', true)).toMatchObject({
      sub: 'x2',
      tip: 'ENEMY TIDE 4%',
    });
  });
});
