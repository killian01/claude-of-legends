// What stands in front of a match until its first frame is on the canvas.
// The planet holds that frame while its shader programs link
// (render/program_warmup.ts), and a WebGL canvas never drawn on is black:
// the card that was up before the match (the battle royale's joining card)
// stays over it until the renderer says the frame is drawn
// (Renderer.drawn), so nobody looks at a black screen with the HUD over
// it. The wait is bounded, so a renderer that never draws (a lost
// context, a failure) never leaves the card up.

import { WARM_HOLD_MS } from '../render/program_warmup';

// The longest a card waits for the first frame: the planet's hold, and a
// second and a half for the frame after it.
export const FIRST_FRAME_WAIT_MS = WARM_HOLD_MS + 1500;

// Resolves once `drawn` has settled (drawn, or failed), or once `boundMs`
// has passed, whichever comes first; the timer is cleared behind it.
export function untilDrawn(
  drawn: Promise<unknown>,
  boundMs: number,
  later: (run: () => void, ms: number) => () => void,
): Promise<void> {
  return new Promise((done) => {
    let settled = false;
    let cancel: (() => void) | null = null;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      cancel?.();
      done();
    };
    cancel = later(settle, boundMs);
    if (settled) cancel();
    drawn.then(settle, settle);
  });
}
