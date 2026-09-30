// The Move ring (CONTEXT.md: Thumb stick): a ghost of the stick drawn where
// the left thumb goes, low on the left, with the word Move in it. The stick
// draws nothing until a thumb lands on it (ui/thumb_stick_view.ts), and the
// walk through a phone's first match found that a first-timer never learned
// the left thumb was a stick: the one line saying so faded under the
// opening shop. So the first MOVE_RING_MATCHES matches played with the
// thumb controls on this device show the ring (the settings keep the
// count), and it fades the first time the stick is used.
//
// Pure, pinned by tests/move_ring.test.ts; boot.ts decides, the stick's
// view draws it.

import { inStickZone, type Viewport } from './thumb_stick';

export const MOVE_RING_MATCHES = 2;

// Where the ring sits: its middle's distance from the left and the bottom
// edges of the screen (inside the safe area), and its radius, in CSS
// pixels. Inside the stick's zone on every phone held sideways, and right
// of the touch bar's column on the left edge (ui/touch_bar.ts, about 70 px
// wide with its margin), so the two never cross whatever the phone's height.
export const MOVE_RING = { left: 130, bottom: 100, r: 56 } as const;

// stick: the thumb controls are on (a touchscreen with the stick scheme).
// playing: a person plays the seat (not a replay's viewer, not a coach
// watching a bot). shownIn: the matches the ring has been drawn in.
export function moveRingWanted(stick: boolean, playing: boolean, shownIn: number): boolean {
  return stick && playing && shownIn < MOVE_RING_MATCHES;
}

// The ring's middle on a screen this size, with no safe area.
export function moveRingCenter(viewport: Viewport): { x: number; y: number } {
  return { x: MOVE_RING.left, y: viewport.height - MOVE_RING.bottom };
}

// Whether a thumb put anywhere on the ring lands in the stick's zone.
export function moveRingInStickZone(viewport: Viewport): boolean {
  const c = moveRingCenter(viewport);
  const r = MOVE_RING.r;
  return [
    [c.x, c.y],
    [c.x + r, c.y],
    [c.x - r, c.y],
    [c.x, c.y - r],
    [c.x, c.y + r],
  ].every(([x, y]) => inStickZone(x!, y!, viewport));
}
