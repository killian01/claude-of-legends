// One match screen's snapshots, played out by a SnapPacer (snap_pacer.ts)
// on a timer of its own: what each online match screen (5v5, the battle
// royale, a Thornfray) puts between its socket and its mirror world.
//
// A snapshot goes in with `snap`; every other message first goes through
// `before`, which lets the held snapshots out when the message must follow
// them (the result, the match's end, the next bout's start). `stop` drops
// what is held and the timer when the screen is done. The clock and the
// timer are handed in, so a test drives them.

import { SnapPacer, waitsForSnaps } from './snap_pacer';

export interface PaceClock {
  now(): number;
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface PacedSnaps<T> {
  // A snapshot for match time `time` (s) has arrived.
  snap(item: T, time: number): void;
  // Another message, of wire type `t`, has arrived and is about to be read.
  before(t: unknown): void;
  // The screen is done: nothing held is let through, the timer ends.
  stop(): void;
  readonly held: number;
}

export function pacedSnaps<T>(apply: (item: T) => void, clock: PaceClock): PacedSnaps<T> {
  let stopped = false;
  const pacer = new SnapPacer<T>((item) => {
    if (!stopped) apply(item);
  });
  let timer: number | null = null;
  const pace = (): void => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    const due = pacer.nextDue();
    if (due === null || stopped) return;
    timer = clock.setTimeout(
      () => {
        timer = null;
        pacer.pump(clock.now());
        pace();
      },
      Math.max(0, due - clock.now()),
    );
  };
  return {
    snap(item, time) {
      if (stopped) return;
      pacer.push(item, time, clock.now());
      pace();
    },
    before(t) {
      if (stopped || typeof t !== 'string' || !waitsForSnaps(t)) return;
      pacer.flush();
      pace();
    },
    stop() {
      stopped = true;
      pacer.clear();
      pace();
    },
    get held() {
      return pacer.held;
    },
  };
}

// The page's own clock and timer.
export const pageClock: PaceClock = {
  now: () => performance.now(),
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};
