// What a Thornfray's HUD says over a bout (src/ui/bout_text.ts,
// src/ui/bout_card.ts): the top line's count, the win line, the bushels
// chip, the Final's pill, the end beat, the out wash and the gathering;
// and every registered kind's lines within the room the top line and the
// row under it have, on a phone held sideways and on a desktop, as Chrome
// drew them.

import { describe, expect, it } from 'vitest';
import type { BoutStart, BoutTableRow, SnapRoyale } from '../src/net/royale_wire';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { BOUT_SEATS } from '../src/sim/content/bouts/match';
import type { BoutKind } from '../src/sim/content/bouts/types';
import { boutCardWords } from '../src/ui/bout_card';
import {
  boutClockLeft,
  boutCount,
  boutOutLine,
  boutTopLine,
  boutWinLine,
  bushelsChip,
  bushelsText,
  countText,
  endBeatText,
  finalBadge,
  gatherLine,
  isFinal,
  lastWinner,
  ownStanding,
} from '../src/ui/bout_text';
import { COMPACT_TOP_LINE_HALF_W_PX, TOP_LINE_HALF_W_PX } from '../src/ui/royale_layout';
import { duskLine, duskPill } from '../src/ui/royale_text';

const LASTWICK = BOUT_KINDS.find((k) => k.id === 'lastwick')!;
const STARGLEAN = BOUT_KINDS.find((k) => k.id === 'starglean')!;

const DUSK = {
  p: 0,
  c: [0, 80, 0] as [number, number, number],
  r: 40,
  pe: 30,
  sh: 0 as const,
  b: 0.03,
};

const snap = (over: Partial<SnapRoyale> = {}): SnapRoyale => ({
  v: 'respawn',
  st: 'play',
  de: 10,
  end: 115,
  dusk: DUSK,
  alive: 8,
  people: 1,
  ...over,
});

const row = (seat: number, bushels: number, last = 0, won = 0): BoutTableRow => [
  seat,
  seat + 1,
  `Seat ${seat}`,
  'torv',
  seat === 0 ? 0 : 1,
  bushels,
  last,
  won,
];

const start = (over: Partial<BoutStart> = {}): BoutStart => ({
  b: 2,
  k: ['lastwick', 'starglean', 'lastwick', 'starglean', 'lastwick', 'starglean'],
  s: 0,
  t: [
    row(3, 12, 5, 2),
    row(0, 9, 3, 1),
    row(1, 7),
    row(2, 4),
    row(4, 2),
    row(5, 1),
    row(6, 0),
    row(7, 0),
  ],
  p: 3,
  ...over,
});

describe("a bout's top line", () => {
  it("says the bout's name and number through the Lull", () => {
    const drop = snap({ st: 'drop' });
    expect(boutTopLine(STARGLEAN, 2, drop, 3)).toBe('Starglean · Bout 3 of 6');
    expect(boutTopLine(LASTWICK, 5, drop, 3)).toBe('Lastwick · the Final');
  });

  it('then its name, its clock and its count', () => {
    // Starglean: the seat's gleaned and its place, the clock to 105 s.
    const r = snap({ tf: { c: 7, pl: 2, bc: 9 } });
    expect(boutTopLine(STARGLEAN, 2, r, 10 + 57)).toBe('Starglean · 0:48 · 7 gleaned, 2nd');
    // Lastwick: those still standing, the clock to the light going out
    // (92 s), not to its backstop at 120.
    const l = snap({ v: 'one_life', alive: 5 });
    expect(boutTopLine(LASTWICK, 1, l, 10 + 51)).toBe('Lastwick · 0:41 · 5 left');
    expect(boutClockLeft(LASTWICK, l, 10)).toBe(92);
    expect(boutClockLeft(STARGLEAN, r, 10)).toBe(105);
    expect(boutClockLeft(STARGLEAN, r, 400)).toBe(0);
  });

  it('drops the name and the count word on a phone', () => {
    const r = snap({ tf: { c: 7, pl: 2, bc: 9 } });
    expect(boutTopLine(STARGLEAN, 2, r, 10 + 57, true)).toBe('0:48 · 7, 2nd');
    expect(boutTopLine(LASTWICK, 1, snap({ alive: 5 }), 10 + 51, true)).toBe('0:41 · 5 left');
  });

  it('reads a count before any tf line, and a count of seconds held to a tenth', () => {
    expect(boutCount(STARGLEAN, snap())).toBe('0 gleaned');
    expect(boutCount(STARGLEAN, snap(), true)).toBe('0');
    expect(boutCount(STARGLEAN, snap({ tf: { c: 3, pl: 0, bc: 3 } }))).toBe('3 gleaned');
    expect(countText(12.25)).toBe('12.3');
    expect(countText(12)).toBe('12');
    expect(countText(-1)).toBe('0');
  });
});

