// The Lull's card on screen (CONTEXT.md: Lull; docs/design/thornfray.md, The
// HUD and the phone), drawn in the battle royale's layer of the HUD
// (ui/royale_hud.ts) from the model ui/lull_model.ts decides: its head (the
// bout, its rule, when it lands), the table of bushels and its foot (the
// prize, what a tap on the globe does). On a phone it stands in the free
// column left of the globe, five rows; on a desktop at the left, all eight.
// While the prize winner's Graft cards are open it folds to its head's
// first row, above their title (ui/royale_grafts.ts CARDS_ASIDE names its
// body). No buttons: the Lull ends by itself. It never sets the page's
// overlay state, so the touch controls stay for the globe's tap, and never
// touches the match's layer. This module only draws.

import { setPortrait } from './champion_art';
import { setHidden } from './dom_write';
import {
  LULL_DESK_CLEAR_PX,
  LULL_DESK_GAP_PX,
  LULL_DESK_LEFT_PX,
  LULL_DESK_LINE_PX,
  LULL_DESK_PAD_PX,
  LULL_DESK_ROW_PX,
  LULL_DESK_TITLE_PX,
  LULL_DESK_TOP_PX,
  LULL_DESK_W_PX,
  LULL_PHONE_FOOT_PX,
  LULL_PHONE_HEAD_PX,
  LULL_PHONE_MARGIN_PX,
  LULL_PHONE_ROW_PX,
  LULL_PHONE_TITLE_PX,
  type LullModel,
  type LullRow,
} from './lull_model';
import {
  ANNOUNCE_GAP_PX,
  FEED_MAX_W_PX,
  FEED_RIGHT_PX,
  STEPS_CLEAR_MIDDLE_PX,
  STEPS_LEFT_PX,
  STEPS_MAX_W_PX,
  TOP_LINE_HALF_W_PX,
} from './royale_layout';
import {
  RETURN_GLOBE_HALF_VH,
  RETURN_WASH_GAP_VH,
  RETURN_WASH_PHONE_TOP_PX,
  returnWashLeftCss,
} from './royale_return';

const SAFE_LEFT = 'var(--safe-left, env(safe-area-inset-left, 0px))';
const SAFE_TOP = 'var(--safe-top, env(safe-area-inset-top, 0px))';
const GLOBE = `${RETURN_GLOBE_HALF_VH + RETURN_WASH_GAP_VH} * var(--vh, 1vh)`;
// The announcements' left edge, as ui/royale_layout.ts announceBox has it.
const ANNOUNCE_REACH =
  `max(${FEED_RIGHT_PX + FEED_MAX_W_PX}px, ` +
  `${STEPS_LEFT_PX}px + min(${STEPS_MAX_W_PX}px, 50% - ${STEPS_CLEAR_MIDDLE_PX}px))`;

// The desktop card's width (lull_model.ts lullDeskRight): left of the
// globe, of the top line and of the announcements, at most its own.
const DESK_W =
  `min(${LULL_DESK_W_PX}px, ` +
  `calc(50% - ${GLOBE} - ${LULL_DESK_LEFT_PX}px), ` +
  `calc(50% - ${TOP_LINE_HALF_W_PX + LULL_DESK_CLEAR_PX + LULL_DESK_LEFT_PX}px), ` +
  `calc(${ANNOUNCE_REACH} + ${ANNOUNCE_GAP_PX - LULL_DESK_CLEAR_PX - LULL_DESK_LEFT_PX}px))`;
// The phone's: from its left edge to the globe's column.
const PHONE_W = (left: string): string => `calc(50% - ${GLOBE} - ${left})`;

