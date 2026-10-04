// The Graft cards over the battle royale's screen (CONTEXT.md: Graft; ADR
// 0032), mounted by ui/royale_hud.ts: the open offer's three cards, over
// the globe during the drop and over the play view after an event, picked
// by a click, a tap, or the keys 1, 2 and 3 (game/input.ts); a draining
// bar for the seconds left; on a phone in a fight, a pulsing chip "Graft
// 8s" above the bar that a tap opens again. A Graft taken shows as a
// notice. What the cards say and where they stand is ui/royale_grafts.ts.

import type { SnapGraftOffer, SnapRoyale } from '../net/royale_wire';
import { GRAFTS } from '../sim/content/grafts';
import {
  CARD_GAP_PX,
  CHIP_BOTTOM_PX,
  CHIP_LEFT_SHARE,
  CHIP_W_PX,
  DESK_CARD_H_PX,
  DESK_CARD_W_PX,
  DESK_FROM_MIDDLE_PX,
  GRADE_COLORS,
  GRADE_NAMES,
  type GraftReader,
  graftCards,
  graftChip,
  graftFolded,
  graftTimeShare,
  PHONE_CARD_H_PX,
  PHONE_CARD_W_PX,
  PHONE_DROP_BOTTOM_PX,
  PHONE_TOP_PX,
} from './royale_grafts';

