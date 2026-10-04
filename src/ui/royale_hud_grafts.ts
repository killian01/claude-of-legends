// The Graft cards over the battle royale's screen (CONTEXT.md: Graft; ADR
// 0032), mounted by ui/royale_hud.ts: the open offer's three big cards in a
// row across the top of the view under a title that says what they are,
// over the globe during the drop and over the play view after an event,
// picked by a click, a tap, or the keys 1, 2 and 3 (game/input.ts). They
// never run out (the maintainer, 2026-10-04: time to read): Later folds them
// into a chip, and so does a fight; a click on the chip opens them again.
// A Graft taken shows as a notice. What the cards say and where they stand
// is ui/royale_grafts.ts.

import type { SnapGraftOffer, SnapRoyale } from '../net/royale_wire';
import { GRAFTS } from '../sim/content/grafts';
import { setHidden } from './dom_write';
import {
  CARD_GAP_PX,
  CHIP_BOTTOM_PX,
  CHIP_H_PX,
  CHIP_LEFT_SHARE,
  CHIP_W_PX,
  DESK_CARD_H_PX,
  DESK_CARD_W_PX,
  DESK_CHIP_TOP_PX,
  DESK_TOP_PX,
  GRADE_COLORS,
  GRADE_HINTS,
  GRADE_NAMES,
  GRAFT_SUBTITLE,
  GRAFT_TITLE,
  type GraftReader,
  graftCards,
  graftChip,
  graftFolded,
  PHONE_CARD_GAP_PX,
  PHONE_CARD_H_PX,
  PHONE_CARD_W_PX,
  PHONE_TITLE_H_PX,
  PHONE_TOP_PX,
  TITLE_H_PX,
} from './royale_grafts';