const CSS = `
.lull { position: absolute; box-sizing: border-box; z-index: 3; pointer-events: none;
  left: calc(${LULL_DESK_LEFT_PX}px + ${SAFE_LEFT}); top: calc(${LULL_DESK_TOP_PX}px + ${SAFE_TOP});
  width: ${DESK_W}; padding: ${LULL_DESK_PAD_PX}px 12px;
  border-radius: 12px; border: 1px solid #8a7430; border-left: 4px solid #e8c46c;
  background: rgba(10, 14, 24, 0.9); color: #f2e6c0; text-shadow: none;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.55); animation: lull-in 0.3s ease-out; }
@keyframes lull-in { from { opacity: 0; transform: translateX(-8px); } }
.lull[hidden] { display: none; }
.lull-title { display: flex; align-items: center; gap: 8px; height: ${LULL_DESK_TITLE_PX}px; }
.lull-title b { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-size: 13px; font-weight: 800; letter-spacing: 0.2px; color: #ffe08a; }
.lull-clock { flex: none; padding: 1px 7px; border-radius: 7px; font-size: 11.5px; font-weight: 900;
  font-variant-numeric: tabular-nums; color: #241a08; white-space: nowrap;
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%); }
.lull-rule, .lull-final, .lull-prize, .lull-ask { height: ${LULL_DESK_LINE_PX}px;
  line-height: ${LULL_DESK_LINE_PX}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lull-rule { font-size: 13px; font-weight: 700; color: #e9dcae; display: flex; align-items: center; gap: 6px; }
.lull-rule span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.lull-x2 { flex: none; padding: 0 5px; border-radius: 5px; background: #ffd36b; color: #2a1c04;
  font-size: 10.5px; font-weight: 900; line-height: 15px; font-style: normal; }
.lull-final { font-size: 12px; font-weight: 800; color: #ffd36b; }
.lull-rows { margin: ${LULL_DESK_GAP_PX}px 0; }
.lull-row { display: grid; grid-template-columns: 18px ${LULL_DESK_ROW_PX - 6}px minmax(0, 1fr) 30px 28px;
  align-items: center; gap: 6px; height: ${LULL_DESK_ROW_PX}px; padding: 0 4px; border-radius: 6px;
  font-size: 13px; font-variant-numeric: tabular-nums; }
.lull-row:nth-child(odd) { background: rgba(255, 255, 255, 0.035); }
.lull-row.self { background: rgba(232, 196, 108, 0.16); box-shadow: inset 0 0 0 1px rgba(232, 196, 108, 0.5); }
.lull-row .pl { font-weight: 800; color: #c9a84a; text-align: right; }
.lull-row img { width: ${LULL_DESK_ROW_PX - 6}px; height: ${LULL_DESK_ROW_PX - 6}px; border-radius: 5px;
  object-fit: cover; border: 1px solid #4a3f22; display: block; }
.lull-row .who { display: flex; align-items: center; gap: 5px; min-width: 0; }
.lull-row .who b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 700; color: #f6ecd0; }
.lull-row.self .who b { color: #ffe08a; }
.lull-row .who .br-bot { flex: none; }
.lull-row .last { text-align: right; font-size: 12px; font-weight: 700; color: #8fd06a; }
.lull-row .last.none { color: #6f7a66; }
.lull-row .tot { text-align: right; font-weight: 900; color: #ffe08a; }
.lull-prize { font-size: 12.5px; font-weight: 700; color: #d8f0c0; height: auto; max-height: ${2 * LULL_DESK_LINE_PX}px;
  white-space: normal; line-height: ${LULL_DESK_LINE_PX}px; text-wrap: balance; }
.lull-prize:empty { display: none; }
.lull-ask { font-size: 12px; font-weight: 600; color: #a9b9cf; }
/* Folded to its head's first row while the Graft cards are open. */
.hud.br-cards-open .lull :is(.lull-rule, .lull-final, .lull-rows, .lull-prize, .lull-ask) {
  display: none; }
.hud.compact .lull { left: calc(${LULL_PHONE_MARGIN_PX}px + ${SAFE_LEFT});
  top: calc(${RETURN_WASH_PHONE_TOP_PX}px + ${SAFE_TOP});
  width: ${PHONE_W(`${LULL_PHONE_MARGIN_PX}px - ${SAFE_LEFT}`)}; padding: 0 8px 0 7px;
  border-radius: 9px; border-left-width: 3px; }
.hud.compact.thumbs .lull { left: ${returnWashLeftCss()}; width: ${PHONE_W(returnWashLeftCss())}; }
.hud.compact .lull-title { height: ${LULL_PHONE_TITLE_PX}px; gap: 6px; }
.hud.compact .lull-title b { font-size: 11.5px; letter-spacing: 0; }
.hud.compact .lull-clock { font-size: 10.5px; padding: 0 6px; }
.hud.compact .lull-rule { height: ${LULL_PHONE_HEAD_PX - LULL_PHONE_TITLE_PX - 6}px;
  line-height: ${LULL_PHONE_HEAD_PX - LULL_PHONE_TITLE_PX - 6}px; font-size: 11px; margin-bottom: 6px; }
.hud.compact .lull-clock { line-height: 14px; }
.hud.compact .lull-final, .hud.compact .lull-ask { display: none; }
.hud.compact .lull-rows { margin: 0; }
.hud.compact .lull-row { height: ${LULL_PHONE_ROW_PX}px; font-size: 11px; gap: 4px; padding: 0 2px;
  grid-template-columns: 14px ${LULL_PHONE_ROW_PX - 6}px minmax(0, 1fr) 22px 20px; }
.hud.compact .lull-row img { width: ${LULL_PHONE_ROW_PX - 6}px; height: ${LULL_PHONE_ROW_PX - 6}px;
  border-radius: 4px; }
.hud.compact .lull-row .last { font-size: 10px; }
.hud.compact .lull-prize, .hud.compact .lull-ask.alone { display: block; height: ${LULL_PHONE_FOOT_PX}px;
  max-height: none; line-height: ${LULL_PHONE_FOOT_PX}px; font-size: 10.5px; white-space: nowrap; }
.hud.compact .lull-prize:empty { display: none; }
`;

