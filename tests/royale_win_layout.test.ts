// Where the win card stands (src/ui/royale_win_card.ts winCardBox): on a
// desktop at the left, off the champion and every line of the HUD; on a
// phone in the column left of the champion, clear of the touch controls,
// the feed and the notices; aside while the Graft cards are open or a
// spotlight's word shows, and never in the way of a thumb. And the win
// line under the top line (src/ui/royale_win_view.ts), in its row with the
// Dusk's pill, no wider than the room it has.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MOVE_RING } from '../src/game/move_ring';
import { thumbScale } from '../src/game/ui_scale';
import { BOUT_KINDS } from '../src/sim/content/bouts';
import { BOUTS } from '../src/sim/content/bouts/match';
import { boutCardWords } from '../src/ui/bout_card';
import { cardsCoverBox, chipBox } from '../src/ui/royale_grafts';
import {
  announceBox,
  BAR_HALF_PX,
  BOLD_EM_PER_CHAR,
  championBox,
  compactFeedBox,
  compactNotesBox,
  feedBox,
  HINTS_TOP_PX,
  NOTE_H_PX,
  NOTES_BOTTOM_PX,
  notesLane,
  overlaps,
  type ScreenBox,
  spotBox,
  stepsBox,
  TOP_LINE_H_PX,
  TOP_LINE_TOP_PX,
  topLineBox,
} from '../src/ui/royale_layout';
import { duskPill } from '../src/ui/royale_text';
import {
  WIN_DESK_TYPE,
  WIN_PHONE_TYPE,
  type WinCardWords,
  winCardBox,
  winCardWidth,
  winCardWords,
} from '../src/ui/royale_win_card';
import {
  WIN_COMPACT_LINE_PAD_PX,
  WIN_COMPACT_LINE_PX,
  WIN_LINE_EM_PER_CHAR,
  WIN_LINE_PAD_PX,
  WIN_LINE_PX,
  WIN_ROW_GAP_PX,
  winLine,
} from '../src/ui/royale_win_line';
import { winViewCss } from '../src/ui/royale_win_view';
import { thumbCluster } from '../src/ui/thumb_cluster';
import { touchBarLeftBox } from '../src/ui/touch_bar';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

// The desktops played at interface size 1, and a phone held sideways.
const DESKS: readonly [number, number][] = [
  [1280, 720],
  [1366, 768],
  [1920, 1080],
];
const [PW, PH] = [844, 390];
const BOTH = ['respawn', 'one_life'] as const;
// Each rule set's card in Solo and in Crews (ADR 0034).
const CARDS = BOTH.flatMap((v) => [[v, false] as const, [v, true] as const]);
// Every card the screen shows, named: the battle royale's, and a
// Thornfray's for every registered kind (ADR 0035, ui/bout_card.ts), in a
// bout and in the Final, where it says what the Final pays.
const WORDS: readonly [string, WinCardWords][] = [
  ...CARDS.map(([v, crews]): [string, WinCardWords] => [
    `${v}${crews ? ' crews' : ''}`,
    winCardWords(v, crews),
  ]),
  ...BOUT_KINDS.flatMap((kind) =>
    [0, BOUTS - 1].map((b): [string, WinCardWords] => [
      `${kind.name} bout ${b + 1}`,
      boutCardWords(kind, b),
    ]),
  ),
];

// The bar with its bars, slots and loot row at the bottom center of a
// desktop, and the hints at its bottom left.
const bar = (w: number, h: number): ScreenBox => ({
  left: w / 2 - BAR_HALF_PX,
  top: h - 175,
  right: w / 2 + BAR_HALF_PX,
  bottom: h,
});
const hints = (h: number): ScreenBox => ({
  left: 12,
  top: h - HINTS_TOP_PX,
  right: 252,
  bottom: h,
});
// The map in a desktop's corner; a phone's at the top right with the
// thumb controls, else at the bottom right (ui/minimap.ts).
const deskMap = (w: number, h: number): ScreenBox => ({
  left: w - 12 - 168,
  top: h - 12 - 168,
  right: w - 12,
  bottom: h - 12,
});
const phoneMap = (thumbs: boolean): ScreenBox =>
  thumbs
    ? { left: PW - 12 - 112, top: 58, right: PW - 12, bottom: 58 + 112 }
    : { left: PW - 12 - 112, top: PH - 12 - 112, right: PW - 12, bottom: PH - 12 };
