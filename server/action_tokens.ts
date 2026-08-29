// One-time links: the one that confirms an email address, and the one that
// sets a forgotten password. Both are bearer credentials sent to a mailbox,
// so they are opaque, single use, and they expire.
//
// Persisted, unlike anything else this short-lived would be, because a
// deploy replaces the container (docs/deploy.md) and every pending link in
// somebody's inbox would die with it. Issuing one is rare, so the write
// discipline server/store.ts asks for is respected.
//
// Issuing replaces: a second reset request invalidates the first link, so
// a mailbox never holds two live ways into the same account.

import { randomBytes } from 'node:crypto';
import { CLAIM_TTL_MS } from './email_claim';
import { loadJson, saveJsonAtomic } from './store';

export type TokenKind = 'confirm' | 'reset';

// A confirmation link lives exactly as long as the claim it confirms:
// a shorter one would strand a held address, a longer one would point at
// a claim that has already been released to someone else.
export const CONFIRM_TTL_MS = CLAIM_TTL_MS;
// A reset link is a live way into an account, so it is short. Long enough
// to survive a slow mail hop and someone reading their mail after lunch.
export const RESET_TTL_MS = 60 * 60_000;

export interface ActionToken {
  token: string;
  kind: TokenKind;
  accountId: number;
  createdAt: number;
  // The address this was sent to. For a confirmation it is also WHAT is
  // being confirmed: the account may have changed its address since, and
  // an old link must not confirm the new one.
  email: string;
}

export function ttlFor(kind: TokenKind): number {
  return kind === 'confirm' ? CONFIRM_TTL_MS : RESET_TTL_MS;
}

// 32 bytes: this is guessed at, not looked up, so it gets more than a
// session id rather than less.
function randomToken(): string {
  return randomBytes(32).toString('hex');
}

export class TokenStore {
  private readonly byToken = new Map<string, ActionToken>();

  constructor(
    private readonly file: string,
    private readonly gen: () => string = randomToken,
  ) {
    for (const t of loadJson<ActionToken[]>(file, [])) this.byToken.set(t.token, t);
  }

  private persist(): void {
    // A broken disk must not break the game: links keep working in memory
    // and the failure is loud in the log.
    try {
      saveJsonAtomic(this.file, [...this.byToken.values()]);
    } catch (err) {
      console.error('token store persist failed', err);
    }
  }

  private expired(t: ActionToken, now: number): boolean {
    return now - t.createdAt >= ttlFor(t.kind);
  }

  // A fresh link, replacing any live one of the same kind for this
  // account. Returns the token to put in the URL.
  issue(kind: TokenKind, accountId: number, email: string, now: number): ActionToken {
    for (const [token, t] of this.byToken) {
      if (t.accountId === accountId && t.kind === kind) this.byToken.delete(token);
    }
    const record: ActionToken = { token: this.gen(), kind, accountId, createdAt: now, email };
    this.byToken.set(record.token, record);
    this.persist();
    return record;
  }

  // Spends a token. Expiry is enforced here rather than only in the sweep,
  // so a link that outlived its window never works. Returns undefined for
  // unknown, expired, and wrong-kind alike: a caller cannot use the answer
  // to learn that some other kind of token by this name exists.
  redeem(token: string, kind: TokenKind, now: number): ActionToken | undefined {
    const t = this.byToken.get(token);
    if (!t) return undefined;
    if (t.kind !== kind || this.expired(t, now)) {
      if (this.expired(t, now)) {
        this.byToken.delete(token);
        this.persist();
      }
      return undefined;
    }
    this.byToken.delete(token);
    this.persist();
    return t;
  }

  // Everything outstanding for an account, dropped: what a password reset
  // does on its way out, so an old link cannot undo a fresh password.
  revokeAllFor(accountId: number): number {
    let dropped = 0;
    for (const [token, t] of this.byToken) {
      if (t.accountId === accountId) {
        this.byToken.delete(token);
        dropped++;
      }
    }
    if (dropped > 0) this.persist();
    return dropped;
  }

  purgeExpired(now: number): number {
    let dropped = 0;
    for (const [token, t] of this.byToken) {
      if (this.expired(t, now)) {
        this.byToken.delete(token);
        dropped++;
      }
    }
    if (dropped > 0) this.persist();
    return dropped;
  }

  get count(): number {
    return this.byToken.size;
  }
}
