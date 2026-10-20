// A Thornfray's end screen on screen (docs/design/thornfray.md, The end): the
// battle royale's end screen (ui/end_screen.ts, its 'royale' card) holding
// the result with its three ways on, the person's seat bout by bout under
// it on a desktop, and the table of the eight seats. What it says is
// ui/thornfray_end.ts; ui/royale_hud.ts lays it over the screen. This
// module only draws.

import type { PostMatchAction } from '../game/flow';
import type { ThornfrayResult } from '../net/royale_wire';
import { boutKindOf } from '../sim/content/bouts';
import { CHAMPIONS } from '../sim/content/champions';
import { setPortrait } from './champion_art';
import { boutsWonText, type ThornfrayEndModel, thornfrayEnd } from './thornfray_end';

const CSS = `
/* The seat bout by bout, two columns under the result: a desktop's. */
.tf-end-bouts { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, auto);
  grid-auto-flow: column; gap: 2px 12px; margin: 0;
  padding: 0; list-style: none; font-size: 13px; font-weight: 700; color: #e6dcb8;
  font-variant-numeric: tabular-nums; }
.tf-end-bouts li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hud.compact .end-progress.tf-end { display: none; }
.br-end-row .won { margin-left: auto; padding-right: 8px; font-size: 11px; font-weight: 700;
  color: #93a87c; white-space: nowrap; }
.br-end-row .won.short { display: none; }
/* A phone's narrow table: the name first, the bouts won short, no
   champion's name. */
.hud.compact .br-end-row.tf .who small, .hud.compact .br-end-row .won.long { display: none; }
.hud.compact .br-end-row .won.short { display: inline; padding-right: 4px; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
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

const kindName = (id: string): string | null => boutKindOf(id)?.name ?? null;

function head(model: ThornfrayEndModel, onExit: (action: PostMatchAction) => void): HTMLElement {
  const card = el('div', `br-end-card${model.won ? ' won' : ''}`);
  const lines = el('div', 'end-lines');
  for (const line of model.lines) lines.appendChild(el('p', 'br-end-line', line));
  card.append(el('div', 'br-end-kicker', model.kicker), el('h2', '', model.title), lines);
  const btns = el('div', 'br-end-btns');
  const button = (text: string, action: PostMatchAction, primary = false): HTMLButtonElement => {
    const b = el('button', primary ? 'primary' : '', text);
    b.type = 'button';
    b.dataset.exit = action;
    b.addEventListener('click', () => onExit(action));
    return b;
  };
  btns.append(
    button(model.again, 'again', true),
    button(model.other, 'other'),
    button(model.home, 'menu'),
  );
  card.appendChild(btns);
  return card;
}

function table(model: ThornfrayEndModel): HTMLElement {
  const rank = el('div', 'br-end-rank');
  const rows = el('div', 'end-rows');
  for (const row of model.rows) {
    const line = el('div', `br-end-row tf${row.self ? ' self' : ''}`);
    const img = el('img', '');
    img.alt = '';
    setPortrait(img, row.championId, 0x6b5a2e);
    const who = el('span', 'who');
    who.appendChild(el('b', '', row.name));
    if (row.bot) who.appendChild(el('span', 'br-bot', 'BOT'));
    const champ = CHAMPIONS[row.championId]?.name.split(',')[0];
    if (champ) who.appendChild(el('small', '', champ));
    if (row.won > 0) {
      who.append(
        el('span', 'won long', boutsWonText(row.won)),
        el('span', 'won short', `${row.won} won`),
      );
    }
    line.append(
      el('span', 'place', String(row.place)),
      img,
      who,
      el('span', 'score', String(row.bushels)),
    );
    rows.appendChild(line);
  }
  rank.append(el('h3', 'end-label end-rank-head', model.heading), rows);
  return rank;
}

// The boxes the end screen lays out: the result, the bouts under it, the
// table.
export function thornfrayEndParts(
  result: ThornfrayResult,
  onExit: (action: PostMatchAction) => void,
): { head: HTMLElement; lead: HTMLElement[]; table: HTMLElement | null } {
  ensureCss();
  const model = thornfrayEnd(result, kindName);
  const lead: HTMLElement[] = [];
  if (model.bouts.length > 0) {
    const box = el('div', 'end-progress tf-end');
    const list = el('ul', 'tf-end-bouts');
    for (const line of model.bouts) list.appendChild(el('li', '', line));
    box.appendChild(list);
    lead.push(box);
  }
  return {
    head: head(model, onExit),
    lead,
    table: model.rows.length > 0 ? table(model) : null,
  };
}