// A phone's announcement line, 70 px down (ui/hud.ts).
const phoneAnnounce: ScreenBox = { left: PW / 2 - 211, top: 70, right: PW / 2 + 211, bottom: 94 };
// The thumb controls: the hints past the touch bar, the stick's quarter
// with the Move ring in it, the ability buttons in the corner (ui/hud.ts,
// game/move_ring.ts, ui/thumb_cluster.ts).
const thumbsHints: ScreenBox = { left: 84, top: 44, right: 234, bottom: 117 };
const stick: ScreenBox = { left: 0, top: 230, right: 230, bottom: PH };
const moveRing: ScreenBox = {
  left: MOVE_RING.left - MOVE_RING.r,
  top: PH - MOVE_RING.bottom - MOVE_RING.r,
  right: MOVE_RING.left + MOVE_RING.r,
  bottom: PH - MOVE_RING.bottom + MOVE_RING.r,
};
const clusterCircles = (): ScreenBox[] => {
  const c = thumbCluster();
  const k = thumbScale(PH);
  return [c.attack, ...c.slots, ...c.sigils, ...c.marks].map((b) => ({
    left: PW - (b.right + b.r) * k,
    top: PH - (b.bottom + b.r) * k,
    right: PW - (b.right - b.r) * k,
    bottom: PH - (b.bottom - b.r) * k,
  }));
};
// Played by taps: the touch bar at the right edge, 40 percent down, Menu
// and Center; the hints at the bottom left (ui/touch_bar.ts, ui/hud.ts).
const tapsBar: ScreenBox = {
  left: PW - 8 - 56,
  top: PH * 0.4 - 48,
  right: PW - 8,
  bottom: PH * 0.4 + 48,
};
const tapsHints: ScreenBox = { left: 12, top: PH - 12 - 80, right: 182, bottom: PH - 12 };

const inside = (b: ScreenBox, w: number, h: number): boolean =>
  b.left >= 0 && b.top >= 0 && b.right <= w && b.bottom <= h;

describe('where the win card stands on a desktop', () => {
  for (const [w, h] of DESKS) {
    it(`stands at the left, off the champion and the HUD's lines, at ${w}x${h}`, () => {
      for (const [said, words] of WORDS) {
        const card = winCardBox(w, false, false, words);
        const near: [string, ScreenBox][] = [
          ['champion', championBox(w, h)],
          ['top line', topLineBox(w, false)],
          ['announcement', announceBox(w)],
          ['first steps', stepsBox(w)],
          ['feed', feedBox(w)],
          ['notices', notesLane(w, h)],
          ['bar', bar(w, h)],
          ['hints', hints(h)],
          ['map', deskMap(w, h)],
          ['chip', chipBox(w, h, false)],
        ];
        for (const [name, box] of near) expect(overlaps(card, box), `${said} ${name}`).toBe(false);
        expect(inside(card, w, h)).toBe(true);
      }
    });
  }

  it('keeps off the champion and the first notices at 960x540 too', () => {
    const [w, h] = [960, 540];
    // The lane fills from its foot: its first two notices.
    const foot = h - NOTES_BOTTOM_PX;
    const twoNotices: ScreenBox = { ...notesLane(w, h), top: foot - 2 * NOTE_H_PX };
    for (const [said, words] of WORDS) {
      const card = winCardBox(w, false, false, words);
      const near: [string, ScreenBox][] = [
        ['champion', championBox(w, h)],
        ['top line', topLineBox(w, false)],
        ['announcement', announceBox(w)],
        ['feed', feedBox(w)],
        ['notices', twoNotices],
        ['bar', bar(w, h)],
      ];
      for (const [name, box] of near) expect(overlaps(card, box), `${said} ${name}`).toBe(false);
    }
  });

  it('holds its title on one line at 1280x720, its lines on one each', () => {
    // The title at 0.61 em a letter, as Chrome drew it in the widest face
    // it had (DejaVu Sans Bold: 363 px at 14 px), in the room left of the
    // close button; the lines at their own widest.
    const t = WIN_DESK_TYPE;
    const w = winCardWidth(1280, false, false);
    for (const [, words] of WORDS) {
      expect(words.title.length * t.titlePx * 0.61).toBeLessThanOrEqual(
        w - 2 * t.padX - t.border - t.close,
      );
      for (const line of words.lines) {
        expect(line.length * t.linePx * WIN_LINE_EM_PER_CHAR).toBeLessThanOrEqual(
          w - 2 * t.padX - t.border - 13,
        );
      }
    }
  });
});

