// Where the end screens put their boxes (ui/end_screen.ts draws them): the
// battle royale's end card (ui/royale_hud.ts) and the 5v5's (ui/hud.ts),
// laid over the screen in a grid rather than one column to scroll through.
//
// Three columns. The battle royale: the result on the left (the title, the
// lines and the three ways on, the level bar and the Grafts under them),
// the ranking in the middle, the ladder over the feedback box on the
// right.
//
// The 5v5: the result over the ladder on the left, the scoreboard in the
// middle on twice the width, the feedback box and the Discord line on the
// right.
//
// A narrower screen (a large interface size, a small phone) takes two
// columns, and a narrow one a single column; both scroll as a page, the
// result and its buttons first.
//
// Pure numbers, the grid's CSS made from them, and the boxes they make on
// a screen at interface size 1, so a test keeps the boxes apart, the
// buttons on the first screen and the grid across the width at every size
// played. A box's height here is its tallest at the narrowest column a
// played size gives it, measured in a browser (the longest title, a ladder
// line on two lines); the browser draws it at most that tall.

import type { ScreenBox } from './royale_layout';

export type EndCard = 'royale' | 'teams';
export type EndKind = 'wide' | 'two' | 'one';

export interface EndMetrics {
  // The screen's padding on every side, the gap between the boxes, and
  // the grid's widest.
  gutter: number;
  gap: number;
  maxWidth: number;
  // The width inside the gutters from which three columns stand side by
  // side (the 5v5's middle one twice as wide), and two.
  wideFrom: number;
  twoFrom: number;
  // The height inside the gutters under which the tables' rows tighten.
  tallFrom: number;
  // A box's padding and border.
  pad: number;
  border: number;
  // The result's box: the battle royale's kicker, the title (the battle
  // royale's on the two lines the narrowest column wraps it to, the 5v5's
  // VICTORY or DEFEAT on one), the lines under it, the
  // gap between those blocks, and the buttons: the battle royale's first
  // across the box and the two others side by side under it, the 5v5's
  // two side by side, each pair one over the other in a box narrower
  // inside than its words want (the 5v5's Return to menu is the longer).
  kickerH: number;
  titleH: number;
  titleOneH: number;
  lineH: number;
  headGap: number;
  buttonH: number;
  buttonGap: number;
  pairFrom: number;
  royalePairFrom: number;
  // The battle royale's level bar (ui/royale_goal_bar.ts) and its Grafts
  // line, in the box under the result; a line's height counts the lines a
  // narrow column wraps it to.
  goalH: number;
  graftsH: number;
  // A Thornfray's seat bout by bout (ui/thornfray_end_view.ts), in the
  // same box: six lines in two columns of three on a desktop, none on a
  // phone, which leaves them out.
  boutsH: number;
  // The ranking: its heading and a row, tall and tightened.
  rankHeadH: number;
  rankRowH: number;
  rankRowShortH: number;
  // The scoreboard: a team's heading, the columns' head row (once, over
  // the first team), a row tall and tightened, and the gap between teams.
  teamHeadH: number;
  colsHeadH: number;
  scoreRowH: number;
  scoreRowShortH: number;
  teamGap: number;
  // The scoreboard's columns: the player's share of the names' room
  // beside the champion's, the K/D/A and the CS wide enough for the
  // widest a match gives them in the own row's bold ("22 / 18 / 31",
  // "388"). Under a width inside its box the scoreboard is narrow: the
  // champion stands under the player's name in one column, on a row this
  // tall, and the item icons come down to a short row's size, so a name
  // keeps its room ("Wanderer 4821" whole from 960 wide).
  playerFr: number;
  kdaW: number;
  csW: number;
  tableTightW: number;
  scoreRowTwoH: number;
  // The HUD's own boxes at their tallest, border included, in a third of
  // the sheet (the battle royale's columns) and in a quarter (the 5v5's
  // beside the scoreboard): the ladder box (ui/ladder_box.ts: 102 and 117
  // measured on a desktop, 69 on a phone, with the room for its level line
  // to wrap), the
  // feedback box (ui/feedback_box.ts) at its least (its field grows into
  // what the column leaves), and the 5v5's line under it that names the
  // Discord.
  ladderH: number;
  ladderQH: number;
  feedbackH: number;
  feedbackQH: number;
  joinH: number;
}

