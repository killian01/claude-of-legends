// The Graft cards, decided (CONTEXT.md: Graft; ADR 0032): what each of the
// three cards of an open offer says (its key, name, grade, what the grade
// does, its line, and for a Sprout what it adds to the own champion now),
// the title over them, when they fold into the chip (put off, a fight, or
// the first seconds after landing),
// the key a press picks, the names the end card lists, and where the cards
// and the chip stand on a screen, as boxes a test checks. The offer never
// runs out. Pure; ui/royale_hud_grafts.ts draws it.

import type { SnapGraftOffer } from '../net/royale_wire';
import { GRAFTS, graftStacks } from '../sim/content/grafts';
import type { GraftGrade } from '../sim/royale/types';
import { championBox, type ScreenBox } from './royale_layout';
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

// The cards' title, and what each grade does, in words a newcomer reads
// (the maintainer, 2026-10-04: "on comprend pas").
export const GRAFT_TITLE = 'Choose a Graft';
export const GRAFT_SUBTITLE = 'A power for the rest of this match. Take your time.';
export const GRADE_HINTS: Readonly<Record<GraftGrade, string>> = {
  sprout: 'Stat boost, stacks twice',
  bough: 'Changes a rule',
  heartwood: 'Changes your spells',
};

// The folded chip's words: the cards wait, with no time limit.
export function graftChip(): string {
  return GRAFT_TITLE;
}

// The cards wait this long after the champion lands, folded into the chip:
// the first seconds are for the fight and the caches. Open, they covered
// the top third of a desktop and half a phone, over the first fight.
export const GRAFT_SETTLE_S = 12;

// Whether the cards fold into the chip: never over the globe in the drop;
// otherwise when the person put them off (Later), is in a fight (a hit in
// the last FIGHT_FOLD_S), landed less than GRAFT_SETTLE_S ago, or waits
// to come back in Respawn (`waiting`: the death wash's lines and the globe
// of where to come back are the wait's, and the cards open over the top
// third of a desktop and half a phone covered them), on a phone as on a
// desktop, unless they opened them again from the chip. The offer never
// runs out, so folding costs nothing but the look.
export function graftFolded(
  sinceHit: number | null,
  dropping: boolean,
  putOff: boolean,
  reopened: boolean,
  sinceLanding: number | null,
  waiting = false,
): boolean {
  if (dropping || reopened) return false;
  const settling = sinceLanding !== null && sinceLanding < GRAFT_SETTLE_S;
  return putOff || waiting || foldForFight(sinceHit, true) || settling;
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

// Where the cards stand, at interface size 1: a row of three big cards
// across the top of the view, under the top line, the title above them,
// so the world and the champion's body stay in sight below (the
// maintainer: "faut quand meme qu'on voit le jeu"). A phone uses the same
// row, smaller.
export const DESK_CARD_W_PX = 248;
export const DESK_CARD_H_PX = 132;
export const DESK_TOP_PX = 96;
export const PHONE_CARD_W_PX = 240;
export const PHONE_CARD_H_PX = 104;
export const PHONE_TOP_PX = 54;
export const TITLE_H_PX = 30;
export const PHONE_TITLE_H_PX = 22;
export const CARD_GAP_PX = 12;
export const PHONE_CARD_GAP_PX = 8;
// The folded chip: under the top line on a desktop; on a phone above the
// bar, which slides left of the middle for the thumbs (ui/hud.ts).
export const DESK_CHIP_TOP_PX = 96;
export const CHIP_LEFT_SHARE = 0.4;
export const CHIP_BOTTOM_PX = 128;
export const CHIP_W_PX = 150;
export const CHIP_H_PX = 30;

export function cardsBox(width: number, compact: boolean): ScreenBox {
  const w = compact ? PHONE_CARD_W_PX : DESK_CARD_W_PX;
  const h = compact ? PHONE_CARD_H_PX : DESK_CARD_H_PX;
  const gap = compact ? PHONE_CARD_GAP_PX : CARD_GAP_PX;
  const top = (compact ? PHONE_TOP_PX : DESK_TOP_PX) + (compact ? PHONE_TITLE_H_PX : TITLE_H_PX);
  const row = 3 * w + 2 * gap;
  return { left: width / 2 - row / 2, top, right: width / 2 + row / 2, bottom: top + h };
}

export function chipBox(width: number, height: number, compact: boolean): ScreenBox {
  if (!compact) {
    return {
      left: width / 2 - CHIP_W_PX / 2,
      top: DESK_CHIP_TOP_PX,
      right: width / 2 + CHIP_W_PX / 2,
      bottom: DESK_CHIP_TOP_PX + CHIP_H_PX,
    };
  }
  const mid = width * CHIP_LEFT_SHARE;
  const bottom = height - CHIP_BOTTOM_PX;
  return { left: mid - CHIP_W_PX / 2, top: bottom - CHIP_H_PX, right: mid + CHIP_W_PX / 2, bottom };
}

// Whether the champion's body stays in sight under the cards: the row ends
// above the middle of the screen, where the camera holds the champion.
export function cardsLeaveChampionInSight(
  width: number,
  height: number,
  compact: boolean,
): boolean {
  return cardsBox(width, compact).bottom <= championBox(width, height).bottom - 30;
}
