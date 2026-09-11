// The status chips as icons (src/ui/chip_text.ts): a two-letter glyph, a
// small sub line with the number, the whole fact in the tooltip.

import { describe, expect, it } from 'vitest';
import {
  aspectGlyph,
  boonChipFace,
  favorChipFace,
  statusChipFace,
  wrathChipFace,
} from '../src/ui/chip_text';

describe('chip faces', () => {
  it('reads a status label into a glyph and its number', () => {
    expect(statusChipFace('STUN 1.2')).toEqual({ glyph: 'ST', sub: '1.2', tip: 'STUN 1.2' });
    expect(statusChipFace('SLOW 35%')).toEqual({ glyph: 'SL', sub: '35%', tip: 'SLOW 35%' });
    expect(statusChipFace('MARK x2')).toEqual({ glyph: 'MA', sub: 'x2', tip: 'MARK x2' });
    expect(statusChipFace('BURNING')).toEqual({ glyph: 'BU', sub: '', tip: 'BURNING' });
  });

  it('gives the team facts their letters, seconds and side', () => {
    expect(aspectGlyph('might')).toBe('MI');
    expect(aspectGlyph('swiftness')).toBe('SW');
    expect(boonChipFace(8, 41.2, false)).toEqual({
      glyph: 'B',
      sub: '42s',
      tip: 'BOON +8% damage, 42s left',
    });
    expect(boonChipFace(16, 3, true).tip).toBe('ENEMY BOON +16% damage, 3s left');
    expect(wrathChipFace('WRATH execute under 20%', 10, true)).toEqual({
      glyph: 'W',
      sub: '10s',
      tip: 'ENEMY WRATH execute under 20%',
    });
    expect(favorChipFace('tide', 1, 'TIDE 2% missing HP every 5s', false)).toEqual({
      glyph: 'TI',
      sub: '',
      tip: 'TIDE 2% missing HP every 5s',
    });
    expect(favorChipFace('tide', 2, 'TIDE 4%', true)).toMatchObject({
      sub: 'x2',
      tip: 'ENEMY TIDE 4%',
    });
  });
});