// A mouse and a keyboard, from 960x540 to 1920x1080.
export const DESKTOP_END: EndMetrics = {
  gutter: 20,
  gap: 12,
  maxWidth: 1400,
  wideFrom: 760,
  twoFrom: 480,
  tallFrom: 640,
  pad: 14,
  border: 1,
  kickerH: 14,
  titleH: 68,
  titleOneH: 34,
  lineH: 21,
  headGap: 8,
  buttonH: 42,
  buttonGap: 8,
  pairFrom: 300,
  royalePairFrom: 230,
  goalH: 62,
  graftsH: 34,
  boutsH: 51,
  rankHeadH: 26,
  rankRowH: 34,
  rankRowShortH: 26,
  teamHeadH: 22,
  colsHeadH: 18,
  scoreRowH: 36,
  scoreRowShortH: 26,
  teamGap: 8,
  playerFr: 1.15,
  kdaW: 84,
  csW: 30,
  tableTightW: 560,
  scoreRowTwoH: 34,
  ladderH: 120,
  ladderQH: 136,
  feedbackH: 152,
  feedbackQH: 168,
  joinH: 32,
};

// A touchscreen (the compact HUD), a phone in landscape first: smaller
// words, buttons a finger wide (game/ui_scale.ts MIN_TAP_PX).
export const PHONE_END: EndMetrics = {
  gutter: 8,
  gap: 8,
  maxWidth: 1400,
  wideFrom: 680,
  twoFrom: 440,
  tallFrom: 10_000,
  pad: 10,
  border: 1,
  kickerH: 12,
  titleH: 46,
  titleOneH: 23,
  lineH: 15,
  headGap: 6,
  buttonH: 44,
  buttonGap: 6,
  pairFrom: 230,
  royalePairFrom: 200,
  goalH: 38,
  graftsH: 16,
  boutsH: 0,
  rankHeadH: 22,
  rankRowH: 28,
  rankRowShortH: 28,
  teamHeadH: 18,
  colsHeadH: 16,
  scoreRowH: 26,
  scoreRowShortH: 26,
  teamGap: 6,
  playerFr: 1,
  kdaW: 74,
  csW: 26,
  tableTightW: 560,
  scoreRowTwoH: 30,
  ladderH: 88,
  ladderQH: 88,
  feedbackH: 121,
  feedbackQH: 122,
  joinH: 28,
};

// What a card holds: its lines under the title (the 5v5: the match time
// and the rating), its table's rows (the 5v5: both teams), the level bar,
// the Grafts, a Thornfray's bouts, and the HUD's boxes that show. A
// Thornfray's end is the battle royale's card (ADR 0035): its lines, its
// table of eight seats and its bouts under the result.
export interface EndContent {
  card: EndCard;
  lines: number;
  rows: number;
  goal: boolean;
  grafts: boolean;
  bouts?: boolean;
  ladder: boolean;
}

export function endMetrics(compact: boolean): EndMetrics {
  return compact ? PHONE_END : DESKTOP_END;
}

// The layout for the width inside the gutters.
export function endKind(innerWidth: number, m: EndMetrics): EndKind {
  if (innerWidth >= m.wideFrom) return 'wide';
  if (innerWidth >= m.twoFrom) return 'two';
  return 'one';
}

const frame = (m: EndMetrics): number => 2 * (m.pad + m.border);

// The width inside the result's box from which a pair of buttons stands
// side by side.
export function pairFrom(m: EndMetrics, card: EndCard): number {
  return card === 'royale' ? m.royalePairFrom : m.pairFrom;
}

// The buttons' rows in a result's box this wide (border included), and the
// result's box with nothing stretching it.
export function buttonRows(m: EndMetrics, card: EndCard, width: number): number {
  const pair = width - frame(m) >= pairFrom(m, card);
  return (card === 'royale' ? 1 : 0) + (pair ? 1 : 2);
}

export function buttonsHeight(m: EndMetrics, card: EndCard, width: number): number {
  const rows = buttonRows(m, card, width);
  return rows * m.buttonH + (rows - 1) * m.buttonGap;
}

export function headHeight(m: EndMetrics, c: EndContent, width: number): number {
  const royale = c.card === 'royale';
  const kicker = royale ? m.kickerH + m.headGap : 0;
  const title = royale ? m.titleH : m.titleOneH;
  const lines = c.lines > 0 ? c.lines * m.lineH + m.headGap : 0;
  return frame(m) + kicker + title + m.headGap + lines + buttonsHeight(m, c.card, width);
}

