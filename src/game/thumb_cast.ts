// The right thumb's casts (CONTEXT.md: Thumb stick): how a slot under the
// thumb becomes a cast, in the manner of the phone MOBAs. A quick tap
// fires at once at the best target in range, or ahead along the stick,
// or at the caster's own feet; a press that slides aims, the slide's
// direction and length placing the cast inside its range while the range
// is drawn on the ground; sliding back onto the slot before lifting
// cancels. Pure, with no DOM and no sim, pinned by tests/thumb_cast.test.ts;
// touch.ts feeds it, boot.ts turns its answers into the sim's casts.

import type { Vec2 } from '../sim/types';

// A press that has not slid this far, in CSS pixels, is a tap.
export const AIM_DEAD = 14;
// The slide that places the cast at its full range.
export const AIM_REACH = 70;
// How far along the range a quick tap without a target casts.
export const QUICK_SHARE = 0.75;
// The nearest point an aimed cast lands, as a share of the range, so a
// slide just past the dead zone still casts somewhere.
export const AIM_FLOOR = 0.15;

export type SlotPress = 'tap' | 'aimed' | 'cancel';

// The slide on screen: unit direction and how far along the reach, 0..1.
export interface AimSlide {
  x: number;
  y: number;
  k: number;
}

export class ThumbAim {
  private x0 = 0;
  private y0 = 0;
  private x = 0;
  private y = 0;
  private aimed = false;

  start(x: number, y: number): void {
    this.x0 = x;
    this.y0 = y;
    this.x = x;
    this.y = y;
    this.aimed = false;
  }

  // The slide, or null inside the dead zone. Once the thumb has been out,
  // the press is an aim for good: back inside, it is a cancel in waiting.
  move(x: number, y: number): AimSlide | null {
    this.x = x;
    this.y = y;
    const dx = x - this.x0;
    const dy = y - this.y0;
    const d = Math.hypot(dx, dy);
    if (d < AIM_DEAD) return null;
    this.aimed = true;
    return { x: dx / d, y: dy / d, k: Math.min(1, (d - AIM_DEAD) / (AIM_REACH - AIM_DEAD)) };
  }

  get hasAimed(): boolean {
    return this.aimed;
  }

  release(): SlotPress {
    if (!this.aimed) return 'tap';
    return Math.hypot(this.x - this.x0, this.y - this.y0) < AIM_DEAD ? 'cancel' : 'aimed';
  }
}

// The point a slide names: along the world direction, at the slide's
// share of the range, never past it and never on the caster's own feet.
export function aimedPoint(self: Vec2, dir: Vec2, k: number, range: number): Vec2 {
  const d = range * Math.max(AIM_FLOOR, Math.min(1, k));
  return { x: self.x + dir.x * d, z: self.z + dir.z * d };
}

// The point a quick tap names: the target when there is one, else a way
// ahead along the facing (the stick's direction), else the caster's feet,
// which is where a cast centered on the caster belongs.
export function quickPoint(
  self: Vec2,
  target: Vec2 | null,
  facing: Vec2 | null,
  range: number,
): Vec2 {
  if (target) return { x: target.x, z: target.z };
  if (facing) {
    return {
      x: self.x + facing.x * range * QUICK_SHARE,
      z: self.z + facing.z * range * QUICK_SHARE,
    };
  }
  return { x: self.x, z: self.z };
}
