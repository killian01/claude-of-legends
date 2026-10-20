// Where the Lull's card stands (src/ui/lull_model.ts lullBox, drawn by
// src/ui/lull_view.ts), beside tests/royale_cards_room.test.ts: on a phone
// held sideways inside the free column the Respawn wait keeps, clear of
// the thumbs' bar, the globe's column, the bottom 164 px (the notices and
// the touch bar) and, folded, the Graft cards' row; on the desktops played
// at the left, clear of the globe, the top line, the announcements, the
// feed, the drop's seconds and the map, folded above the cards' row too.

import { describe, expect, it } from 'vitest';
import {
  LULL_DESK_LEFT_PX,
  LULL_DESK_TOP_PX,
  LULL_DESK_W_PX,
  LULL_PHONE_HEAD_PX,
  LULL_PHONE_ROW_PX,
  lullBox,
  lullClearOfCards,
  lullDeskHeight,
  lullPhoneHeight,
  PHONE_ROWS,
} from '../src/ui/lull_model';
import { lullCss } from '../src/ui/lull_view';
import { dropChipBox, dropHeadBox } from '../src/ui/royale_cards_room';
import { cardsCoverBox, chipBox } from '../src/ui/royale_grafts';
import { announceBox, feedBox, overlaps, type ScreenBox, spotBox } from '../src/ui/royale_layout';
import {
  RETURN_WASH_PHONE_BOTTOM_PX,
  RETURN_WASH_PHONE_TOP_PX,
  returnWashColumnPx,
  returnWashPhoneBox,
} from '../src/ui/royale_return';
import { touchBarLeftBox } from '../src/ui/touch_bar';

const [PW, PH] = [844, 390];
const DESKS: readonly [number, number][] = [
  [960, 540],
  [1280, 720],
  [1366, 768],
  [1920, 1080],
];

const inside = (b: ScreenBox, w: number, h: number): boolean =>
  b.left >= 0 && b.top >= 0 && b.right <= w && b.bottom <= h;

// The globe's column at the middle of the screen (render/planet_drop.ts):
// past returnWashColumnPx on each side.
const globe = (w: number, h: number): ScreenBox => ({
  left: returnWashColumnPx(w, h),
  top: 0,
  right: w - returnWashColumnPx(w, h),
  bottom: h,
});

describe("the Lull's card on a phone", () => {
  for (const barLeft of [true, false]) {
    it(`stands in the wait's free column, ${barLeft ? 'thumbs' : 'taps'}`, () => {
      const box = lullBox(PW, PH, true, { barLeft });
      const col = returnWashPhoneBox(PW, PH, barLeft);
      expect(box.top).toBe(RETURN_WASH_PHONE_TOP_PX);
      expect(box.right).toBeLessThanOrEqual(col.right);
      expect(box.bottom).toBeLessThanOrEqual(PH - RETURN_WASH_PHONE_BOTTOM_PX);
      expect(inside(box, PW, PH)).toBe(true);
      const near: [string, ScreenBox][] = [
        ['globe', globe(PW, PH)],
        ['the head of the top line', dropHeadBox(PW, true)],
        ['the drop chip', dropChipBox(PW, true)],
        ['the bottom', { left: 0, top: PH - RETURN_WASH_PHONE_BOTTOM_PX, right: PW, bottom: PH }],
        ['the Graft chip', chipBox(PW, PH, true)],
      ];
      if (barLeft) near.push(['the thumbs bar', touchBarLeftBox(PH, 2)]);
      for (const [name, b] of near) expect(overlaps(box, b), name).toBe(false);
      // Room for a name beside the place, the portrait and the bushels.
      expect(box.right - box.left).toBeGreaterThanOrEqual(200);
    });
  }

  it('holds a 40 px head, five rows of 22 px and an 18 px foot', () => {
    expect(LULL_PHONE_HEAD_PX).toBe(40);
    expect(LULL_PHONE_ROW_PX).toBe(22);
    expect(PHONE_ROWS).toBe(5);
    // 168 px of content and its border.
    expect(lullPhoneHeight()).toBe(170);
    expect(lullPhoneHeight()).toBeLessThanOrEqual(
      PH - RETURN_WASH_PHONE_BOTTOM_PX - RETURN_WASH_PHONE_TOP_PX,
    );
  });

  it("folds above the Graft cards' row while they are open", () => {
    const folded = lullBox(PW, PH, true, { barLeft: true, folded: true });
    expect(overlaps(folded, cardsCoverBox(PW, true))).toBe(false);
    expect(lullClearOfCards(PW, PH, true)).toBe(true);
    // Unfolded it would stand under them.
    expect(overlaps(lullBox(PW, PH, true, { barLeft: true }), cardsCoverBox(PW, true))).toBe(true);
  });
});

describe("the Lull's card on a desktop", () => {
  for (const [w, h] of DESKS) {
    it(`stands at the left, clear of its neighbors, at ${w}x${h}`, () => {
      for (const final of [false, true]) {
        const box = lullBox(w, h, false, { final });
        expect(inside(box, w, h)).toBe(true);
        const near: [string, ScreenBox][] = [
          ['globe', globe(w, h)],
          ['the head of the top line', dropHeadBox(w, false)],
          ['the drop chip', dropChipBox(w, false)],
          ['announcement', announceBox(w)],
          ['feed', feedBox(w)],
          ['the Graft chip', chipBox(w, h, false)],
          ['map', { left: w - 180, top: h - 180, right: w - 12, bottom: h - 12 }],
          // The chat's last three lines over its 90 px.
          ['chat', { left: 12, top: h - 90 - 66, right: 312, bottom: h - 90 }],
        ];
        for (const [name, b] of near) expect(overlaps(box, b), `${name}`).toBe(false);
        expect(box.right - box.left).toBeGreaterThanOrEqual(260);
        expect(box.bottom - box.top).toBe(lullDeskHeight(final));
      }
      const folded = lullBox(w, h, false, { folded: true });
      expect(overlaps(folded, cardsCoverBox(w, false))).toBe(false);
      expect(lullClearOfCards(w, h, false)).toBe(true);
    });
  }

  it("waits for the end beat's word, which stands where the card would", () => {
    // The spotlight's call across the middle reaches the card at 960x540:
    // the card comes once the word has gone (ui/royale_hud_bout.ts).
    expect(overlaps(lullBox(960, 540, false), spotBox(960, 540, false))).toBe(true);
  });

  it('is drawn from the same numbers', () => {
    const css = lullCss();
    expect(css).toContain(`left: calc(${LULL_DESK_LEFT_PX}px +`);
    expect(css).toContain(`top: calc(${LULL_DESK_TOP_PX}px +`);
    expect(css).toContain(`min(${LULL_DESK_W_PX}px,`);
    // Folded to its head while the Graft cards are open, the body gone so
    // no empty box stands.
    expect(css).toContain('.hud.br-cards-open .lull :is(');
    expect(css).toContain('display: none; }');
  });
});
