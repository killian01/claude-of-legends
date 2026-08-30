// The two short-lived things a Discord round trip needs, and neither of
// them is a credential for anything.
//
// A FLOW is what was in flight when the browser left for Discord: an
// unguessable `state` the callback has to bring back, remembering whether
// this was a signed-in account linking (an account id) or a visitor
// part-way through signing up (null). Bringing back a state nobody issued
// is how a forged callback is caught, so a flow is single use and dies on
// its first redemption whatever the answer.
//
// A PENDING link is what came back for a visitor who has no account yet:
// Discord said who they are, but there is nothing to attach that to until
// they finish the signup form. It is held under a ticket, the browser
// carries the ticket in a short cookie, and /api/register spends it. The
// ticket proves nothing about the person, only that this browser is the
// one that just came back from Discord.
//
// Neither survives a restart, and that is the difference from
// server/action_tokens.ts: a confirmation link sits in a mailbox for days
// and must outlive a deploy, while both of these are minutes old and the
// player is watching. A restart mid-flow costs one click.

import { randomBytes } from 'node:crypto';
import type { DiscordIdentity } from './discord_oauth';

// Long enough for a person to read a consent screen, log into Discord,
// and get two-factor out of their phone. Short, because it is the window
// a forged callback would have to land inside.
export const FLOW_TTL_MS = 10 * 60_000;
// Long enough to then choose a name, an address and a password.
export const PENDING_TTL_MS = 15 * 60_000;
// A bound on what an unauthenticated caller can make this process hold.
// Oldest out first: a flood costs the flows it floods, never memory.
export const MAX_FLOWS = 5000;
export const MAX_PENDING = 5000;

export interface DiscordFlow {
  state: string;
  // The account that started this, or null for a visitor signing up.
  accountId: number | null;
  createdAt: number;
}

interface PendingLink {
  ticket: string;
  identity: DiscordIdentity;
  createdAt: number;
}

// 32 bytes, like the mail tokens: these are guessed at rather than looked
// up, so they get more entropy than a session id rather than less.
function randomKey(): string {
  return randomBytes(32).toString('hex');
}

export const TICKET_COOKIE = 'loc_discord';

export class DiscordFlows {
  private readonly flows = new Map<string, DiscordFlow>();
  private readonly pending = new Map<string, PendingLink>();

  constructor(private readonly gen: () => string = randomKey) {}

  // Insertion order is age order in a Map, so the oldest is the first
  // key: dropping it is what keeps a flood bounded. This is the whole
  // defence on the request path, which is why neither start() nor hold()
  // sweeps: expiry is enforced on read, and the hourly sweep in
  // server/main.ts is housekeeping rather than correctness.
  private trim<V>(map: Map<string, V>, max: number): void {
    while (map.size > max) {
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  }

  // Opens a round trip and returns the state to put in the URL.
  start(accountId: number | null, now: number): string {
    const flow: DiscordFlow = { state: this.gen(), accountId, createdAt: now };
    this.flows.set(flow.state, flow);
    this.trim(this.flows, MAX_FLOWS);
    return flow.state;
  }

  // Spends a state. Undefined for unknown and expired alike: a caller
  // cannot use the answer to learn that some other flow exists.
  take(state: string, now: number): DiscordFlow | undefined {
    const flow = this.flows.get(state);
    if (!flow) return undefined;
    this.flows.delete(state);
    if (now - flow.createdAt >= FLOW_TTL_MS) return undefined;
    return flow;
  }

  // Parks an identity for a signup that has not happened yet, and returns
  // the ticket the browser carries back to /api/register.
  hold(identity: DiscordIdentity, now: number): string {
    const record: PendingLink = { ticket: this.gen(), identity, createdAt: now };
    this.pending.set(record.ticket, record);
    this.trim(this.pending, MAX_PENDING);
    return record.ticket;
  }

  // What is waiting under this ticket, without spending it. The signup
  // form asks this to say whose Discord it is about to attach, and asking
  // must not consume the answer.
  peek(ticket: string, now: number): DiscordIdentity | undefined {
    const record = this.pending.get(ticket);
    if (!record) return undefined;
    if (now - record.createdAt >= PENDING_TTL_MS) {
      this.pending.delete(ticket);
      return undefined;
    }
    return record.identity;
  }

  // Spends the ticket: registration is the one thing that consumes it, so
  // one round trip through Discord makes exactly one link.
  claim(ticket: string, now: number): DiscordIdentity | undefined {
    const identity = this.peek(ticket, now);
    this.pending.delete(ticket);
    return identity;
  }

  // Drops the ticket without using it, for a signup that failed on its
  // name or its password: the link is offered again rather than silently
  // spent on an account that was never created.
  release(ticket: string): void {
    this.pending.delete(ticket);
  }

  purge(now: number): number {
    let dropped = 0;
    for (const [state, flow] of this.flows) {
      if (now - flow.createdAt >= FLOW_TTL_MS) {
        this.flows.delete(state);
        dropped++;
      }
    }
    for (const [ticket, record] of this.pending) {
      if (now - record.createdAt >= PENDING_TTL_MS) {
        this.pending.delete(ticket);
        dropped++;
      }
    }
    return dropped;
  }

  get flowCount(): number {
    return this.flows.size;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
