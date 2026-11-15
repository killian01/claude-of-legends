// Match exit routing: which screen comes after a match, decided from the
// exit action (end screen or escape menu) and the mode the session started
// in. Pure data-in data-out so the client lifecycle is testable; src/main.ts
// executes the step it returns.

// 'other' is the battle royale's end screen offering its other rule set
// (Try One life, Try Respawn): only a battle royale sends it, and its own
// loop reads it (game/royale_flow.ts).
export type PostMatchAction = 'menu' | 'again' | 'other';
export type GameMode =
  | 'practice'
  | 'queue'
  | 'forge-queue'
  | 'create'
  | 'join'
  | 'replay'
  | 'spectate'
  | 'royale'
  | 'thornfray';
export type NextStep = 'home' | 'replay' | 'requeue' | 'lobby';

// What an online session (src/main.ts runOnline) ends with: the exit, and
// the code of the private lobby it belongs to (ADR 0036), the one its
// match came from (match_start.lobby) or the one whose party queue it
// left, else null.
export interface OnlineEnd {
  action: PostMatchAction;
  lobby: string | null;
}

// 'again' after practice replays the same offline pick; after a replay or
// a spectate it re-runs the same one. After a match whose private lobby
// lives on (ADR 0036), its own match or a party it queued, 'again' goes
// back into that lobby: `lobby` is its code, and a lobby match taken back
// after a reload arrives through a queue session, so 'queue' counts too.
// After any other online match it re-enters the public queue it came from
// (the Forge queue requeues the Forge queue).
// A battle royale runs its own loop, Play again and the other rule set
// included (game/royale_flow.ts), and so does a Thornfray
// (game/thornfray_flow.ts): each is asked here only once it is over, and
// goes home, whatever ended it.
export function nextStep(
  action: PostMatchAction,
  mode: GameMode,
  lobby: string | null = null,
): NextStep {
  // 'other' outside a battle royale has nothing to switch to.
  if (action === 'menu' || action === 'other') return 'home';
  if (mode === 'royale' || mode === 'thornfray') return 'home';
  if (mode === 'practice' || mode === 'replay' || mode === 'spectate') return 'replay';
  if (lobby !== null && (mode === 'create' || mode === 'join' || mode === 'queue')) return 'lobby';
  return 'requeue';
}