// The stylesheet, for a test to read.
export function lullCss(): string {
  return CSS;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const setText = (e: HTMLElement, text: string): void => {
  if (e.textContent !== text) e.textContent = text;
};

// The portrait's tint, the card's gold.
const TINT = 0x6b5a2e;

export class LullView {
  private readonly style: HTMLStyleElement;
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly rule: HTMLElement;
  private readonly ruleText: HTMLElement;
  private readonly x2: HTMLElement;
  private readonly final: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly prize: HTMLElement;
  private readonly ask: HTMLElement;
  // The rows as last drawn, so a second of the clock redraws none.
  private rowsKey = '';

  constructor(layer: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = el('div', 'lull');
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    const head = el('div', 'lull-title');
    this.title = el('b', '');
    this.clock = el('span', 'lull-clock');
    head.append(this.title, this.clock);
    this.rule = el('div', 'lull-rule');
    this.ruleText = el('span', '');
    this.x2 = el('i', 'lull-x2', 'x2');
    this.rule.append(this.ruleText, this.x2);
    this.final = el('div', 'lull-final');
    this.rows = el('div', 'lull-rows');
    this.prize = el('div', 'lull-prize');
    this.ask = el('div', 'lull-ask');
    this.root.append(head, this.rule, this.final, this.rows, this.prize, this.ask);
    layer.appendChild(this.root);
  }

  // The card as the model says, or gone (null).
  update(model: LullModel | null): void {
    setHidden(this.root, model === null);
    if (!model) return;
    setText(this.title, model.title);
    setText(this.clock, model.clock);
    setText(this.ruleText, model.rule);
    setHidden(this.x2, model.final === null);
    setHidden(this.final, model.final === null);
    if (model.final !== null) setText(this.final, model.final);
    setText(this.prize, model.prize ?? '');
    setText(this.ask, model.ask);
    // In the Final its line takes the ask's room; on a phone the foot holds
    // one line: the prize, else the ask.
    setHidden(this.ask, model.final !== null);
    this.ask.classList.toggle('alone', model.prize === null);
    const key = JSON.stringify(model.rows);
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.rows.textContent = '';
      for (const row of model.rows) this.rows.appendChild(this.row(row));
    }
  }

  private row(row: LullRow): HTMLElement {
    const line = el('div', `lull-row${row.self ? ' self' : ''}`);
    const img = el('img', '');
    img.alt = '';
    setPortrait(img, row.championId, TINT);
    const who = el('span', 'who');
    who.appendChild(el('b', '', row.name));
    if (row.bot) who.appendChild(el('span', 'br-bot', 'BOT'));
    const last = row.last === null ? '' : `+${row.last}`;
    line.append(
      el('span', 'pl', String(row.place)),
      img,
      who,
      el('span', `last${row.last ? '' : ' none'}`, last),
      el('span', 'tot', String(row.bushels)),
    );
    return line;
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