const CSS = `
.br-grafts { position: absolute; left: 50%; top: calc(${DESK_TOP_PX}px + var(--safe-top, env(safe-area-inset-top, 0px)));
  transform: translateX(-50%); display: flex; flex-direction: column; align-items: center;
  pointer-events: none; z-index: 6; }
.br-grafts .ttl { height: ${TITLE_H_PX}px; display: flex; align-items: baseline; gap: 10px;
  color: #fff3d6; font-size: 19px; font-weight: 900; letter-spacing: 0.4px;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.85); white-space: nowrap; }
.br-grafts .ttl small { font-size: 13px; font-weight: 600; color: #e6dcbc; letter-spacing: 0; }
.br-grafts .row { display: flex; gap: ${CARD_GAP_PX}px; }
.br-graft { --c: #e8c45a; position: relative; width: ${DESK_CARD_W_PX}px;
  min-height: ${DESK_CARD_H_PX}px; box-sizing: border-box; padding: 10px 12px 10px 44px;
  border-radius: 12px; border: 2px solid var(--c); background: rgba(8, 10, 20, 0.86);
  color: #ece4c8; text-align: left; font: inherit; cursor: pointer; pointer-events: auto;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55), inset 0 0 22px rgba(0, 0, 0, 0.4);
  animation: br-graft-in 0.3s ease-out both; touch-action: manipulation;
  -webkit-tap-highlight-color: transparent; transition: transform 0.12s ease, border-color 0.12s ease; }
.br-graft:hover { transform: translateY(-3px); border-color: #fff3cf; }
.br-graft:nth-child(2) { animation-delay: 0.06s; }
.br-graft:nth-child(3) { animation-delay: 0.12s; }
@keyframes br-graft-in { from { opacity: 0; transform: translateY(-12px); } }
.br-graft .k { position: absolute; left: 10px; top: 10px; width: 24px; height: 24px; border-radius: 6px;
  background: var(--c); color: #12100a; font-size: 14px; font-weight: 900; line-height: 24px;
  text-align: center; }
.br-graft .n { display: block; font-size: 18px; font-weight: 900; color: #fff3d6; line-height: 1.15; }
.br-graft .g { display: block; margin-top: 2px; font-size: 11px; font-weight: 800; letter-spacing: 0.8px;
  text-transform: uppercase; color: var(--c); }
.br-graft .t { display: block; margin-top: 6px; font-size: 14px; line-height: 1.3; color: #e2d8bc; }
.br-graft .d { display: block; margin-top: 4px; font-size: 13px; font-weight: 700; color: var(--c); }
.br-graft.heartwood { box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55), 0 0 18px rgba(185, 138, 240, 0.4); }
.br-grafts .later { margin-top: 8px; padding: 5px 16px; border-radius: 999px; pointer-events: auto;
  border: 1px solid rgba(255, 243, 214, 0.45); background: rgba(8, 10, 20, 0.78); color: #e6dcbc;
  font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; touch-action: manipulation; }
.br-grafts .later:hover { border-color: #fff3cf; color: #fff3d6; }
.br-graft-chip { position: absolute; left: 50%; top: calc(${DESK_CHIP_TOP_PX}px + var(--safe-top, env(safe-area-inset-top, 0px)));
  transform: translateX(-50%); width: ${CHIP_W_PX}px; height: ${CHIP_H_PX}px; box-sizing: border-box;
  padding: 0 10px; border-radius: 999px; border: 2px solid var(--c, #e8c45a); background: rgba(8, 10, 20, 0.9);
  color: #fff3d6; font: inherit; font-size: 13px; font-weight: 900; text-align: center; cursor: pointer;
  pointer-events: auto; touch-action: manipulation; z-index: 6;
  animation: br-graft-pulse 1.1s ease-in-out infinite; }
@keyframes br-graft-pulse { 50% { box-shadow: 0 0 0 7px rgba(232, 196, 90, 0); }
  0%, 100% { box-shadow: 0 0 0 0 rgba(232, 196, 90, 0.6); } }
/* A phone: the same row under the top line, smaller; the chip above the bar. */
.hud.compact .br-grafts { top: calc(${PHONE_TOP_PX}px + var(--safe-top, env(safe-area-inset-top, 0px))); }
.hud.compact .br-grafts .ttl { height: ${PHONE_TITLE_H_PX}px; font-size: 15px; }
.hud.compact .br-grafts .ttl small { font-size: 11px; }
.hud.compact .br-grafts .row { gap: ${PHONE_CARD_GAP_PX}px; }
.hud.compact .br-graft { width: ${PHONE_CARD_W_PX}px; min-height: ${PHONE_CARD_H_PX}px;
  padding: 7px 8px 7px 34px; border-radius: 10px; }
.hud.compact .br-graft:hover { transform: none; }
.hud.compact .br-graft .k { left: 7px; top: 7px; width: 20px; height: 20px; line-height: 20px; font-size: 12px; }
.hud.compact .br-graft .n { font-size: 15px; }
.hud.compact .br-graft .g { font-size: 9.5px; }
.hud.compact .br-graft .t { margin-top: 3px; font-size: 12px; line-height: 1.25; }
.hud.compact .br-graft .d { font-size: 11px; }
.hud.compact .br-grafts .later { margin-top: 5px; padding: 3px 14px; font-size: 12px; }
.hud.compact .br-graft-chip { left: ${CHIP_LEFT_SHARE * 100}%; top: auto; bottom: ${CHIP_BOTTOM_PX}px; }
`;