// The battle royale's box under the result: the level bar and the Grafts,
// or a Thornfray's bouts (a desktop's).
export function progressHeight(m: EndMetrics, c: EndContent): number {
  const bouts = c.bouts === true && m.boutsH > 0;
  if (c.card !== 'royale' || (!c.goal && !c.grafts && !bouts)) return 0;
  const parts = [c.goal ? m.goalH : 0, c.grafts ? m.graftsH : 0, bouts ? m.boutsH : 0];
  const shown = parts.filter((h) => h > 0);
  return frame(m) + shown.reduce((a, h) => a + h, 0) + m.headGap * (shown.length - 1);
}

// The scoreboard is narrow in a box this wide (border included).
export function narrowTable(m: EndMetrics, width: number): boolean {
  return width - frame(m) < m.tableTightW;
}

// The ranking or the scoreboard with every row, at the height's rows, the
// scoreboard's two lines high when it is narrow.
export function tableHeight(m: EndMetrics, c: EndContent, tall: boolean, narrow = false): number {
  if (c.card === 'royale') {
    if (c.rows === 0) return 0;
    return frame(m) + m.rankHeadH + c.rows * (tall ? m.rankRowH : m.rankRowShortH);
  }
  const row = narrow ? m.scoreRowTwoH : tall ? m.scoreRowH : m.scoreRowShortH;
  return frame(m) + 2 * m.teamHeadH + m.colsHeadH + c.rows * row + m.teamGap;
}

export interface EndBoxes {
  kind: EndKind;
  sheet: ScreenBox;
  head: ScreenBox;
  // The result's buttons, the first one first.
  buttons: ScreenBox[];
  progress: ScreenBox | null;
  table: ScreenBox | null;
  ladder: ScreenBox | null;
  feedback: ScreenBox;
  // The 5v5's Discord line under the feedback box.
  join: ScreenBox | null;
  // The table is shorter than its rows and scrolls inside itself.
  tableScrolls: boolean;
  // The screen is taller than the room inside its gutters and scrolls.
  sheetScrolls: boolean;
}

const box = (left: number, top: number, width: number, height: number): ScreenBox => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

// The buttons in the result's box: its content stands in the middle of the
// box, the buttons at the content's foot.
function placeButtons(m: EndMetrics, c: EndContent, head: ScreenBox): ScreenBox[] {
  const outer = head.right - head.left;
  const natural = headHeight(m, c, outer);
  const inset = m.pad + m.border;
  const contentTop = head.top + inset + Math.max(0, head.bottom - head.top - natural) / 2;
  let top = contentTop + natural - frame(m) - buttonsHeight(m, c.card, outer);
  const left = head.left + inset;
  const width = outer - 2 * inset;
  const half = (width - m.buttonGap) / 2;
  const step = m.buttonH + m.buttonGap;
  const out: ScreenBox[] = [];
  // The battle royale's first across the box, then the pair.
  if (c.card === 'royale') {
    out.push(box(left, top, width, m.buttonH));
    top += step;
  }
  if (width >= pairFrom(m, c.card)) {
    out.push(box(left, top, half, m.buttonH), box(left + half + m.buttonGap, top, half, m.buttonH));
  } else {
    out.push(box(left, top, width, m.buttonH), box(left, top + step, width, m.buttonH));
  }
  return out;
}

// A column of boxes from the top of an area, one of them stretched to fill
// what the others leave.
function stack(
  area: ScreenBox,
  heights: readonly number[],
  grow: number,
  gap: number,
): ScreenBox[] {
  const fixed =
    heights.reduce((s, h, i) => (i === grow ? s : s + h), 0) + gap * (heights.length - 1);
  const out: ScreenBox[] = [];
  let y = area.top;
  for (const [i, h] of heights.entries()) {
    const own = i === grow ? Math.max(h, area.bottom - area.top - fixed) : h;
    out.push(box(area.left, y, area.right - area.left, own));
    y += own + gap;
  }
  return out;
}

