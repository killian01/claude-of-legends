// The one-time links. Both are bearer credentials sent to a mailbox, so
// what is pinned here is that they are single use, that they expire, and
// that issuing one puts out the one before it.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIRM_TTL_MS, RESET_TTL_MS, TokenStore, ttlFor } from '../server/action_tokens';

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-tokens-'));
  dirs.push(d);
  return path.join(d, 'tokens.json');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Predictable ids, so a test can name the token it wants to spend.
function counted(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `t${n}`;
  };
}

describe('issuing and spending', () => {
  it('spends a token exactly once', () => {
    const s = new TokenStore(tmpFile(), counted());
    const t = s.issue('confirm', 7, 'bob@example.com', 0);
    const first = s.redeem(t.token, 'confirm', 100);
    expect(first?.accountId).toBe(7);
    expect(first?.email).toBe('bob@example.com');
    // A link forwarded, or a mail client prefetching it, must not work twice.
    expect(s.redeem(t.token, 'confirm', 100)).toBeUndefined();
    expect(s.count).toBe(0);
  });

  it('refuses a token of the other kind, without saying so', () => {
    const s = new TokenStore(tmpFile(), counted());
    const t = s.issue('reset', 7, 'bob@example.com', 0);
    // Same answer as an unknown token: a caller cannot learn that some
    // other kind of token by this name exists.
    expect(s.redeem(t.token, 'confirm', 0)).toBeUndefined();
    expect(s.redeem('never issued', 'reset', 0)).toBeUndefined();
    // And the real one still works: the wrong-kind attempt did not eat it.
    expect(s.redeem(t.token, 'reset', 0)?.accountId).toBe(7);
  });

  it('expires each kind on its own clock', () => {
    const s = new TokenStore(tmpFile(), counted());
    expect(ttlFor('confirm')).toBe(CONFIRM_TTL_MS);
    expect(ttlFor('reset')).toBe(RESET_TTL_MS);
    // A reset link is a live way into an account, so it is the short one.
    expect(RESET_TTL_MS).toBeLessThan(CONFIRM_TTL_MS);

    const reset = s.issue('reset', 1, 'a@example.com', 0);
    expect(s.redeem(reset.token, 'reset', RESET_TTL_MS - 1)?.accountId).toBe(1);

    const confirm = s.issue('confirm', 2, 'b@example.com', 0);
    expect(s.redeem(confirm.token, 'confirm', CONFIRM_TTL_MS)).toBeUndefined();
  });

  it('puts out the previous link of the same kind for that account', () => {
    const s = new TokenStore(tmpFile(), counted());
    const first = s.issue('reset', 7, 'bob@example.com', 0);
    const second = s.issue('reset', 7, 'bob@example.com', 10);
    // A mailbox must never hold two live ways into one account.
    expect(s.redeem(first.token, 'reset', 20)).toBeUndefined();
    expect(s.redeem(second.token, 'reset', 20)?.accountId).toBe(7);
  });

  it('leaves other accounts and other kinds alone when it does', () => {
    const s = new TokenStore(tmpFile(), counted());
    const mine = s.issue('confirm', 7, 'bob@example.com', 0);
    const theirs = s.issue('reset', 8, 'carl@example.com', 0);
    s.issue('confirm', 7, 'bob@example.com', 10);
    expect(s.redeem(mine.token, 'confirm', 20)).toBeUndefined();
    expect(s.redeem(theirs.token, 'reset', 20)?.accountId).toBe(8);
  });
});

describe('revoking and sweeping', () => {
  it('drops everything outstanding for one account', () => {
    const s = new TokenStore(tmpFile(), counted());
    const confirm = s.issue('confirm', 7, 'bob@example.com', 0);
    const reset = s.issue('reset', 7, 'bob@example.com', 0);
    const other = s.issue('reset', 8, 'carl@example.com', 0);
    // What a completed password reset does on its way out: an old link
    // must not be able to undo a fresh password.
    expect(s.revokeAllFor(7)).toBe(2);
    expect(s.redeem(confirm.token, 'confirm', 0)).toBeUndefined();
    expect(s.redeem(reset.token, 'reset', 0)).toBeUndefined();
    expect(s.redeem(other.token, 'reset', 0)?.accountId).toBe(8);
  });

  it('sweeps only what has actually expired', () => {
    const s = new TokenStore(tmpFile(), counted());
    s.issue('reset', 1, 'a@example.com', 0);
    const confirm = s.issue('confirm', 2, 'b@example.com', 0);
    expect(s.purgeExpired(RESET_TTL_MS)).toBe(1);
    expect(s.redeem(confirm.token, 'confirm', RESET_TTL_MS)?.accountId).toBe(2);
  });
});

describe('persistence', () => {
  it('survives the restart a deploy causes', () => {
    const file = tmpFile();
    const first = new TokenStore(file, counted());
    const t = first.issue('confirm', 7, 'bob@example.com', 0);
    // A deploy replaces the container; the link in somebody's inbox must
    // not die with it (docs/deploy.md).
    const second = new TokenStore(file, counted());
    expect(second.redeem(t.token, 'confirm', 100)?.accountId).toBe(7);
    // And spending it stays spent across another restart.
    expect(new TokenStore(file, counted()).redeem(t.token, 'confirm', 100)).toBeUndefined();
  });
});
