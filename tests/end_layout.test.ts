// The end screens' boxes (src/ui/end_layout.ts, drawn by
// src/ui/end_screen.ts): the battle royale's end card and the 5v5's, laid
// over the screen in a grid instead of one column to scroll through, with
// no box over another, the whole screen on one screen at the desktops
// played, the result's buttons always on the first one, and the grid
// across the width, on a phone in landscape too.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buttonRows,
  DESKTOP_END,
  type EndBoxes,
  type EndContent,
  endBoxes,
  endKind,
  endLayoutCss,
  headHeight,
  iconZoom,
  narrowTable,
  PHONE_END,
  tableHeight,
} from '../src/ui/end_layout';
import { END_SCREEN_CSS } from '../src/ui/end_screen';
import { overlaps, type ScreenBox } from '../src/ui/royale_layout';
import { ONE_LIFE_TOP, RESPAWN_TOP } from '../src/ui/royale_result';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The desktops at interface size 1 (ui_scale: 1 up to 1080 rows) and a
// phone in landscape, which plays on the compact HUD.
const SCREENS: readonly { w: number; h: number; compact: boolean }[] = [
  { w: 960, h: 540, compact: false },
  { w: 1024, h: 768, compact: false },
  { w: 1280, h: 720, compact: false },
  { w: 1366, h: 768, compact: false },
  { w: 1536, h: 864, compact: false },
  { w: 1920, h: 1080, compact: false },
  { w: 844, h: 390, compact: true },
];

// Every card at its fullest: the ladder box, Respawn's five lines and ten rows with the level
// bar and the Grafts, One life's two lines and five rows, the 5v5's match
// time and the line that says it was not rated (on three lines in a
// narrow column), both teams.
const RESPAWN: EndContent = {
  card: 'royale',
  lines: 5,
  rows: RESPAWN_TOP,
  goal: true,
  grafts: true,
  ladder: true,
};
const ONE_LIFE: EndContent = {
  card: 'royale',
  lines: 2,
  rows: ONE_LIFE_TOP,
  goal: false,
  grafts: true,
  ladder: true,
};
const TEAMS: EndContent = {
  card: 'teams',
  lines: 4,
  rows: 10,
  goal: false,
  grafts: false,
  ladder: true,
};
// A Thornfray's end (ADR 0035): three lines, the eight seats, its bouts
// under the result on a desktop.
const THORNFRAY: EndContent = {
  card: 'royale',
  lines: 3,
  rows: 8,
  goal: false,
  grafts: false,
  bouts: true,
  ladder: true,
};
// And lighter: a match that banked nothing (no ladder), a card with no
// Grafts.
const CARDS: readonly [string, EndContent][] = [
  ['Respawn', RESPAWN],
  ['One life', ONE_LIFE],
  ['the 5v5', TEAMS],
  ['a Respawn that banked nothing', { ...RESPAWN, ladder: false }],
  ['a 5v5 that banked nothing', { ...TEAMS, ladder: false }],
  ['One life with no Grafts', { ...ONE_LIFE, grafts: false }],
  ['a Thornfray', THORNFRAY],
  ['a Thornfray that banked nothing', { ...THORNFRAY, ladder: false }],
];

const inside = (outer: ScreenBox, inner: ScreenBox): boolean =>
  inner.left >= outer.left - 1e-6 &&
  inner.top >= outer.top - 1e-6 &&
  inner.right <= outer.right + 1e-6 &&
  inner.bottom <= outer.bottom + 1e-6;

const screen = (w: number, h: number): ScreenBox => ({ left: 0, top: 0, right: w, bottom: h });

const height = (b: ScreenBox): number => b.bottom - b.top;
const width = (b: ScreenBox): number => b.right - b.left;

const named = (b: EndBoxes): [string, ScreenBox][] => {
  const out: [string, ScreenBox][] = [
    ['result', b.head],
    ['feedback', b.feedback],
  ];
  if (b.progress) out.push(['level bar', b.progress]);
  if (b.table) out.push(['table', b.table]);
  if (b.ladder) out.push(['ladder', b.ladder]);
  if (b.join) out.push(['Discord line', b.join]);
  return out;
};

const apart = (boxes: readonly [string, ScreenBox][]): void => {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [an, a] = boxes[i]!;
      const [bn, bb] = boxes[j]!;
      expect(overlaps(a, bb), `${an} over ${bn}`).toBe(false);
    }
  }
};

const label = (s: { w: number; h: number; compact: boolean }): string =>
  `${s.w}x${s.h}${s.compact ? ' (touch)' : ''}`;