// The boxes on a screen width x height at interface size 1, compact for a
// touchscreen, for what the card holds.
export function endBoxes(width: number, height: number, compact: boolean, c: EndContent): EndBoxes {
  const m = endMetrics(compact);
  const innerW = width - 2 * m.gutter;
  const room = height - 2 * m.gutter;
  const kind = endKind(innerW, m);
  const tall = room >= m.tallFrom;
  const sheetW = Math.min(m.maxWidth, innerW);
  const left = (width - sheetW) / 2;
  const royale = c.card === 'royale';
  const wide = kind === 'wide';
  const half = (sheetW - m.gap) / 2;
  const unit = (sheetW - 2 * m.gap) / (royale ? 3 : 4);
  // The 5v5's scoreboard: twice the unit when wide, across the sheet else.
  const narrow = !royale && narrowTable(m, wide ? 2 * unit + m.gap : sheetW);
  const tableN = tableHeight(m, c, tall, narrow);
  const progressN = progressHeight(m, c);
  const leadW = wide ? unit : kind === 'two' ? half : sheetW;
  const sum = (list: readonly number[]): number =>
    list.reduce((s, h) => s + h, 0) + m.gap * Math.max(0, list.length - 1);
  // What stands under the table, in the middle column, when the screen is
  // wide: on a phone the 5v5's ladder.
  const under = wide && !royale && compact && c.ladder;
  const underN = under ? m.ladderH : 0;
  // The lead column: the result, then the level bar (the battle royale)
  // or the ladder (the 5v5, when not under the table). The side column:
  // the battle royale's ladder over the feedback box; the 5v5's feedback
  // box over the Discord line.
  const ladderInLead = !royale && c.ladder && !under;
  const leadList = [
    headHeight(m, c, leadW),
    ...(royale ? (progressN > 0 ? [progressN] : []) : ladderInLead ? [m.ladderQH] : []),
  ];
  const sideList = royale
    ? [...(c.ladder ? [m.ladderH] : []), m.feedbackH]
    : [m.feedbackQH, m.joinH];
  const feedbackAt = royale ? sideList.length - 1 : sideList.length - 2;
  const leadN = sum(leadList);
  const sideN = sum(sideList);

  const place = (bodyH: number): { top: number; scrolls: boolean } => ({
    top: bodyH <= room + 1e-6 ? (height - bodyH) / 2 : m.gutter,
    scrolls: bodyH > room + 1e-6,
  });
  // The result takes the height its column leaves, the feedback box what
  // its own leaves (its field grows).
  const result = (
    sheet: ScreenBox,
    lead: ScreenBox,
    table: ScreenBox,
    side: ScreenBox,
    underBox: ScreenBox | null,
    tableScrolls: boolean,
    scrolls: boolean,
  ): EndBoxes => {
    const leads = stack(lead, leadList, 0, m.gap);
    const sides = stack(side, sideList, feedbackAt, m.gap);
    const head = leads[0]!;
    return {
      kind,
      sheet,
      head,
      buttons: placeButtons(m, c, head),
      progress: royale && progressN > 0 ? leads[1]! : null,
      table: tableN > 0 ? table : null,
      ladder: !c.ladder ? null : royale ? sides[0]! : ladderInLead ? leads[1]! : underBox,
      feedback: sides[feedbackAt]!,
      join: royale ? null : sides[sides.length - 1]!,
      tableScrolls,
      sheetScrolls: scrolls,
    };
  };

  if (wide) {
    // Three columns, the 5v5's middle one twice as wide. The row is as
    // tall as the tallest column and no taller than the room: the table
    // gives the height back, never below what the other columns hold.
    const tableW = royale ? unit : 2 * unit;
    const x1 = left + unit + m.gap;
    const x2 = x1 + tableW + m.gap;
    const part = under ? m.gap + underN : 0;
    const floor = Math.max(leadN - part, sideN - part, 0);
    const row1N = Math.max(tableN, floor);
    const row1 = row1N + part <= room ? row1N : Math.max(floor, room - part);
    const bodyH = row1 + part;
    const { top, scrolls } = place(bodyH);
    const sheet = box(left, top, sheetW, bodyH);
    const lead = box(left, top, unit, bodyH);
    const table = box(x1, top, tableW, row1);
    const side = box(x2, top, unit, bodyH);
    const underBox = under ? box(x1, top + row1 + m.gap, tableW, underN) : null;
    return result(sheet, lead, table, side, underBox, row1 < tableN - 1e-6, scrolls);
  }

  const x1 = left + half + m.gap;
  if (kind === 'two') {
    if (royale) {
      // 'lead table' over the side column under the table, at their own
      // heights.
      const row1 = Math.max(leadN, tableN);
      const bodyH = row1 + m.gap + sideN;
      const { top, scrolls } = place(bodyH);
      const sheet = box(left, top, sheetW, bodyH);
      const lead = box(left, top, half, row1);
      const side = box(x1, top + row1 + m.gap, half, sideN);
      return result(sheet, lead, box(x1, top, half, row1), side, null, false, scrolls);
    }
    // The result and the ladder beside the feedback box, over the
    // scoreboard across both.
    const row1 = Math.max(leadN, sideN);
    const bodyH = row1 + m.gap + tableN;
    const { top, scrolls } = place(bodyH);
    const sheet = box(left, top, sheetW, bodyH);
    const table = box(left, top + row1 + m.gap, sheetW, tableN);
    return result(
      sheet,
      box(left, top, half, row1),
      table,
      box(x1, top, half, row1),
      null,
      false,
      scrolls,
    );
  }

  // One column at the natural heights, from the top: the result, then the
  // battle royale's ranking and the rest; the 5v5's ladder and feedback
  // box, then its scoreboard.
  const at = m.gutter;
  const lead = box(left, at, sheetW, leadN);
  if (royale) {
    const tableTop = lead.bottom + m.gap;
    const table = box(left, tableTop, sheetW, tableN);
    const side = box(left, (tableN > 0 ? table.bottom : tableTop - m.gap) + m.gap, sheetW, sideN);
    const sheet = box(left, at, sheetW, side.bottom - at);
    return result(sheet, lead, table, side, null, false, sheet.bottom > height - m.gutter);
  }
  const side = box(left, lead.bottom + m.gap, sheetW, sideN);
  const table = box(left, side.bottom + m.gap, sheetW, tableN);
  const sheet = box(left, at, sheetW, table.bottom - at);
  return result(sheet, lead, table, side, null, false, sheet.bottom > height - m.gutter);
}

