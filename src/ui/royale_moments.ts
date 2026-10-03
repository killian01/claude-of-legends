// The battle royale's loud moments (CONTEXT.md: Clamor, Ablaze): what the
// HUD calls out off the mode's notes, decided without the DOM. Pure: the
// notes of a snapshot and the viewer in, the calls out, each a line, a
// sound and how loud. The HUD plays what it is given
// (src/ui/royale_hud.ts); no call is made yet.

import type { RoyaleNote } from '../net/royale_client';

// One call: what to show, what to play, and how big.
export interface MomentCall {
  text: string;
  sfx?: string;
  voice?: string;
  big?: boolean;
}

// The calls a snapshot's notes make for this viewer.
export function momentCalls(_notes: readonly RoyaleNote[], _selfId: number): MomentCall[] {
  return [];
}
