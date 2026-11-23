// The online match's snapshots, played out at the pace the server ticked
// them. The server sends one every tick (50 ms), but a far connection
// delivers them unevenly: two at once, then none for a tenth of a second.
// Applied as they came, every moving thing on screen jumped on the pair
// and stood still through the gap, since the frame loop eases between the
// last two snapshots by the time since the newest one arrived.
//
// The pacer holds each snapshot until its turn: its match time, plus the
// quickest any recent snapshot made the trip, plus the spread of the
// trips lately (capped, so a far connection never waits long). A steady
// connection has no spread and waits nothing. A backlog past a few ticks
// (a tab in the background, a long stall) is let through at once.
//
// Display only: the server decides everything, and the own champion is
// drawn ahead of its snapshots anyway (src/net/self_predict.ts). The clock
// is handed in, so a test drives it.

// How many arrivals the spread is read over: three seconds of ticks.
export const PACE_WINDOW = 60;
// The longest a snapshot is held: two ticks.
export const MAX_HOLD_MS = 100;
// More snapshots waiting than this and the oldest go at once.
export const MAX_QUEUED = 6;
// How much sooner, per snapshot, the play-out may come once trips ease.
export const EASE_MS = 1;

interface Held<T> {
  item: T;
  dueAt: number;
}

export class SnapPacer<T> {
  private queue: Held<T>[] = [];
  // Arrival less match time, ms, for the last PACE_WINDOW arrivals.
  private lateness: number[] = [];
  private lastTime = Number.NEGATIVE_INFINITY;
  // Play-out time less match time, ms: the quickest trip plus the hold.
  private playout: number | null = null;

  constructor(private readonly release: (item: T) => void) {}

  // A snapshot arrived at `now` (client ms) for match time `time` (s).
  push(item: T, time: number, now: number): void {
    // A clock that goes back is a new match on this socket: start over.
    if (time <= this.lastTime) this.reset();
    this.lastTime = time;
    const late = now - time * 1000;
    this.lateness.push(late);
    if (this.lateness.length > PACE_WINDOW) this.lateness.shift();
    let quickest = late;
    let slowest = late;
    for (const l of this.lateness) {
      if (l < quickest) quickest = l;
      if (l > slowest) slowest = l;
    }
    const wanted = quickest + Math.min(MAX_HOLD_MS, slowest - quickest);
    this.playout =
      this.playout === null || wanted >= this.playout
        ? wanted
        : Math.max(wanted, this.playout - EASE_MS);
    this.queue.push({ item, dueAt: time * 1000 + this.playout });
    while (this.queue.length > MAX_QUEUED) this.out();
    this.pump(now);
  }

  // Lets through every snapshot whose turn has come by `now`.
  pump(now: number): void {
    while (this.queue.length > 0 && (this.queue[0] as Held<T>).dueAt <= now) this.out();
  }

  // When the next held snapshot is due, or null with none held.
  nextDue(): number | null {
    return this.queue[0]?.dueAt ?? null;
  }

  // Lets every held snapshot through now, in order: before a message that
  // must follow them (the match's end, a new match).
  flush(): void {
    while (this.queue.length > 0) this.out();
  }

  // Forgets the trips measured; what is held stays held.
  reset(): void {
    this.flush();
    this.lateness = [];
    this.playout = null;
    this.lastTime = Number.NEGATIVE_INFINITY;
  }

  // Drops what is held without letting it through: the session is over.
  clear(): void {
    this.queue = [];
  }

  get held(): number {
    return this.queue.length;
  }

  private out(): void {
    const next = this.queue.shift();
    if (next) this.release(next.item);
  }
}

// The messages that do not wait for the held snapshots: what is told
// beside the match's flow (a chat line, the score, a ping, the round-trip
// probe answered at once). Any other message lets the held ones through
// first, so it still lands after them.
const BESIDE = new Set([
  'score',
  'chat',
  'probe',
  'ping',
  'points',
  'afk_warn',
  'welcome',
  'player_left',
  'player_back',
  'player_joined',
]);

export function waitsForSnaps(t: string): boolean {
  return t !== 'snap' && !BESIDE.has(t);
}
