// What a wrong password costs the next attempt. Password is the only
// credential an account has and there is no recovery (ADR 0006), so this
// module is the other half of what stands between a rating and a
// stranger with a word list.
//
// It slows down, it never locks. A lockout after N failures would let
// anyone bench the top of the ladder on demand by failing logins against
// their name: the protection becomes the attack. A delay cannot be
// weaponised that way, because the victim's own next attempt succeeds as
// soon as they wait it out, and the attacker gains nothing by waiting.
//
// Counted against two keys at once, because each alone has a hole: per
// account stops a word list aimed at one player, per address stops one
// machine sweeping many accounts with the ten most common passwords. The
// caller takes the longer of the two.
//
// In memory, like queueLocks in server/main.ts and for the same reason: a
// restart amnesties everyone, and that is fine. A restart is rare, an
// attacker cannot cause one, and nothing here is worth a disk write.

// Free attempts before any delay: a person mistyping their own password
// should never feel this.
export const FREE_ATTEMPTS = 3;
// Each failure past the free ones doubles the wait, up to the cap.
export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 30_000;
// A key with no failure for this long is forgotten, so the map cannot
// grow one entry per address ever seen.
export const FORGET_AFTER_MS = 60 * 60_000;

interface Failures {
  count: number;
  // When the next attempt on this key is allowed.
  readyAt: number;
  lastAt: number;
}

export class LoginThrottle {
  private readonly byKey = new Map<string, Failures>();

  constructor(
    private readonly freeAttempts: number = FREE_ATTEMPTS,
    private readonly baseDelayMs: number = BASE_DELAY_MS,
    private readonly maxDelayMs: number = MAX_DELAY_MS,
  ) {}

  // How long this key must still wait, 0 when it may try now.
  retryAfterMs(key: string, now: number): number {
    const f = this.byKey.get(key);
    if (!f) return 0;
    return Math.max(0, f.readyAt - now);
  }

  // The wait a caller must honour, given every key an attempt touches.
  // The longest one wins: passing either gate is not enough.
  retryAfterAny(keys: readonly string[], now: number): number {
    let worst = 0;
    for (const key of keys) worst = Math.max(worst, this.retryAfterMs(key, now));
    return worst;
  }

  // One wrong password. Returns the wait now owed on this key.
  recordFailure(key: string, now: number): number {
    const f = this.byKey.get(key) ?? { count: 0, readyAt: now, lastAt: now };
    f.count += 1;
    f.lastAt = now;
    const over = f.count - this.freeAttempts;
    const delay =
      over <= 0 ? 0 : Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.min(over - 1, 20));
    f.readyAt = now + delay;
    this.byKey.set(key, f);
    return delay;
  }

  // A correct password clears the key: the person is who they said, and
  // their next mistake starts from zero again.
  recordSuccess(key: string): void {
    this.byKey.delete(key);
  }

  // Drops keys nobody has failed on for a while. Called on the same sweep
  // that prunes the rest of the server's expiring state.
  purge(now: number, forgetAfterMs: number = FORGET_AFTER_MS): number {
    let dropped = 0;
    for (const [key, f] of this.byKey) {
      if (now - f.lastAt >= forgetAfterMs && f.readyAt <= now) {
        this.byKey.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  get trackedKeys(): number {
    return this.byKey.size;
  }
}

// The two keys one login attempt is counted against.
export function accountKey(foldedName: string): string {
  return `a:${foldedName}`;
}

export function addressKey(address: string): string {
  return `ip:${address}`;
}
