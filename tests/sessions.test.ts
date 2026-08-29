// Sessions: rolling expiry, real revocation, and the write discipline
// server/store.ts depends on. The load-bearing test is the last one:
// touching a session must not write, or every request would rewrite the
// whole file synchronously on the thread that steps live matches.

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_TTL_MS, SessionStore, TOUCH_FLUSH_MS } from '../server/sessions';

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-sessions-'));
  dirs.push(d);
  return path.join(d, 'sessions.json');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Deterministic ids, so a test can name the session it just made.
function seqIds(): () => string {
  let n = 0;
  return () => `s${++n}`;
}

describe('session store', () => {
  it('creates a session and resolves it back to its account', () => {
    const store = new SessionStore(tmpFile(), SESSION_TTL_MS, seqIds());
    const s = store.create(7, 1000);
    expect(s.id).toBe('s1');
    expect(store.resolve('s1', 1000)?.accountId).toBe(7);
    expect(store.resolve('nope', 1000)).toBeUndefined();
  });

  it('rolls the window forward on every use', () => {
    const store = new SessionStore(tmpFile(), 1000, seqIds());
    store.create(7, 0);
    store.touch('s1', 900);
    // Without the touch this would be long gone; with it there are 900ms left.
    expect(store.resolve('s1', 1500)?.accountId).toBe(7);
    expect(store.resolve('s1', 1901)).toBeUndefined();
  });

  it('refuses an expired session on read, before any purge sweep', () => {
    const store = new SessionStore(tmpFile(), 1000, seqIds());
    store.create(7, 0);
    expect(store.resolve('s1', 1000)).toBeUndefined();
    expect(store.count).toBe(0);
  });

  it('revokes one session, and every session of an account', () => {
    const store = new SessionStore(tmpFile(), SESSION_TTL_MS, seqIds());
    store.create(7, 0);
    store.create(7, 0);
    store.create(9, 0);
    expect(store.revoke('s1')).toBe(true);
    expect(store.revoke('s1')).toBe(false);
    expect(store.countFor(7)).toBe(1);
    // Playing on someone else's machine: log out everywhere.
    expect(store.revokeAllFor(7)).toBe(1);
    expect(store.countFor(7)).toBe(0);
    // Another account's session is untouched.
    expect(store.resolve('s3', 0)?.accountId).toBe(9);
  });

  it('purges what has outlived the window', () => {
    const store = new SessionStore(tmpFile(), 1000, seqIds());
    store.create(7, 0);
    store.create(8, 5000);
    expect(store.purgeExpired(5000)).toBe(1);
    expect(store.count).toBe(1);
  });

  it('survives a reload from disk', () => {
    const file = tmpFile();
    const store = new SessionStore(file, SESSION_TTL_MS, seqIds());
    store.create(7, 1000);
    const reloaded = new SessionStore(file, SESSION_TTL_MS, seqIds());
    expect(reloaded.resolve('s1', 2000)?.accountId).toBe(7);
  });

  it('does NOT write on touch, so a request never costs a disk write', () => {
    const file = tmpFile();
    const store = new SessionStore(file, SESSION_TTL_MS, seqIds());
    store.create(7, 0);
    const afterCreate = statSync(file).mtimeMs;
    for (let i = 1; i <= 500; i++) store.touch('s1', i);
    expect(statSync(file).mtimeMs).toBe(afterCreate);
    // The extension is real in memory even though disk has not moved.
    expect(store.resolve('s1', 500)?.seenAt).toBe(500);
  });

  it('flushes only once a touch has moved the expiry meaningfully', () => {
    const file = tmpFile();
    const store = new SessionStore(file, SESSION_TTL_MS, seqIds());
    store.create(7, 0);
    store.touch('s1', 10);
    store.flush();
    // A ten-millisecond extension is not worth a whole-file rewrite.
    expect(new SessionStore(file, SESSION_TTL_MS, seqIds()).resolve('s1', 0)?.seenAt).toBe(0);
    store.touch('s1', TOUCH_FLUSH_MS + 10);
    store.flush();
    expect(new SessionStore(file, SESSION_TTL_MS, seqIds()).resolve('s1', 0)?.seenAt).toBe(
      TOUCH_FLUSH_MS + 10,
    );
  });
});
