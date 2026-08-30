// The one short-lived thing a Discord round trip needs, and it is not a
// credential for anything: an unguessable `state` the callback has to
// bring back. Bringing back a state nobody issued is how a forged
// callback is caught, so a state is single use and dies on its first
// redemption whatever the answer.
//
// It does not survive a restart, and that is the difference from
// server/action_tokens.ts: a confirmation link sits in a mailbox for days
// and must outlive a deploy, while a state is minutes old and the player
// is watching. A restart mid-flow costs one click.

import { randomBytes } from 'node:crypto';

// Long enough for a person to read a consent screen, log into Discord,
// and get two-factor out of their phone. Short, because it is the window
// a forged callback would have to land inside.
export const FLOW_TTL_MS = 10 * 60_000;
// A bound on what an unauthenticated caller can make this process hold.
// Oldest out first: a flood costs the flows it floods, never memory.
export const MAX_FLOWS = 5000;

interface DiscordFlow {
  state: string;
  createdAt: number;
}

// 32 bytes, like the mail tokens: these are guessed at rather than looked
// up, so they get more entropy than a session id rather than less.
function randomKey(): string {
  return randomBytes(32).toString('hex');
}

export class DiscordFlows {
  private readonly flows = new Map<string, DiscordFlow>();

  constructor(private readonly gen: () => string = randomKey) {}

  // Opens a round trip and returns the state to put in the URL.
  // Insertion order is age order in a Map, so the oldest is the first
  // key: dropping it is what keeps a flood bounded. This is the whole
  // defence on the request path, which is why start() never sweeps:
  // expiry is enforced on read, and the hourly sweep in server/main.ts is
  // housekeeping rather than correctness.
  start(now: number): string {
    const flow: DiscordFlow = { state: this.gen(), createdAt: now };
    this.flows.set(flow.state, flow);
    while (this.flows.size > MAX_FLOWS) {
      const oldest = this.flows.keys().next();
      if (oldest.done) break;
      this.flows.delete(oldest.value);
    }
    return flow.state;
  }

  // Spends a state: true exactly once, for a state this process issued
  // recently. False for unknown and expired alike, so a caller cannot use
  // the answer to learn that some other flow exists.
  take(state: string, now: number): boolean {
    const flow = this.flows.get(state);
    if (!flow) return false;
    this.flows.delete(state);
    return now - flow.createdAt < FLOW_TTL_MS;
  }

  purge(now: number): number {
    let dropped = 0;
    for (const [state, flow] of this.flows) {
      if (now - flow.createdAt >= FLOW_TTL_MS) {
        this.flows.delete(state);
        dropped++;
      }
    }
    return dropped;
  }

  get flowCount(): number {
    return this.flows.size;
  }
}
