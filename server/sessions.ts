// Sessions, server-side. The cookie carries an opaque id and nothing
// else, so a session can actually be revoked (ADR 0006): a signed
// stateless cookie would be valid for its whole life whatever we learn
// about it afterwards.
//
// Rolling: every use pushes the expiry back, so a regular player never
// meets the login screen again, and a session nobody has used for the
// window dies on its own.
//
// The write discipline matters. server/store.ts states that writes are
// rare, and saveJsonAtomic rewrites the whole file synchronously on the
// thread that steps live matches at 20 Hz. Creating and revoking a
// session are rare and are written through. Touching one is not rare, it
// happens on every request, so it only moves a number in memory; the
// flush that follows is on a timer and at shutdown. The cost of that
// choice is bounded and known: a hard kill loses at most one interval of
// expiry extensions, which costs a player nothing but an earlier login.

import { randomBytes } from 'node:crypto';
import { loadJson, saveJsonAtomic } from './store';

export interface SessionRecord {
  id: string;
  accountId: number;
  createdAt: number;
  // Last request that used it; expiry is measured from here.
  seenAt: number;
}

// Long enough that a player who plays every few weeks stays logged in,
// short enough that a forgotten session on a shared machine dies.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
// How much idle time a touch must add before it is worth persisting on
// the next flush. Below this the in-memory value is close enough.
export const TOUCH_FLUSH_MS = 60 * 60_000;
export const COOKIE_NAME = 'loc_session';

// 24 bytes of crypto randomness: not guessable, and short enough to sit
// in a cookie without thought.
function randomId(): string {
  return randomBytes(24).toString('hex');
}

export class SessionStore {
  private readonly byId = new Map<string, SessionRecord>();
  // Set when a touch has moved a seenAt that disk does not know about.
  private dirty = false;

  constructor(
    private readonly file: string,
    private readonly ttlMs: number = SESSION_TTL_MS,
    private readonly idGen: () => string = randomId,
  ) {
    for (const s of loadJson<SessionRecord[]>(file, [])) this.byId.set(s.id, s);
  }

  private persist(): void {
    // A broken disk must not break the game: sessions keep working in
    // memory and the failure is loud in the log.
    try {
      saveJsonAtomic(this.file, [...this.byId.values()]);
      this.dirty = false;
    } catch (err) {
      console.error('session store persist failed', err);
    }
  }

  private expired(s: SessionRecord, now: number): boolean {
    return now - s.seenAt >= this.ttlMs;
  }

  // A new login. Written through: losing a session a player just opened
  // would send them straight back to the login screen.
  create(accountId: number, now: number): SessionRecord {
    const session: SessionRecord = {
      id: this.idGen(),
      accountId,
      createdAt: now,
      seenAt: now,
    };
    this.byId.set(session.id, session);
    this.persist();
    return session;
  }

  // The cookie's id to an account, or undefined. Expiry is enforced on
  // read, so a session that outlived its window never resolves even if
  // the purge sweep has not reached it yet.
  resolve(id: string, now: number): SessionRecord | undefined {
    const s = this.byId.get(id);
    if (!s) return undefined;
    if (this.expired(s, now)) {
      this.byId.delete(s.id);
      this.persist();
      return undefined;
    }
    return s;
  }

  // One use of a live session. Memory only, by design: this runs on every
  // request and the tick loop pays for every synchronous write.
  touch(id: string, now: number): void {
    const s = this.byId.get(id);
    if (!s) return;
    if (now - s.seenAt >= TOUCH_FLUSH_MS) this.dirty = true;
    s.seenAt = now;
  }

  // Writes the extensions that touch() only made in memory. Cheap when
  // nothing moved far enough to matter.
  flush(): void {
    if (this.dirty) this.persist();
  }

  // Logging out on this machine.
  revoke(id: string): boolean {
    if (!this.byId.delete(id)) return false;
    this.persist();
    return true;
  }

  // Logging out everywhere: what a player reaches for after playing on
  // someone else's machine. The whole point of storing sessions.
  revokeAllFor(accountId: number): number {
    let dropped = 0;
    for (const [id, s] of this.byId) {
      if (s.accountId === accountId) {
        this.byId.delete(id);
        dropped++;
      }
    }
    if (dropped > 0) this.persist();
    return dropped;
  }

  // Drops what has outlived the window. Returns how many, for the log.
  purgeExpired(now: number): number {
    let dropped = 0;
    for (const [id, s] of this.byId) {
      if (this.expired(s, now)) {
        this.byId.delete(id);
        dropped++;
      }
    }
    if (dropped > 0) this.persist();
    return dropped;
  }

  countFor(accountId: number): number {
    let n = 0;
    for (const s of this.byId.values()) if (s.accountId === accountId) n++;
    return n;
  }

  get count(): number {
    return this.byId.size;
  }
}
