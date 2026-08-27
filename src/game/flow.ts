// Match exit routing: which screen comes after a match, decided from the
// exit action (end screen or escape menu) and the mode the session started
// in. Pure data-in data-out so the client lifecycle is testable; src/main.ts
// executes the step it returns.

export type PostMatchAction = 'menu' | 'again';
export type GameMode = 'practice' | 'queue' | 'create' | 'join' | 'replay';
export type NextStep = 'home' | 'replay' | 'requeue';

// 'again' after practice replays the same offline pick without re-entering
// champion select, and after a replay restarts the same replay; after ANY
// online mode it re-enters the public queue, because a private lobby is
// destroyed with its match and its code has nothing left to join.
export function nextStep(action: PostMatchAction, mode: GameMode): NextStep {
  if (action === 'menu') return 'home';
  return mode === 'practice' || mode === 'replay' ? 'replay' : 'requeue';
}
