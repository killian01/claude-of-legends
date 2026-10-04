// The Graft cards, decided (CONTEXT.md: Graft; ADR 0032): what each of the
// three cards of an open offer says (its key, name, grade and line, and
// for a Sprout what it adds to the own champion now), the seconds left,
// the chip a phone folds them into mid-fight, the key a press picks, the
// names the end card lists, and where the cards and the chip stand on a
// screen, as boxes a test keeps clear of the champion and the controls.
// Pure; ui/royale_hud_grafts.ts draws it.

import type { SnapGraftOffer } from '../net/royale_wire';
import { GRAFTS, graftStacks } from '../sim/content/grafts';
import type { GraftGrade } from '../sim/royale/types';
import { championBox, overlaps, type ScreenBox } from './royale_layout';
import { foldForFight } from './royale_steps';

export const GRADE_NAMES: Readonly<Record<GraftGrade, string>> = {
  sprout: 'Sprout',
  bough: 'Bough',
  heartwood: 'Heartwood',
};

// The grade's color on a card and the chip.
export const GRADE_COLORS: Readonly<Record<GraftGrade, string>> = {
  sprout: '#7ad35a',
  bough: '#e8c45a',
  heartwood: '#b98af0',
};

export interface GraftCardView {
  id: string;
  key: string;
  name: string;
  grade: GraftGrade;
  text: string;
  // What a Sprout adds to the own champion now ("+18 attack damage"),
  // null for anything else or when unknown.
  delta: string | null;
}

// The own champion as the cards read it: its attack damage, its maximum
// health and the Grafts it holds.
export interface GraftReader {
  ad: number;
  maxHp: number;
  grafts: readonly string[];
}

function sproutDelta(id: string, me: GraftReader | null): string | null {
  const stat = GRAFTS[id]?.stat;
  if (!stat || !me) return null;
  // The numbers now carry the stacks held: one more adds the base share.
  const of = (now: number, share: number | undefined): number => {
    if (!share || now <= 0) return 0;
    return (now / (1 + share * graftStacks(me, id))) * share;
  };
  if (stat.ad) {
    const n = Math.round(of(me.ad, stat.ad));
    return n > 0 ? `+${n} attack damage now` : null;
  }
  if (stat.hp) {
    const n = Math.round(of(me.maxHp, stat.hp));
    return n > 0 ? `+${n} health now` : null;
  }
  return null;
}

export function graftCards(offer: SnapGraftOffer, me: GraftReader | null): GraftCardView[] {
  return offer.c.map((id, i) => {
    const def = GRAFTS[id];
    return {
      id,
      key: String(i + 1),
      name: def?.name ?? id,
      grade: def?.grade ?? offer.g,
      text: def?.text ?? '',
      delta: sproutDelta(id, me),
    };
  });
}

// Whole seconds left before card 0 is taken, never under zero.
export function graftSecondsLeft(offer: SnapGraftOffer, time: number): number {
  return Math.max(0, Math.ceil(offer.u - time - 1e-9));
}

// The share of the pick's time left, 1 to 0, for the draining bar.
export function graftTimeShare(offer: SnapGraftOffer, time: number, openFor: number): number {
  if (openFor <= 0) return 0;
  return Math.max(0, Math.min(1, (offer.u - time) / openFor));
}

// The folded chip's words.
export function graftChip(offer: SnapGraftOffer, time: number): string {
  return `Graft ${graftSecondsLeft(offer, time)}s`;
}

// A phone folds the cards into the chip while the champion fights (a hit
// in the last FIGHT_FOLD_S, ui/royale_steps.ts), never over the globe; a
// desktop never folds them.
export function graftFolded(compact: boolean, sinceHit: number | null, dropping: boolean): boolean {
  return !dropping && foldForFight(sinceHit, compact);
}

// The card a key picks: 1, 2 and 3 on the top row or the number pad.
export function cardOfKey(key: string): 0 | 1 | 2 | null {
  return key === '1' ? 0 : key === '2' ? 1 : key === '3' ? 2 : null;
}

// The Grafts as the end card lists them: names in the order taken, a
// Sprout's second stack shown once with x2.
export function graftNames(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, number>();
  for (const id of ids) {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    const name = GRAFTS[id]?.name ?? id;
    if (n === 1) out.push(name);
    else out[out.indexOf(name)] = `${name} x${n}`;
  }
  return out;
}

// Where the cards stand, at interface size 1. A desktop stacks them in a
// column right of the champion, over the globe in the drop as in play. A
// phone sets them in a row: under the top line in play, at the foot of the
// screen over the globe (the bar and the thumbs are hidden in the drop).
export const DESK_CARD_W_PX = 200;
export const DESK_CARD_H_PX = 62;
export const DESK_FROM_MIDDLE_PX = 80;
export const PHONE_CARD_W_PX = 132;
export const PHONE_CARD_H_PX = 48;
export const PHONE_TOP_PX = 54;
export const PHONE_DROP_BOTTOM_PX = 10;
export const CARD_GAP_PX = 6;
// The folded chip on a phone: above the bar, which slides left of the
// middle for the thumbs (ui/hud.ts), where the notices also stand.
export const CHIP_LEFT_SHARE = 0.4;
export const CHIP_BOTTOM_PX = 128;
export const CHIP_W_PX = 112;
export const CHIP_H_PX = 30;

export function cardsBox(
  width: number,
  height: number,
  compact: boolean,
  dropping: boolean,
): ScreenBox {
  if (!compact) {
    const h = 3 * DESK_CARD_H_PX + 2 * CARD_GAP_PX;
    const left = width / 2 + DESK_FROM_MIDDLE_PX;
    return {
      left,
      top: height / 2 - h / 2,
      right: left + DESK_CARD_W_PX,
      bottom: height / 2 + h / 2,
    };
  }
  const w = 3 * PHONE_CARD_W_PX + 2 * CARD_GAP_PX;
  const top = dropping ? height - PHONE_DROP_BOTTOM_PX - PHONE_CARD_H_PX : PHONE_TOP_PX;
  return { left: width / 2 - w / 2, top, right: width / 2 + w / 2, bottom: top + PHONE_CARD_H_PX };
}

export function chipBox(width: number, height: number): ScreenBox {
  const mid = width * CHIP_LEFT_SHARE;
  const bottom = height - CHIP_BOTTOM_PX;
  return { left: mid - CHIP_W_PX / 2, top: bottom - CHIP_H_PX, right: mid + CHIP_W_PX / 2, bottom };
}

// Whether the cards in play keep off the champion on a screen this size.
export function cardsClearOfChampion(width: number, height: number, compact: boolean): boolean {
  return !overlaps(cardsBox(width, height, compact, false), championBox(width, height));
}