// The scoreboard's item icons are drawn 30 px (ui/scoreboard_table.ts);
// in a row they keep 3 px above and below.
export const SCORE_ICON_PX = 30;
export function iconZoom(rowH: number): number {
  return Math.min(1, Math.round(((rowH - 6) / SCORE_ICON_PX) * 100) / 100);
}

// The grid's own rules for one set of metrics, scoped under the HUD's
// class for it. The screen is a size container, so the columns follow the
// room inside its gutters (and the safe area), the turned stage's and the
// interface size's, not the page's. In the wide layout the sheet is never
// taller than that room: the table's row gives the height back and the
// table scrolls inside its box, never below what the other columns hold.
function gridCss(hud: string, m: EndMetrics, compact: boolean): string {
  const root = `${hud} ${ROOT_RULE}`;
  const sheet = `${hud} ${END_ROOT} .end-sheet`;
  const short = `(height < ${m.tallFrom}px)`;
  // The 5v5's ladder: under the result on a desktop, under the scoreboard
  // (which gives up its height) on a phone.
  const teamsLadder = compact
    ? `'lead table side' 'lead ladder side'`
    : `'lead table side' 'ladder table side'`;
  return `
${root} {
  padding: calc(${m.gutter}px + var(--safe-top, 0px)) calc(${m.gutter}px + var(--safe-right, 0px))
    calc(${m.gutter}px + var(--safe-bottom, 0px)) calc(${m.gutter}px + var(--safe-left, 0px));
}
${sheet} { max-width: ${m.maxWidth}px; gap: ${m.gap}px; }
${sheet} .end-lead, ${sheet} .end-side { gap: ${m.gap}px; }
${sheet} .end-box { padding: ${m.pad}px; border-width: ${m.border}px; }
${sheet} .end-head { gap: ${m.headGap}px; container: end-head / inline-size; }
${sheet} :is(.end-btns, .br-end-btns) { gap: ${m.buttonGap}px; }
${sheet} :is(.end-btns, .br-end-btns) button { min-height: ${m.buttonH}px; }
@container end-head (width < ${m.pairFrom}px) {
  ${sheet}.teams .end-btns { grid-template-columns: minmax(0, 1fr); }
}
@container end-head (width < ${m.royalePairFrom}px) {
  ${sheet}.royale .br-end-btns { grid-template-columns: minmax(0, 1fr); }
}
${sheet} .end-progress { gap: ${m.headGap}px; }
${sheet} .end-rank-head { height: ${m.rankHeadH}px; }
${sheet} .br-end-row { height: ${m.rankRowH}px; }
${sheet} .br-end-row img { width: ${m.rankRowH - 6}px; height: ${m.rankRowH - 6}px; }
${sheet} .hud-score-team h4 { height: ${m.teamHeadH}px; }
${sheet} .hud-score-row.head { height: ${m.colsHeadH}px; }
${sheet} .hud-score-row:not(.head) { height: ${m.scoreRowH}px; }
${sheet} .hud-score-row {
  grid-template-columns: minmax(0, ${m.playerFr}fr) minmax(0, 1fr) ${m.kdaW}px ${m.csW}px max-content;
}
${sheet} .hud-score-build { zoom: ${iconZoom(m.scoreRowH)}; }
${sheet} .end-table.hud-end-card { gap: ${m.teamGap}px; }
@container end ${short} {
  ${sheet} .br-end-row { height: ${m.rankRowShortH}px; }
  ${sheet} .br-end-row img { width: ${m.rankRowShortH - 6}px; height: ${m.rankRowShortH - 6}px; }
  ${sheet} .hud-score-row:not(.head) { height: ${m.scoreRowShortH}px; }
  ${sheet} .hud-score-build { zoom: ${iconZoom(m.scoreRowShortH)}; }
}
${sheet} .end-table.hud-end-card { container: end-table / inline-size; }
@container end-table (width < ${m.tableTightW}px) {
  ${sheet} .hud-score-row {
    grid-template-columns: minmax(0, 1fr) ${m.kdaW}px ${m.csW}px max-content;
    grid-template-areas: 'player kda cs build' 'champ kda cs build';
    align-content: center; row-gap: 0;
  }
  ${sheet} .hud-score-row.head { grid-template-areas: 'player kda cs build'; }
  ${sheet} .hud-score-row.head .hud-score-champ { display: none; }
  ${sheet} .hud-score-row:not(.head) { height: ${m.scoreRowTwoH}px; }
  ${sheet} .hud-score-player { grid-area: player; }
  ${sheet} .hud-score-champ { grid-area: champ; }
  ${sheet} .hud-score-kda { grid-area: kda; }
  ${sheet} .hud-score-cs { grid-area: cs; }
  ${sheet} .hud-score-build { grid-area: build; zoom: ${iconZoom(m.scoreRowShortH)}; }
}
@container end (min-width: ${m.twoFrom}px) {
  ${sheet} {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas: 'lead table' '. side';
  }
  ${sheet}.teams { grid-template-areas: 'lead side' 'table table'; }
  ${sheet}.teams${LADDER} { grid-template-areas: 'lead side' 'ladder side' 'table table'; }
}
@container end (min-width: ${m.wideFrom}px) {
  ${sheet} {
    max-height: 100%; grid-template-rows: 1fr; grid-template-areas: 'lead table side';
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  }
  ${sheet}.teams {
    grid-template-areas: 'lead table side';
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr);
  }
  ${sheet}.teams${LADDER} { grid-template-rows: 1fr auto; grid-template-areas: ${teamsLadder}; }
  ${sheet} .end-table { min-height: 0; }
}`;
}