describe('the end screens', () => {
  for (const s of SCREENS) {
    const m = s.compact ? PHONE_END : DESKTOP_END;
    for (const [name, c] of CARDS) {
      const b = endBoxes(s.w, s.h, s.compact, c);

      it(`keeps every box of ${name} clear of every other at ${label(s)}`, () => {
        expect(b.kind).toBe('wide');
        apart(named(b));
        apart(b.buttons.map((x, i) => [`button ${i + 1}`, x]));
      });

      it(`fits ${name} on one screen with no page scroll at ${label(s)}`, () => {
        expect(b.sheetScrolls).toBe(false);
        expect(inside(screen(s.w, s.h), b.sheet)).toBe(true);
        for (const [box, x] of named(b)) expect(inside(b.sheet, x), box).toBe(true);
        // Every row of the table in view on a desktop; on a phone only the
        // table may scroll, inside its own box, and never below a few rows.
        if (!s.compact) expect(b.tableScrolls).toBe(false);
        else if (b.table)
          expect(height(b.table)).toBeGreaterThanOrEqual(m.rankHeadH + 4 * m.rankRowH);
      });

      it(`keeps the buttons of ${name} on the first screen at ${label(s)}`, () => {
        expect(b.buttons).toHaveLength(c.card === 'royale' ? 3 : 2);
        for (const button of b.buttons) {
          expect(inside(screen(s.w, s.h), button)).toBe(true);
          expect(inside(b.head, button)).toBe(true);
          // A finger wide on a touchscreen.
          if (s.compact) expect(height(button)).toBeGreaterThanOrEqual(44);
        }
        // The first one leads: across the battle royale's box, on the left
        // of the 5v5's pair or over it in a narrow box.
        const [first, second] = b.buttons as [ScreenBox, ScreenBox];
        if (c.card === 'royale' || buttonRows(m, c.card, width(b.head)) === 2) {
          expect(first.bottom).toBeLessThanOrEqual(second.top);
        } else expect(first.right).toBeLessThanOrEqual(second.left);
      });

      it(`spreads ${name} across the width at ${label(s)}`, () => {
        expect(width(b.sheet)).toBe(Math.min(m.maxWidth, s.w - 2 * m.gutter));
        expect(width(b.sheet) / s.w).toBeGreaterThanOrEqual(0.7);
        // The columns stand side by side and start together.
        const table = b.table!;
        expect(b.head.right).toBeLessThanOrEqual(table.left);
        expect(table.top).toBe(b.head.top);
        if (c.card === 'royale') {
          expect(table.right).toBeLessThanOrEqual(b.feedback.left);
          expect(width(table)).toBeCloseTo(width(b.head));
          expect(width(b.feedback)).toBeCloseTo(width(b.head));
          expect((b.ladder ?? b.feedback).top).toBe(b.head.top);
        } else {
          // The scoreboard twice as wide as the columns beside it, the
          // feedback box heading the right one.
          expect(width(table)).toBeCloseTo(2 * width(b.head));
          expect(table.right).toBeLessThanOrEqual(b.feedback.left);
          expect(width(b.feedback)).toBeCloseTo(width(b.head));
          expect(b.feedback.top).toBe(b.head.top);
        }
        // Every column reaches the sheet's foot, so the grid has no hole.
        expect(Math.max(...named(b).map(([, x]) => x.bottom))).toBeCloseTo(b.sheet.bottom);
      });
    }
  }

  it("lays the 5v5's ladder under the result, and under the scoreboard on a phone", () => {
    const b = endBoxes(1280, 720, false, TEAMS);
    expect(b.ladder!.left).toBe(b.head.left);
    expect(b.ladder!.top).toBeGreaterThan(b.head.bottom);
    expect(b.ladder!.bottom).toBeCloseTo(b.sheet.bottom);
    // On a phone the scoreboard gives up its height to it and scrolls in
    // its box, so the result has its column to itself.
    const p = endBoxes(844, 390, true, TEAMS);
    expect(p.ladder!.left).toBe(p.table!.left);
    expect(p.ladder!.right).toBe(p.table!.right);
    expect(p.ladder!.top).toBeGreaterThan(p.table!.bottom);
    expect(p.tableScrolls).toBe(true);
    expect(p.head.bottom).toBeCloseTo(p.sheet.bottom);
    // Hidden, it takes no room: the scoreboard has the whole column.
    const none = endBoxes(844, 390, true, { ...TEAMS, ladder: false });
    expect(none.ladder).toBeNull();
    expect(none.table!.bottom).toBeCloseTo(none.sheet.bottom);
  });

  it("lays the battle royale's ladder over the feedback box beside the ranking", () => {
    for (const s of SCREENS) {
      const b = endBoxes(s.w, s.h, s.compact, RESPAWN);
      expect(b.kind).toBe('wide');
      expect(b.ladder!.left).toBe(b.feedback.left);
      expect(b.ladder!.top).toBe(b.table!.top);
      expect(b.feedback.top).toBeGreaterThan(b.ladder!.bottom);
      // Nothing under the ranking: every column reaches the sheet's foot.
      expect(b.table!.bottom).toBeCloseTo(b.sheet.bottom);
      expect(b.feedback.bottom).toBeCloseTo(b.sheet.bottom);
    }
  });

  it('shows the whole ranking and both teams on every desktop, tightened on a short one', () => {
    for (const s of SCREENS.filter((x) => !x.compact)) {
      for (const c of [RESPAWN, TEAMS]) {
        const b = endBoxes(s.w, s.h, false, c);
        const tall = s.h - 2 * DESKTOP_END.gutter >= DESKTOP_END.tallFrom;
        const narrow = c.card === 'teams' && narrowTable(DESKTOP_END, width(b.table!));
        expect(height(b.table!)).toBeGreaterThanOrEqual(tableHeight(DESKTOP_END, c, tall, narrow));
      }
    }
    expect(DESKTOP_END.rankRowShortH).toBeLessThan(DESKTOP_END.rankRowH);
    expect(DESKTOP_END.scoreRowShortH).toBeLessThan(DESKTOP_END.scoreRowH);
  });

  it('lets the table give up its height before anything else on a short screen', () => {
    // A phone with its browser's bars: the table scrolls in its box when
    // its rows want more than the room (the scoreboard's both teams; the
    // ranking's ten rows just fit), the result and its buttons stay whole
    // on the first screen.
    for (const c of [RESPAWN, TEAMS]) {
      const b = endBoxes(844, 340, true, c);
      expect(b.kind).toBe('wide');
      expect(b.tableScrolls).toBe(c.card === 'teams');
      expect(height(b.head)).toBeGreaterThanOrEqual(headHeight(PHONE_END, c, width(b.head)));
      for (const button of b.buttons) expect(inside(screen(844, 340), button)).toBe(true);
      apart(named(b));
    }
  });

  it('falls back to two columns, then one, on a narrower screen', () => {
    for (const c of [RESPAWN, ONE_LIFE, TEAMS]) {
      // A small phone in landscape, and a desktop at 175% interface size.
      for (const [w, h, compact] of [
        [667, 375, true],
        [1366 / 1.75, 768 / 1.75, false],
      ] as const) {
        const b = endBoxes(w, h, compact, c);
        expect(b.kind).toBe('two');
        apart(named(b));
        for (const button of b.buttons) expect(inside(screen(w, h), button)).toBe(true);
      }
      // A narrow window: one column that scrolls, the result first.
      const narrow = endBoxes(460, 800, false, c);
      expect(narrow.kind).toBe('one');
      apart(named(narrow));
      expect(narrow.head.top).toBe(DESKTOP_END.gutter);
      for (const button of narrow.buttons) expect(inside(screen(460, 800), button)).toBe(true);
    }
  });

  it('chooses the columns from the width inside the gutters', () => {
    for (const m of [DESKTOP_END, PHONE_END]) {
      expect(endKind(m.wideFrom, m)).toBe('wide');
      expect(endKind(m.wideFrom - 1, m)).toBe('two');
      expect(endKind(m.twoFrom - 1, m)).toBe('one');
      // Three columns only where a third holds the ranking's row and the
      // ladder's name field with its button, and the 5v5's middle one, on
      // half the width, the scoreboard's five columns.
      const inside = 2 * (m.pad + m.border);
      expect((m.wideFrom - 2 * m.gap) / 3 - inside).toBeGreaterThanOrEqual(190);
      expect((m.wideFrom - 2 * m.gap) / 2 - inside).toBeGreaterThanOrEqual(300);
    }
  });

  it('draws the grid from the same numbers', () => {
    const css = endLayoutCss();
    for (const [hud, m] of [
      ['.hud:not(.compact)', DESKTOP_END],
      ['.hud.compact', PHONE_END],
    ] as const) {
      const sheet = `${hud} .end-screen .end-sheet`;
      expect(css).toContain(`@container end (min-width: ${m.wideFrom}px)`);
      expect(css).toContain(`@container end (min-width: ${m.twoFrom}px)`);
      expect(css).toContain(`${sheet} { max-width: ${m.maxWidth}px; gap: ${m.gap}px; }`);
      expect(css).toContain(
        `${sheet} .end-box { padding: ${m.pad}px; border-width: ${m.border}px; }`,
      );
      expect(css).toContain(
        `${sheet} :is(.end-btns, .br-end-btns) button { min-height: ${m.buttonH}px; }`,
      );
      expect(css).toContain(`${sheet} .br-end-row { height: ${m.rankRowH}px; }`);
      expect(css).toContain(`${sheet} .hud-score-row:not(.head) { height: ${m.scoreRowH}px; }`);
      expect(css).toContain(`${sheet} .hud-score-build { zoom: ${iconZoom(m.scoreRowH)}; }`);
    }
    expect(css).toContain(`@container end (height < ${DESKTOP_END.tallFrom}px)`);
    // The 5v5's scoreboard twice as wide as the columns beside it; the
    // battle royale's three columns on one row.
    expect(css).toContain(
      `.teams {\n    grid-template-areas: 'lead table side';\n    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);`,
    );
    expect(css).toContain(`grid-template-rows: 1fr; grid-template-areas: 'lead table side';`);
    expect(css).not.toContain('offer');
    expect(css).toContain('container: end / size');
    expect(END_SCREEN_CSS).toContain(css);
    // The icons never drawn larger than they are.
    expect(iconZoom(400)).toBe(1);
  });

  it("keeps the scoreboard's numbers in their columns and the names their room", () => {
    // The widest K/D/A and CS a match gives, in the own row's bold,
    // measured in a browser: "22 / 18 / 31" drew 82 px on a desktop and 72
    // on a phone, "388" 24 on a phone; narrower, the K/D/A ran over the CS.
    const widest = [
      [DESKTOP_END, 82, 24],
      [PHONE_END, 72, 24],
    ] as const;
    const css = endLayoutCss();
    for (const [m, kda, cs] of widest) {
      expect(m.kdaW).toBeGreaterThanOrEqual(kda);
      expect(m.csW).toBeGreaterThanOrEqual(cs);
      expect(css).toContain(
        `grid-template-columns: minmax(0, ${m.playerFr}fr) minmax(0, 1fr) ${m.kdaW}px ${m.csW}px max-content;`,
      );
      // A narrow scoreboard stands the champion under the player's name,
      // on rows two lines high, and draws its icons a short row's size.
      expect(css).toContain(`@container end-table (width < ${m.tableTightW}px)`);
      expect(css).toContain("grid-template-areas: 'player kda cs build' 'champ kda cs build';");
      expect(css).toContain(`.hud-score-row:not(.head) { height: ${m.scoreRowTwoH}px; }`);
      expect(m.scoreRowTwoH).toBeGreaterThanOrEqual(m.scoreRowShortH);
    }
    expect(css).toContain('container: end-table / inline-size;');
    // The container query reads the box's inside: the model does too. The
    // 5v5's scoreboard is narrow from 1024 wide down and wide from 1280,
    // and always on a phone.
    const frame = 2 * (DESKTOP_END.pad + DESKTOP_END.border);
    expect(narrowTable(DESKTOP_END, DESKTOP_END.tableTightW + frame - 1)).toBe(true);
    expect(narrowTable(DESKTOP_END, DESKTOP_END.tableTightW + frame)).toBe(false);
    const at = (w: number, h: number, compact = false): number =>
      width(endBoxes(w, h, compact, TEAMS).table!);
    expect(narrowTable(DESKTOP_END, at(960, 540))).toBe(true);
    expect(narrowTable(DESKTOP_END, at(1024, 768))).toBe(true);
    for (const [w, h] of [
      [1280, 720],
      [1366, 768],
      [1920, 1080],
    ] as const) {
      expect(narrowTable(DESKTOP_END, at(w, h)), `${w}x${h}`).toBe(false);
    }
    expect(narrowTable(PHONE_END, at(844, 390, true))).toBe(true);
    // Narrow, its rows are two lines high, and every one still shows.
    const b = endBoxes(960, 540, false, TEAMS);
    expect(height(b.table!)).toBeGreaterThanOrEqual(tableHeight(DESKTOP_END, TEAMS, false, true));
  });

  it('lets the level bar box scroll inside past the content it was measured for', () => {
    // A long match's Grafts run past the two lines measured: the box under
    // the result gives up its height, never the result or the page.
    expect(END_SCREEN_CSS).toContain('.end-head { flex-shrink: 0; }');
    expect(END_SCREEN_CSS).toContain(
      '.end-progress { flex: 0 1 auto; min-height: 0; overflow-y: auto;',
    );
  });

  it('is what both end cards open on', () => {
    const hud = readFileSync(path.join(ROOT, 'src/ui/hud.ts'), 'utf8');
    const royale = readFileSync(path.join(ROOT, 'src/ui/royale_hud.ts'), 'utf8');
    expect(hud).toContain("fillEndScreen(this.endOverlay, 'teams', {");
    expect(royale).toContain("fillEndScreen(end, 'royale', {");
    // The words stay the cards' own.
    expect(hud).toContain("'Play again'");
    expect(hud).toContain("'Return to menu'");
  });
});
