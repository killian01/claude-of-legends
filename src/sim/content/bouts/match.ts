// What every bout of a Thornfray shares and no kind declares (CONTEXT.md:
// Thornfray, Bout, Final, Bushel; docs/design/thornfray.md): the seats, the
// bouts, the bushels by place, the rising arc, the prize, and the engine's
// version. Planet rules, out of the content fingerprint.

import type { GraftGrade } from '../../royale/types';

// Seats in a Thornfray, Solo, house bots on every seat no person takes.
export const BOUT_SEATS = 8;
// Bouts in a match: five drawn from the pool, then the Final, drawn too.
export const BOUTS = 6;
// The bushels a bout pays by place, first to last.
export const BOUT_BUSHELS: readonly number[] = [5, 4, 3, 2, 1, 0, 0, 0];
// The Final pays every place this many times over.
export const FINAL_FACTOR = 2;
// The rising arc: every seat lands bout k (1 to 6) at this level, its
// points spent by the usual rule, with this many pieces of its own planet
// build.
export const ARC_LEVELS: readonly number[] = [6, 7, 8, 9, 10, 11];
export const ARC_PIECES: readonly number[] = [2, 4, 6, 8, 10, 12];
// The prize: the bout's winner is offered three cards of this grade over
// the next Lull, and the Graft it picks lasts the next bout only ('next')
// or the rest of the match ('all').
export type PrizeLasts = 'next' | 'all';
export const PRIZE_LASTS: PrizeLasts = 'next';
export const PRIZE_GRADE: GraftGrade = 'bough';
// The engine every bout runs on (the seams, the ledger, the shared scorers,
// the brain's bout branch), recorded with each bout: a change to any of it
// moves this, and a bout recorded under another is refused.
export const BOUT_ENGINE_VERSION = 1;
