// Match exit routing: which screen comes after a match, decided from the
// exit action (end screen or escape menu) and the mode the session started
// in. Pure data-in data-out so the client lifecycle is testable; src/main.ts
// executes the step it returns.

// 'account' is the end screen's account offer taken (ui/account_offer.ts):
// only a visitor's practice match can send it, and src/main.ts routes it
// to the landing's register tab before this function is asked. 'other' is
// the battle royale's end screen offering its other rule set (Try One
// life, Try Respawn): only a battle royale sends it, and its own loop reads
// it (game/royale_flow.ts).
export type PostMatchAction = 'menu' | 'again' | 'account' | 'other';
export type GameMode =
  | 'practice'
  | 'queue'
  | 'forge-queue'
  | 'create'
  | 'join'
  | 'replay'
  | 'spectate'
  | 'royale';
export type NextStep = 'home' | 'replay' | 'requeue';

// 'again' after practice replays the same offline pick without re-entering
// champion select; after a replay or a spectate it re-runs the same one;
// after ANY online mode it re-enters the public queue it came from (the
// Forge queue requeues the Forge queue), because a private lobby is
// destroyed with its match and its code has nothing left to join.
// A battle royale runs its own loop, Play again and the other rule set
// included (game/royale_flow.ts), and is asked here only once it is over:
// home, whatever ended it.
export function nextStep(action: PostMatchAction, mode: GameMode): NextStep {
  // An account that somehow took the offer has nothing to sign up for:
  // home, like the menu. 'other' outside a battle royale has nothing to
  // switch to.
  if (action === 'menu' || action === 'account' || action === 'other') return 'home';
  if (mode === 'royale') return 'home';
  if (mode === 'practice' || mode === 'replay' || mode === 'spectate') return 'replay';
  return 'requeue';
}
