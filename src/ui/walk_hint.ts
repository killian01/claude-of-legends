// How to walk, told to a player whose hands went to W A S D. Here W casts,
// A attack-moves to the cursor, S stops and D is a sigil, so a player who
// walks with those keys elsewhere gets a spell, a lurch, a halt and a dash,
// and no word about the click or the arrows that walk. Until the player has
// given WALK_KNOWN_CLICKS click orders (a walk or an attack), a press of one
// of those keys says how to walk, again on a later press once WALK_HINT_GAP_S
// has passed, at most WALK_HINT_TIMES in a match. One stray click is not
// knowing how to walk: a hand that clicks once and goes back to the keys is
// still told. Pure: the key as input.ts lowers it and the match's wall
// seconds.

export const WALK_KEYS: ReadonlySet<string> = new Set(['w', 'a', 's', 'd']);
// Seconds between two hints, and how many a match shows.
export const WALK_HINT_GAP_S = 8;
export const WALK_HINT_TIMES = 3;
// How many click orders show the player walks by clicking, ending the hint.
export const WALK_KNOWN_CLICKS = 5;
// How long the line stays up, in ms: longer than a plain toast.
export const WALK_HINT_HOLD_MS = 4200;

export function walkHintLine(leftClickMoves: boolean): string {
  const click = leftClickMoves ? 'Click' : 'Right-click';
  return (
    `${click} the ground or hold the arrow keys to walk. ` +
    'Here W casts, A attack-moves, S stops and D is a sigil.'
  );
}

export class WalkHint {
  private clicks = 0;
  private shown = 0;
  private lastAt = Number.NEGATIVE_INFINITY;

  // A click order given: enough of them, and the player knows how to walk.
  clickOrdered(): void {
    this.clicks += 1;
  }

  // A key pressed at `now` (seconds): whether the hint shows for it.
  key(lower: string, now: number): boolean {
    if (this.clicks >= WALK_KNOWN_CLICKS || !WALK_KEYS.has(lower)) return false;
    if (this.shown >= WALK_HINT_TIMES || now - this.lastAt < WALK_HINT_GAP_S) return false;
    this.shown += 1;
    this.lastAt = now;
    return true;
  }
}