describe("a bout's win line and pill", () => {
  it('says the rule and the bout, the Final as such, nothing in the Lull', () => {
    expect(boutWinLine(STARGLEAN, 2, snap())).toBe('Most gleaned wins · Bout 3 of 6');
    expect(boutWinLine(LASTWICK, 5, snap())).toBe(
      'Last one standing wins · Bout 6 of 6 · the Final',
    );
    expect(boutWinLine(LASTWICK, 5, snap(), true)).toBe('Last one standing wins · the Final');
    expect(boutWinLine(STARGLEAN, 2, snap(), true)).toBe('Most gleaned wins · 3 of 6');
    expect(boutWinLine(STARGLEAN, 2, snap({ st: 'drop' }))).toBeNull();
  });

  it('shows x2 in the Final alone', () => {
    expect(finalBadge(5)).toBe('x2');
    expect(finalBadge(4)).toBeNull();
    expect(isFinal(5)).toBe(true);
    expect(isFinal(0)).toBe(false);
  });
});

describe('the bushels chip and the end beat', () => {
  it("reads the seat's bushels and place off the table it started with", () => {
    expect(ownStanding(start())).toEqual({ bushels: 9, place: 2 });
    expect(bushelsChip(start())).toBe('9 bushels · 2nd');
    expect(bushelsText(1)).toBe('1 bushel');
    expect(bushelsChip(start({ s: 42 }))).toBeNull();
  });

  it("names the last bout's winner and its kind, from the prize's seat", () => {
    const name = (id: string): string | null => BOUT_KINDS.find((k) => k.id === id)?.name ?? null;
    const w = lastWinner(start(), name);
    expect(w).toEqual({ seat: 3, name: 'Seat 3', kind: 'Starglean', self: false });
    expect(endBeatText(w!)).toBe('STARGLEAN · Seat 3');
    expect(endBeatText({ ...w!, self: true })).toBe('STARGLEAN · You');
    // None in the first bout, nor without a prize's seat.
    expect(lastWinner(start({ b: 0 }), name)).toBeNull();
    expect(lastWinner(start({ p: undefined }), name)).toBeNull();
  });

  it('says a fall out of a One life bout, and its place of eight', () => {
    expect(boutOutLine(undefined, false)).toBe('Out until the next bout');
    expect(boutOutLine(6, false)).toBe(`Out until the next bout · 6th of ${BOUT_SEATS}`);
    expect(boutOutLine(3, true)).toBe('Out of the Final · 3rd of 8');
  });

  it("says the gathering's people and seconds", () => {
    expect(gatherLine(2, 8, 13.2)).toBe('2 of 8 people · starts in 14 s');
    expect(gatherLine(1, 8, 0)).toBe('1 of 8 people · starts in 0 s');
  });
});

describe("the bout's card", () => {
  it("is the kind's own, titled with its name and number", () => {
    expect(boutCardWords(STARGLEAN, 2)).toEqual({
      title: 'Starglean · Bout 3 of 6',
      lines: [...STARGLEAN.card],
    });
    const final = boutCardWords(LASTWICK, 5);
    expect(final.title).toBe('Lastwick · the Final');
    expect(final.lines).toEqual([...LASTWICK.card]);
    // Every kind keeps to a win card's four lines at most.
    for (const kind of BOUT_KINDS) {
      expect(boutCardWords(kind, 5).lines.length).toBeLessThanOrEqual(4);
    }
  });
});