export interface GraftsHost {
  // The layer the cards are drawn in (the battle royale's own).
  layer: HTMLElement;
  // The HUD's root, whose classes say a phone (compact) and the drop.
  root: HTMLElement;
  // A card picked: the seat's pick sent.
  pick(card: number): void;
  // A notice under the HUD's own clock (ui/royale_hud.ts).
  notice(text: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const offerKey = (o: SnapGraftOffer): string => `${o.g}:${o.c.join(',')}:${o.u}`;

export class RoyaleHudGrafts {
  private readonly style: HTMLStyleElement;
  private readonly box: HTMLElement;
  private readonly row: HTMLElement;
  private readonly chip: HTMLButtonElement;
  private shown: string | null = null;
  // The offer picked here, kept hidden until the snapshot lets it go.
  private picked: string | null = null;
  // Put off with Later, and opened again from the chip, for this offer.
  private putOff: string | null = null;
  private reopened: string | null = null;
  private offer: SnapGraftOffer | null = null;
  private held: readonly string[] | null = null;

  constructor(private readonly host: GraftsHost) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.box = el('div', 'br-grafts');
    this.box.hidden = true;
    const title = el('div', 'ttl', GRAFT_TITLE);
    title.appendChild(el('small', '', GRAFT_SUBTITLE));
    this.row = el('div', 'row');
    const later = el('button', 'later', 'Later');
    later.type = 'button';
    later.title = 'Fold the cards: they wait for you';
    later.addEventListener('click', () => {
      if (!this.offer) return;
      this.putOff = offerKey(this.offer);
      this.reopened = null;
    });
    this.box.append(title, this.row, later);
    this.chip = el('button', 'br-graft-chip');
    this.chip.type = 'button';
    this.chip.hidden = true;
    this.chip.addEventListener('click', () => {
      if (this.offer) this.reopened = offerKey(this.offer);
    });
    host.layer.append(this.box, this.chip);
  }

  // Once per world tick: the snapshot's offer and Grafts, the own champion
  // as the cards read it, and how long since it was last hit (a fight).
  update(r: SnapRoyale, _time: number, me: GraftReader | null, sinceHit: number | null): void {
    this.noteTaken(r.gr ?? []);
    const offer = r.offer ?? null;
    const key = offer ? offerKey(offer) : null;
    if (this.picked !== null && this.picked !== key) this.picked = null;
    this.offer = offer && key !== this.picked ? offer : null;
    if (!this.offer || key === null) {
      setHidden(this.box, true);
      setHidden(this.chip, true);
      this.shown = null;
      return;
    }
    const folded = graftFolded(
      sinceHit,
      r.st === 'drop',
      this.putOff === key,
      this.reopened === key,
    );
    if (this.shown !== key) this.build(this.offer, me);
    setHidden(this.box, folded);
    setHidden(this.chip, !folded);
    if (folded) {
      const text = graftChip();
      if (this.chip.textContent !== text) this.chip.textContent = text;
      const grade = GRADE_COLORS[this.offer.g];
      if (this.chip.style.getPropertyValue('--c') !== grade)
        this.chip.style.setProperty('--c', grade);
    }
  }

  // A key or a tap on card `i`: true when an offer was open to take it.
  pick(i: number): boolean {
    const o = this.offer;
    if (!o || i < 0 || i >= o.c.length) return false;
    this.picked = offerKey(o);
    this.offer = null;
    this.box.hidden = true;
    this.chip.hidden = true;
    this.shown = null;
    this.host.pick(i);
    return true;
  }

  isOpen(): boolean {
    return this.offer !== null;
  }

  private build(offer: SnapGraftOffer, me: GraftReader | null): void {
    this.shown = offerKey(offer);
    this.row.replaceChildren();
    for (const [i, card] of graftCards(offer, me).entries()) {
      const b = el('button', `br-graft ${card.grade}`);
      b.type = 'button';
      b.style.setProperty('--c', GRADE_COLORS[card.grade]);
      b.append(
        el('span', 'k', card.key),
        el('span', 'n', card.name),
        el('span', 'g', `${GRADE_NAMES[card.grade]} · ${GRADE_HINTS[card.grade]}`),
        el('span', 't', card.text),
      );
      if (card.delta) b.appendChild(el('span', 'd', card.delta));
      b.title = `${card.name} (${card.key})`;
      b.addEventListener('click', () => this.pick(i));
      this.row.appendChild(b);
    }
  }

  // A Graft newly held: told once as a notice. The first list heard is
  // what the seat already held (a drop-in takes a bot's Grafts): not news.
  private noteTaken(gr: readonly string[]): void {
    if (this.held === null) {
      this.held = gr;
      return;
    }
    if (gr.length > this.held.length) {
      for (const id of gr.slice(this.held.length)) {
        this.host.notice(`Graft: ${GRAFTS[id]?.name ?? id}`);
      }
    }
    this.held = gr;
  }

  dispose(): void {
    this.box.remove();
    this.chip.remove();
    this.style.remove();
  }
}