const CSS = `
.br-grafts { position: absolute; display: flex; flex-direction: column; gap: ${CARD_GAP_PX}px;
  left: calc(50% + ${DESK_FROM_MIDDLE_PX}px); top: 50%; transform: translateY(-50%);
  pointer-events: none; z-index: 6; }
.br-graft { --c: #e8c45a; --f: 1; position: relative; width: ${DESK_CARD_W_PX}px;
  min-height: ${DESK_CARD_H_PX}px; box-sizing: border-box; padding: 6px 10px 8px 34px;
  border-radius: 10px; border: 1px solid var(--c); background: rgba(8, 10, 20, 0.9);
  color: #ece4c8; text-align: left; font: inherit; cursor: pointer; pointer-events: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), inset 0 0 18px rgba(0, 0, 0, 0.4);
  animation: br-graft-in 0.28s ease-out both; touch-action: manipulation;
  -webkit-tap-highlight-color: transparent; transition: transform 0.12s ease, border-color 0.12s ease; }
.br-graft:hover { transform: translateX(-3px); border-color: #fff3cf; }
.br-graft:nth-child(2) { animation-delay: 0.05s; }
.br-graft:nth-child(3) { animation-delay: 0.1s; }
@keyframes br-graft-in { from { opacity: 0; transform: translateX(14px); } }
.br-graft .k { position: absolute; left: 8px; top: 8px; width: 18px; height: 18px; border-radius: 5px;
  background: var(--c); color: #12100a; font-size: 11px; font-weight: 900; line-height: 18px;
  text-align: center; }
.br-graft .n { display: flex; align-items: baseline; gap: 6px; font-size: 13.5px; font-weight: 800;
  color: #fff3d6; white-space: nowrap; }
.br-graft .g { font-size: 9.5px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;
  color: var(--c); }
.br-graft .t { display: block; margin-top: 2px; font-size: 11.5px; line-height: 1.25; color: #d8ceb0; }
.br-graft .d { display: block; font-size: 10.5px; color: var(--c); }
.br-graft .bar { position: absolute; left: 8px; right: 8px; bottom: 3px; height: 2px; border-radius: 1px;
  background: var(--c); transform-origin: 0 50%; transform: scaleX(var(--f)); opacity: 0.8; }
.br-graft.heartwood { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 16px rgba(185, 138, 240, 0.35); }
.br-graft-chip { position: absolute; left: ${CHIP_LEFT_SHARE * 100}%; bottom: ${CHIP_BOTTOM_PX}px;
  transform: translateX(-50%); width: ${CHIP_W_PX}px; box-sizing: border-box; padding: 5px 10px;
  border-radius: 999px; border: 1px solid var(--c, #e8c45a); background: rgba(8, 10, 20, 0.9);
  color: #fff3d6; font: inherit; font-size: 12.5px; font-weight: 800; text-align: center;
  pointer-events: auto; touch-action: manipulation; z-index: 6;
  animation: br-graft-pulse 1.1s ease-in-out infinite; }
@keyframes br-graft-pulse { 50% { box-shadow: 0 0 0 6px rgba(232, 196, 90, 0); }
  0%, 100% { box-shadow: 0 0 0 0 rgba(232, 196, 90, 0.55); } }
/* A phone: a row under the top line in play, at the foot over the globe. */
.hud.compact .br-grafts { flex-direction: row; left: 50%; top: calc(${PHONE_TOP_PX}px + var(--safe-top, env(safe-area-inset-top, 0px)));
  transform: translateX(-50%); }
.hud.compact.br-dropping .br-grafts { top: auto;
  bottom: calc(${PHONE_DROP_BOTTOM_PX}px + var(--safe-bottom, env(safe-area-inset-bottom, 0px))); }
.hud.compact .br-graft { width: ${PHONE_CARD_W_PX}px; min-height: ${PHONE_CARD_H_PX}px;
  padding: 4px 6px 6px 26px; border-radius: 8px; }
.hud.compact .br-graft:hover { transform: none; }
.hud.compact .br-graft .k { left: 5px; top: 5px; width: 16px; height: 16px; line-height: 16px; font-size: 10px; }
.hud.compact .br-graft .n { font-size: 11.5px; }
.hud.compact .br-graft .g, .hud.compact .br-graft .d { display: none; }
.hud.compact .br-graft .t { font-size: 10px; line-height: 1.2; }
@keyframes br-graft-in-row { from { opacity: 0; transform: translateY(-8px); } }
.hud.compact .br-graft { animation-name: br-graft-in-row; }
.hud:not(.compact) .br-graft-chip { display: none; }
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
  private readonly chip: HTMLButtonElement;
  private shown: string | null = null;
  // The offer picked here, kept hidden until the snapshot lets it go.
  private picked: string | null = null;
  // Opened again by a tap on the chip, for this offer.
  private unfolded: string | null = null;
  private offer: SnapGraftOffer | null = null;
  private held: readonly string[] = [];
  private bars: HTMLElement[] = [];
  private seenAt = 0;

  constructor(private readonly host: GraftsHost) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.box = el('div', 'br-grafts');
    this.box.hidden = true;
    this.chip = el('button', 'br-graft-chip');
    this.chip.type = 'button';
    this.chip.hidden = true;
    this.chip.addEventListener('click', () => {
      if (this.offer) this.unfolded = offerKey(this.offer);
    });
    host.layer.append(this.box, this.chip);
  }

  // Once per world tick: the snapshot's offer and Grafts, the own champion
  // as the cards read it, and how long since it was last hit (a fight).
  update(r: SnapRoyale, time: number, me: GraftReader | null, sinceHit: number | null): void {
    this.noteTaken(r.gr ?? []);
    const offer = r.offer ?? null;
    const key = offer ? offerKey(offer) : null;
    if (this.picked !== null && this.picked !== key) this.picked = null;
    this.offer = offer && key !== this.picked ? offer : null;
    if (!this.offer || key === null) {
      this.box.hidden = true;
      this.chip.hidden = true;
      this.shown = null;
      return;
    }
    const compact = this.host.root.classList.contains('compact');
    const dropping = r.st === 'drop';
    const folded = graftFolded(compact, sinceHit, dropping) && this.unfolded !== key;
    if (this.shown !== key) {
      this.build(this.offer, me);
      this.seenAt = time;
    }
    // The bar drains from the moment the cards first stood here.
    const f = graftTimeShare(this.offer, time, this.offer.u - this.seenAt).toFixed(3);
    for (const b of this.bars) b.style.setProperty('--f', f);
    this.box.hidden = folded;
    this.chip.hidden = !folded;
    if (folded) {
      const text = graftChip(this.offer, time);
      if (this.chip.textContent !== text) this.chip.textContent = text;
      this.chip.style.setProperty('--c', GRADE_COLORS[this.offer.g]);
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
    this.box.replaceChildren();
    this.bars = [];
    for (const [i, card] of graftCards(offer, me).entries()) {
      const b = el('button', `br-graft ${card.grade}`);
      b.type = 'button';
      b.style.setProperty('--c', GRADE_COLORS[card.grade]);
      const name = el('span', 'n', card.name);
      name.appendChild(el('span', 'g', GRADE_NAMES[card.grade]));
      const bar = el('i', 'bar');
      this.bars.push(bar);
      b.append(el('span', 'k', card.key), name, el('span', 't', card.text));
      if (card.delta) b.appendChild(el('span', 'd', card.delta));
      b.appendChild(bar);
      b.title = `${card.name} (${card.key})`;
      b.addEventListener('click', () => this.pick(i));
      this.box.appendChild(b);
    }
  }

  // A Graft newly held: told once as a notice.
  private noteTaken(gr: readonly string[]): void {
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