describe('where the win card stands on a phone', () => {
  for (const thumbs of [true, false]) {
    it(`stands left of the champion, clear of the controls, ${thumbs ? 'thumbs' : 'taps'}`, () => {
      for (const [said, words] of WORDS) {
        const card = winCardBox(PW, true, thumbs, words);
        const near: [string, ScreenBox][] = [
          ['champion', championBox(PW, PH)],
          ['top line', topLineBox(PW, true)],
          ['announcement', phoneAnnounce],
          ['feed', compactFeedBox(PW, PH, thumbs)],
          ['notices', compactNotesBox(PW, PH, thumbs)],
          ['map', phoneMap(thumbs)],
          ['chip', chipBox(PW, PH, true)],
        ];
        if (thumbs) {
          near.push(
            ['touch bar', touchBarLeftBox(PH, 2)],
            ['hints', thumbsHints],
            ['stick', stick],
            ['Move ring', moveRing],
          );
          for (const [i, c] of clusterCircles().entries()) near.push([`button ${i}`, c]);
        } else {
          near.push(['touch bar', tapsBar], ['hints', tapsHints]);
        }
        for (const [name, box] of near) expect(overlaps(card, box), `${said} ${name}`).toBe(false);
        expect(inside(card, PW, PH)).toBe(true);
        // Room for a line at a readable size.
        expect(card.right - card.left).toBeGreaterThanOrEqual(260);
      }
      expect(WIN_PHONE_TYPE.linePx).toBeGreaterThanOrEqual(11);
    });
  }
});

