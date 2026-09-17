// Match exit routing: which screen comes after a match, decided from the
// exit action (end screen or escape menu) and the mode the session started
// in. Pure data-in data-out so the client lifecycle is testable; src/main.ts
// executes the step it returns.

// 'account' is the end screen's account offer taken (ui/account_offer.ts):
// only a visitor's practice match can send it, and src/main.ts routes it
// to the landing's register tab before this function is asked.
export type PostMatchAction = 'menu' | 'again' | 'account';
export type GameMode =
  | 'practice'
  | 'queue'
  | 'forge-queue'
  | 'create'
  | 'join'
  | 'replay'
  | 'spectate';
export type NextStep = 'home' | 'replay' | 'requeue';

// 'again' after practice replays the same offline pick without re-entering
// champion select; after a replay or a spectate it re-runs the same one;
// after ANY online mode it re-enters the public queue it came from (the
// Forge queue requeues the Forge queue), because a private lobby is
// destroyed with its match and its code has nothing left to join.
export function nextStep(action: PostMatchAction, mode: GameMode): NextStep {
  // An account that somehow took the offer has nothing to sign up for:
  // home, like the menu.
  if (action === 'menu' || action === 'account') return 'home';
  if (mode === 'practice' || mode === 'replay' || mode === 'spectate') return 'replay';
  return 'requeue';
}