// The class the end screen's root carries, whichever card it holds, and
// the root as its own rules name it: the battle royale's screen or the
// HUD's overlay, at a weight above the HUD's rules for a modal overlay on
// a phone, whichever stylesheet the page added last.
export const END_ROOT = '.end-screen';
export const ROOT_RULE = `${END_ROOT}:is(.br-end, .hud-overlay.modal)`;
// The 5v5's sheet while its ladder box shows.
const LADDER = ':has(> .hud-ladder:not([hidden]))';

// The screen is the container the columns are chosen by; one column is the
// layout until it has the room for two.
export function endLayoutCss(): string {
  const sheet = `.hud ${END_ROOT} .end-sheet`;
  return `
.hud ${END_ROOT} { container: end / size; }
${sheet} {
  display: grid; grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'lead' 'table' 'side';
}
${sheet}.teams { grid-template-areas: 'lead' 'side' 'table'; }
${sheet}.teams${LADDER} { grid-template-areas: 'lead' 'ladder' 'side' 'table'; }
${sheet} > .hud-ladder { grid-area: ladder; }
${sheet} .end-lead { grid-area: lead; }
${sheet} .end-table { grid-area: table; }
${sheet} .end-side { grid-area: side; }
${gridCss('.hud:not(.compact)', DESKTOP_END, false)}
${gridCss('.hud.compact', PHONE_END, true)}`;
}