describe('the win card in the way of nothing', () => {
  it("steps aside while the Graft cards are open or a spotlight's word shows", () => {
    // Where they stand it would stand under them: a phone's row covers
    // half the screen, the spotlight the band over the champion.
    for (const thumbs of [true, false]) {
      expect(
        overlaps(winCardBox(PW, true, thumbs, winCardWords('respawn')), cardsCoverBox(PW, true)),
      ).toBe(true);
    }
    const taps = winCardBox(PW, true, false, winCardWords('respawn'));
    expect(overlaps(taps, spotBox(PW, PH, true))).toBe(true);
    const view = source('src/ui/royale_win_view.ts');
    expect(view).toContain('.hud.br-cards-open .br-win-card, .hud.br-spotting .br-win-card,');
    expect(view).toContain('.hud.overlay-open .br-win-card { visibility: hidden; opacity: 0;');
    // Its clock holds meanwhile.
    expect(view).toContain("const cardsOpen = root.classList.contains('br-cards-open');");
    expect(view).toContain('cardsOpen ||');
    expect(view).toContain("root.classList.contains('br-spotting') ||");
  });

  it('lets a touch through to the stick, its close button a finger wide', () => {
    const css = winViewCss();
    const rule = (selector: string): string => {
      const at = css.indexOf(`\n${selector} {`);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(rule('.br-win-card')).toContain('pointer-events: none;');
    expect(rule('.br-win-close')).toContain('pointer-events: auto;');
    expect(css).toContain(
      ".br-win-close::after { content: ''; position: absolute; inset: -11px; }",
    );
    // Drawn 20 px across, and 11 px round it each side.
    expect(WIN_PHONE_TYPE.close - 2 + 2 * 11).toBeGreaterThanOrEqual(42);
  });
});

describe('the win line', () => {
  // The pill beside it (src/ui/royale_hud.ts .br-burn): its sizes, its
  // chrome (padding and border), and its heavier letters' width in ems.
  const PILL_PX = 12.5;
  const COMPACT_PILL_PX = 11;
  const PILL_CHROME_PX = 26;
  const COMPACT_PILL_CHROME_PX = 22;
  const pill = duskPill(0.12);
  const lineW = (text: string, compact: boolean): number =>
    text.length * (compact ? WIN_COMPACT_LINE_PX : WIN_LINE_PX) * WIN_LINE_EM_PER_CHAR +
    2 * (compact ? WIN_COMPACT_LINE_PAD_PX : WIN_LINE_PAD_PX);
  const pillW = (compact: boolean): number =>
    pill.length * (compact ? COMPACT_PILL_PX : PILL_PX) * BOLD_EM_PER_CHAR +
    (compact ? COMPACT_PILL_CHROME_PX : PILL_CHROME_PX);
  // The longest lines: the match's first minutes, the last of fifty.
  const longest = (compact: boolean): string[] => [
    winLine({ v: 'respawn', st: 'play', end: 600, alive: 50, rk: 50 }, 0, compact) ?? '',
    winLine({ v: 'one_life', st: 'play', end: 600, alive: 50 }, 0, compact) ?? '',
    // Crews: the last of sixteen crews.
    winLine(
      { v: 'respawn', st: 'play', end: 600, alive: 48, rk: 16, cw: { n: 16, s: 0 } },
      0,
      compact,
    ) ?? '',
    winLine({ v: 'one_life', st: 'play', end: 600, alive: 48, cw: { n: 16, s: 0 } }, 0, compact) ??
      '',
  ];

  it("shares a phone's row with the Dusk's pill, clear of the thumbs' hints and map", () => {
    // Centered under the head's row, between the hints at the left
    // (ui/hud.ts .hud.thumbs .hud-hints) and as far from the right edge,
    // short of the map the thumb controls put there.
    const room = PW - 2 * thumbsHints.right;
    expect(PW / 2 + room / 2).toBeLessThanOrEqual(phoneMap(true).left);
    for (const line of longest(true)) {
      const row = lineW(line, true) + WIN_ROW_GAP_PX + pillW(true);
      expect(row, line).toBeLessThanOrEqual(room);
    }
  });

  it("stands between a desktop's first steps and feed, the pill beside it with the cards open", () => {
    // Alone on its line at 960 wide, clear of the first steps' card and
    // the feed either side of the top line.
    const w = 960;
    const room = 2 * Math.min(w / 2 - stepsBox(w).right, feedBox(w).left - w / 2);
    for (const line of longest(false)) {
      expect(lineW(line, false), line).toBeLessThanOrEqual(room);
      // With the cards open the first steps step aside and the feed stands
      // under the row: the line and the pill share a row across the top,
      // clear of the corners.
      expect(lineW(line, false) + 6 + pillW(false), line).toBeLessThanOrEqual(w - 2 * 140);
    }
  });

  it("adds nothing to a desktop's top line at its fullest: it steps aside for the pill", () => {
    // As Chrome drew them at 1280x720: the head (the Dusk's line and the
    // count), the mark's badge, the win line and the pill, 4 px apart.
    const [HEAD, BADGE, LINE, PILL, GAP] = [53, 22, 18, 25, 4];
    const stack = (...rows: number[]): number =>
      rows.reduce((a, b) => a + b, 0) + GAP * (rows.length - 1);
    // All four stacked reached 138 px, past the announcement's top at 112;
    // with the line aside the fullest is the head, the badge and the pill,
    // what the top line held before the line came.
    expect(TOP_LINE_TOP_PX + stack(HEAD, BADGE, LINE, PILL)).toBeGreaterThan(announceBox(1280).top);
    expect(stack(HEAD, BADGE, PILL)).toBeLessThanOrEqual(TOP_LINE_H_PX);
    expect(stack(HEAD, BADGE, LINE)).toBeLessThanOrEqual(TOP_LINE_H_PX);
    expect(TOP_LINE_TOP_PX + TOP_LINE_H_PX).toBeLessThanOrEqual(116);
    // In the Dusk with no mark, the usual case, the line and the pill
    // reached the band; the pill alone stands well over it.
    expect(TOP_LINE_TOP_PX + stack(HEAD, PILL)).toBeLessThan(announceBox(1280).top - 16);
    const view = source('src/ui/royale_win_view.ts');
    expect(view).toContain('winLineAside({');
    const hud = source('src/ui/royale_hud.ts');
    const call = hud.slice(hud.indexOf('this.win.update('));
    expect(call.slice(0, call.indexOf(');'))).toContain('outside === true,');
    expect(hud.indexOf('this.win.update(')).toBeGreaterThan(hud.indexOf('const outside ='));
  });

  it('stands in the row under the head with the pill, in the stylesheet and the DOM', () => {
    const css = winViewCss();
    expect(css).toContain(`font-size: ${WIN_LINE_PX}px;`);
    expect(css).toContain(`.hud.compact .br-win { font-size: ${WIN_COMPACT_LINE_PX}px;`);
    expect(css).toContain(
      `.hud.compact .br-sub { flex-direction: row; gap: ${WIN_ROW_GAP_PX}px; }`,
    );
    const hud = source('src/ui/royale_hud.ts');
    expect(hud).toContain("const sub = el('div', 'br-sub');");
    expect(hud).toContain('sub.append(this.burnEl);');
    expect(hud).toContain('sub.prepend(this.win.line);');
    expect(hud).toContain(
      `.hud.compact .br-burn { font-size: ${COMPACT_PILL_PX}px; padding: 3px 10px; }`,
    );
  });
});