// The top line's pieces as Chrome drew them in the HUD's faces
// (.dev measure at 844x390 and 1280x720, 2026-10-20): the count's bold
// letters, the Dusk line's Cinzel with its spacing and its chrome (the
// light's dot, the padding, the border), the win line's and the chip's.
const PHONE_COUNT_PX = 6.5;
const PHONE_DUSK_PX = 9;
const PHONE_DUSK_CHROME_PX = 34;
const PHONE_ROW_GAP_PX = 8;
const PHONE_X2_PX = 28;
const DESK_COUNT_PX = 7.4;
const PHONE_WIN_PX = 6.2;
const PHONE_WIN_PAD_PX = 14;
const PHONE_CHIP_PX = 6;
const PHONE_CHIP_CHROME_PX = 27;
const PHONE_PILL_PX = 6.5;
const PHONE_PILL_CHROME_PX = 22;
const PHONE_SUB_GAP_PX = 6;
// The row under the head on a phone keeps between the thumbs' hints at the
// left (x 84 to 234) and as far from the right (tests/royale_win_layout).
const PHONE_SUB_ROOM_PX = 844 - 2 * 234;

// The Dusk's widest words on a phone, the calm's when a bout burns.
const PHONE_DUSK = ['The Dusk closes 0:14', 'Light holds 0:14', 'Dusk in 1:08', 'Last light'];

// The fullest counts a kind's top line shows: through the Lull (the calm's
// clock beside it, no pill), and in play a count no bout reaches, the last
// place, a full clock (any Dusk's words beside it, the Final's pill after).
function fullest(kind: BoutKind, compact: boolean): { line: string; play: boolean }[] {
  const out: { line: string; play: boolean }[] = [];
  for (const b of [0, 5]) {
    out.push({ line: boutTopLine(kind, b, snap({ st: 'drop' }), 0, compact), play: false });
    const r = snap({ alive: 8, tf: { c: 99, pl: 8, bc: 99 }, de: 0 });
    out.push({ line: boutTopLine(kind, b, r, 0, compact), play: true });
  }
  return out;
}

describe("every kind's lines in the top line's room", () => {
  for (const kind of BOUT_KINDS) {
    it(`keeps ${kind.name}'s count beside the Dusk's line inside a phone's row`, () => {
      const width = (t: string): number => t.length * PHONE_DUSK_PX + PHONE_DUSK_CHROME_PX;
      const anyDusk = Math.max(...PHONE_DUSK.map(width));
      const calm = width(duskLine(snap({ st: 'drop', dusk: { ...DUSK, pe: 68 } }), 0, true).text);
      for (const { line, play } of fullest(kind, true)) {
        const row = play
          ? anyDusk + PHONE_ROW_GAP_PX + line.length * PHONE_COUNT_PX + PHONE_X2_PX
          : calm + PHONE_ROW_GAP_PX + line.length * PHONE_COUNT_PX;
        expect(row, line).toBeLessThanOrEqual(2 * COMPACT_TOP_LINE_HALF_W_PX);
      }
      // The calm's burning words are a desktop's alone.
      expect(duskLine(snap({ st: 'drop' }), 0, true).text.startsWith('Outside')).toBe(false);
    });

    it(`keeps ${kind.name}'s win line and the chip or the pill in a phone's row under it`, () => {
      const chip = bushelsChip(start({ t: [row(0, 35)] }))!;
      const beside = Math.max(
        chip.length * PHONE_CHIP_PX + PHONE_CHIP_CHROME_PX,
        duskPill(0.24).length * PHONE_PILL_PX + PHONE_PILL_CHROME_PX,
      );
      for (const b of [0, 5]) {
        const line = boutWinLine(kind, b, snap(), true)!;
        const w = line.length * PHONE_WIN_PX + PHONE_WIN_PAD_PX + PHONE_SUB_GAP_PX + beside;
        expect(w, line).toBeLessThanOrEqual(PHONE_SUB_ROOM_PX);
      }
    });

    it(`keeps ${kind.name}'s count inside a desktop's top line`, () => {
      for (const { line } of fullest(kind, false)) {
        expect(line.length * DESK_COUNT_PX, line).toBeLessThanOrEqual(2 * TOP_LINE_HALF_W_PX);
      }
    });

    it(`keeps ${kind.name}'s rule under 40 characters`, () => {
      expect(kind.rule.length).toBeLessThan(40);
    });
  }
});
