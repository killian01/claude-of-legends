// Edge rate limit on the meta API (plan-forge phase 8): requests per
// player address per minute, across every /api route. The login throttle
// (server/login_throttle.ts) still owns credential guessing with its own
// backoff; this is the blanket over everything else, sized so no human
// clicking through screens ever meets it, only a script hammering the
// Forge or gallery surfaces. Keyed on the player address (server/edge.ts),
// like the socket cap in server/conn_limit.ts.

export const API_RATE_PER_MIN = 120;
const WINDOW_MS = 60_000;

export class ApiLimiter {
  // Timestamps of this window's requests per address, pruned on touch.
  private readonly hits = new Map<string, number[]>();

  // A limit of zero or less switches the limiter off.
  constructor(private readonly limit: number = API_RATE_PER_MIN) {}

  allow(address: string, now: number): boolean {
    if (this.limit <= 0) return true;
    const cut = now - WINDOW_MS;
    const list = (this.hits.get(address) ?? []).filter((t) => t > cut);
    if (list.length >= this.limit) {
      this.hits.set(address, list);
      return false;
    }
    list.push(now);
    this.hits.set(address, list);
    return true;
  }

  // Housekeeping: an address with no request this window is forgotten, or
  // the map grows one entry per address ever seen.
  purge(now: number): void {
    const cut = now - WINDOW_MS;
    for (const [address, list] of this.hits) {
      if (list.every((t) => t <= cut)) this.hits.delete(address);
    }
  }

  get trackedAddresses(): number {
    return this.hits.size;
  }
}
