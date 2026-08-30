// The account registry: registration, authentication, renaming, and the
// name index that never gives a name back. Everything survives a reload
// from disk, because a restart must not hand someone else your name.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountRegistry, publicAccount, selfAccount } from '../server/accounts';
import { CLAIM_TTL_MS } from '../server/email_claim';
import { BASE_RATING } from '../server/rating';

const dirs: string[] = [];
function tmpFile(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-accounts-'));
  dirs.push(d);
  return path.join(d, 'accounts.json');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function reg(file = tmpFile()): AccountRegistry {
  return new AccountRegistry(file);
}

// Registration needs an address now (ADR 0007). A test that is not about
// the address takes a distinct one, so it never trips the uniqueness rule
// it was not written to exercise.
let emailSeq = 0;
function anEmail(): string {
  emailSeq += 1;
  return `player${emailSeq}@example.com`;
}

function unwrap<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(`expected ok, got ${String(r.error)}`);
  return r.value;
}

describe('registration', () => {
  it('creates an account at the base rating', () => {
    const a = unwrap(reg().register('Torvald', 'a good password', anEmail(), 100));
    expect(a.id).toBe(1);
    expect(a.name).toBe('Torvald');
    expect(a.rating).toBe(BASE_RATING);
    expect(a.ratedGames).toBe(0);
  });

  it('refuses a name that breaks the rules, and a password that is too short', () => {
    const r = reg();
    expect(r.register('ab', 'a good password', anEmail(), 0)).toEqual({
      ok: false,
      error: 'name_invalid',
    });
    expect(r.register('bob smith', 'a good password', anEmail(), 0)).toEqual({
      ok: false,
      error: 'name_invalid',
    });
    expect(r.register('bobby', 'short', anEmail(), 0)).toEqual({
      ok: false,
      error: 'password_invalid',
    });
  });

  it('refuses a name already taken, however it is dressed', () => {
    const r = reg();
    unwrap(r.register('bob', 'a good password', anEmail(), 0));
    for (const attempt of ['bob', 'Bob', 'BOB', 'b_o_b', 'b-o-b', 'B-o_B']) {
      expect(r.register(attempt, 'another password', anEmail(), 0)).toEqual({
        ok: false,
        error: 'name_taken',
      });
    }
    // A genuinely different name is still free.
    expect(r.register('bob1', 'another password', anEmail(), 0).ok).toBe(true);
  });
});

describe('authentication', () => {
  it('lets an account in with its own password, folded name and all', () => {
    const r = reg();
    const a = unwrap(r.register('Bob', 'a good password', anEmail(), 0));
    expect(r.authenticate('Bob', 'a good password')?.id).toBe(a.id);
    // Typed differently the next day; it is the same name.
    expect(r.authenticate('bob', 'a good password')?.id).toBe(a.id);
    expect(r.authenticate('b_o_b', 'a good password')?.id).toBe(a.id);
  });

  it('refuses the wrong password', () => {
    const r = reg();
    unwrap(r.register('bob', 'a good password', anEmail(), 0));
    expect(r.authenticate('bob', 'the wrong password')).toBeUndefined();
  });

  it('answers the same way for an unknown name as for a wrong password', () => {
    const r = reg();
    unwrap(r.register('bob', 'a good password', anEmail(), 0));
    // Both undefined: the response must not tell an attacker which names exist.
    expect(r.authenticate('nobody', 'a good password')).toBeUndefined();
    expect(r.authenticate('bob', 'wrong')).toBeUndefined();
  });
});

describe('renaming', () => {
  it('changes the displayed name and the login name together', () => {
    const r = reg();
    const a = unwrap(r.register('bob', 'a good password', anEmail(), 0));
    unwrap(r.rename(a.id, 'stella', 10));
    expect(r.findById(a.id)?.name).toBe('stella');
    expect(r.authenticate('stella', 'a good password')?.id).toBe(a.id);
  });

  it('never hands a released name to anyone else', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', anEmail(), 0));
    unwrap(r.rename(bob.id, 'stella', 10));
    // The newcomer cannot inherit the name, nor the reputation on it.
    expect(r.register('bob', 'another password', anEmail(), 20)).toEqual({
      ok: false,
      error: 'name_taken',
    });
    expect(r.register('B-o_B', 'another password', anEmail(), 20)).toEqual({
      ok: false,
      error: 'name_taken',
    });
    expect(r.nameAvailable('bob')).toBe(false);
  });

  it('refuses the old name at the login form, since it is nobody now', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', anEmail(), 0));
    unwrap(r.rename(bob.id, 'stella', 10));
    // The name still points at this account, but it is not its name.
    expect(r.authenticate('bob', 'a good password')).toBeUndefined();
  });

  it('lets an account take back a name it used to hold', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', anEmail(), 0));
    unwrap(r.rename(bob.id, 'stella', 10));
    expect(r.rename(bob.id, 'bob', 20).ok).toBe(true);
    expect(r.authenticate('bob', 'a good password')?.id).toBe(bob.id);
  });

  it('refuses a rename onto somebody else', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', anEmail(), 0));
    unwrap(r.register('carl', 'another password', anEmail(), 0));
    expect(r.rename(bob.id, 'Carl', 10)).toEqual({ ok: false, error: 'name_taken' });
    expect(r.rename(bob.id, 'x', 10)).toEqual({ ok: false, error: 'name_invalid' });
  });
});

describe('ratings', () => {
  it('applies a signed delta and counts the rated game', () => {
    const r = reg();
    const a = unwrap(r.register('bob', 'a good password', anEmail(), 0));
    r.applyRating(a.id, 12);
    r.applyRating(a.id, -5);
    expect(r.findById(a.id)?.rating).toBe(BASE_RATING + 7);
    expect(r.findById(a.id)?.ratedGames).toBe(2);
  });

  it('penalises a leaver without counting a rated game', () => {
    const r = reg();
    const a = unwrap(r.register('bob', 'a good password', anEmail(), 0));
    r.penalize(a.id, 15);
    expect(r.findById(a.id)?.rating).toBe(BASE_RATING - 15);
    // A walk-out must not speed a placement up.
    expect(r.findById(a.id)?.ratedGames).toBe(0);
  });
});

describe('persistence', () => {
  it('reloads accounts, ratings and retired names from disk', () => {
    const file = tmpFile();
    const first = reg(file);
    const bob = unwrap(first.register('bob', 'a good password', anEmail(), 0));
    first.applyRating(bob.id, 20);
    unwrap(first.rename(bob.id, 'stella', 10));

    const second = reg(file);
    expect(second.findById(bob.id)?.name).toBe('stella');
    expect(second.findById(bob.id)?.rating).toBe(BASE_RATING + 20);
    expect(second.authenticate('stella', 'a good password')?.id).toBe(bob.id);
    // A restart must not hand the released name to someone else.
    expect(second.register('bob', 'another password', anEmail(), 20)).toEqual({
      ok: false,
      error: 'name_taken',
    });
    // And the next account still gets a fresh id.
    expect(unwrap(second.register('carl', 'another password', anEmail(), 20)).id).toBe(bob.id + 1);
  });
});

describe('the public shape', () => {
  it('carries no secret at all', () => {
    const a = unwrap(reg().register('bob', 'a good password', 'bob@example.com', 0));
    const pub = publicAccount(a);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(a.password!.hash);
    expect(json).not.toContain(a.password!.salt);
    expect(Object.keys(pub).sort()).toEqual(['createdAt', 'id', 'name', 'ratedGames', 'rating']);
  });

  it('keeps the address out of what other players see, and in what you see', () => {
    const a = unwrap(reg().register('bob', 'a good password', 'bob@example.com', 0));
    // Another player asking about this account learns nothing about the
    // mailbox behind it.
    expect(JSON.stringify(publicAccount(a))).not.toContain('bob@example.com');
    // The owner asking about themselves does.
    const self = selfAccount(a);
    expect(self.email).toBe('bob@example.com');
    expect(self.emailConfirmed).toBe(false);
  });
});

// The claim (ADR 0007): an address is held from registration, which keeps
// ten accounts off one mailbox; an unconfirmed hold lapses after a week,
// which is what stops a squat from being permanent.
describe('email claims', () => {
  it('refuses an address that is not one', () => {
    const r = reg();
    for (const bad of ['', 'nope', 'a@b', 'two @spaces.com', `${'x'.repeat(250)}@example.com`]) {
      expect(r.register('bobby', 'a good password', bad, 0)).toEqual({
        ok: false,
        error: 'email_invalid',
      });
    }
  });

  it('holds the address against everyone else, case and spacing aside', () => {
    const r = reg();
    unwrap(r.register('bob', 'a good password', 'Bob@Example.com', 0));
    for (const same of ['Bob@Example.com', 'bob@example.com', '  BOB@EXAMPLE.COM  ']) {
      expect(r.register(`n${same.length}`, 'another password', same, 100)).toEqual({
        ok: false,
        error: 'email_taken',
      });
    }
    // A genuinely different mailbox is still free. Note that +tags are
    // NOT folded away, deliberately: see server/email_address.ts.
    expect(r.register('carl', 'another password', 'bob+alt@example.com', 100).ok).toBe(true);
  });

  it('releases an unconfirmed address after a week, and keeps the account whole', () => {
    const r = reg();
    const squatter = unwrap(r.register('squatter', 'a good password', 'victim@example.com', 0));
    r.applyRating(squatter.id, 40);
    // A day short of the week, the victim is still locked out.
    expect(
      r.register('victim', 'another password', 'victim@example.com', CLAIM_TTL_MS - 1),
    ).toEqual({ ok: false, error: 'email_taken' });
    // The week is up: the address goes back into circulation.
    const victim = unwrap(
      r.register('victim', 'another password', 'victim@example.com', CLAIM_TTL_MS),
    );
    expect(victim.email?.address).toBe('victim@example.com');
    // The squatter loses the claim and NOTHING else: no deletion here.
    const after = r.findById(squatter.id);
    expect(after?.name).toBe('squatter');
    expect(after?.rating).toBe(BASE_RATING + 40);
    expect(after?.ratedGames).toBe(1);
    expect(after?.email).toBeUndefined();
  });

  it('never releases a confirmed address', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', 'bob@example.com', 0));
    expect(r.confirmEmail(bob.id, 'bob@example.com', 10)).toBe(true);
    // A year later it is still theirs.
    expect(r.register('carl', 'another password', 'bob@example.com', CLAIM_TTL_MS * 52)).toEqual({
      ok: false,
      error: 'email_taken',
    });
    expect(r.purgeExpiredClaims(CLAIM_TTL_MS * 52)).toBe(0);
  });

  it('refuses a confirmation link for an address the account has left', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', 'old@example.com', 0));
    unwrap(r.setEmail(bob.id, 'new@example.com', 10));
    // The link in the old mailbox must not confirm the new address.
    expect(r.confirmEmail(bob.id, 'old@example.com', 20)).toBe(false);
    expect(r.findById(bob.id)?.email?.confirmed).toBe(false);
    expect(r.confirmEmail(bob.id, 'new@example.com', 20)).toBe(true);
  });

  it('starts a changed address unconfirmed, and frees the old one', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', 'old@example.com', 0));
    expect(r.confirmEmail(bob.id, 'old@example.com', 5)).toBe(true);
    unwrap(r.setEmail(bob.id, 'new@example.com', 10));
    // Trust does not travel with the account to a mailbox nobody proved.
    expect(r.findById(bob.id)?.email?.confirmed).toBe(false);
    // And the address they walked away from is somebody else's to take.
    expect(r.register('carl', 'another password', 'old@example.com', 20).ok).toBe(true);
  });

  it('only finds a confirmed address, which is what a reset link needs', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', 'bob@example.com', 0));
    // A mistyped address at signup belongs to a stranger who never asked
    // for it: resetting into their inbox would hand them the account.
    expect(r.findByConfirmedEmail('bob@example.com')).toBeUndefined();
    r.confirmEmail(bob.id, 'bob@example.com', 10);
    expect(r.findByConfirmedEmail('BOB@example.com')?.id).toBe(bob.id);
  });

  it('reloads claims, confirmed and not, from disk', () => {
    const file = tmpFile();
    const first = reg(file);
    const bob = unwrap(first.register('bob', 'a good password', 'bob@example.com', 0));
    const carl = unwrap(first.register('carl', 'another password', 'carl@example.com', 0));
    first.confirmEmail(bob.id, 'bob@example.com', 5);

    const second = reg(file);
    expect(second.findByConfirmedEmail('bob@example.com')?.id).toBe(bob.id);
    // A restart must not release a claim early...
    expect(second.register('mallory', 'a good password', 'carl@example.com', 100)).toEqual({
      ok: false,
      error: 'email_taken',
    });
    // ...nor hold it past its week.
    expect(second.register('mallory', 'a good password', 'carl@example.com', CLAIM_TTL_MS).ok).toBe(
      true,
    );
    expect(second.findById(carl.id)?.email).toBeUndefined();
  });

  // Production has exactly one of these: an account registered before
  // ADR 0007, whose file has no email field at all. It has to keep
  // working, and it has to be able to add an address afterwards.
  it('carries an account that predates addresses, and lets it add one', () => {
    const file = tmpFile();
    const first = reg(file);
    const old = unwrap(first.register('elder', 'a good password', 'elder@example.com', 0));
    // Rewrite the file the way it looked before addresses existed.
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      accounts: Record<string, unknown>[];
      names: [string, number][];
    };
    for (const a of raw.accounts) delete a.email;
    writeFileSync(file, JSON.stringify(raw));

    const second = reg(file);
    const loaded = second.findById(old.id);
    expect(loaded?.email).toBeUndefined();
    // It still plays, still authenticates, still shows up.
    expect(second.authenticate('elder', 'a good password')?.id).toBe(old.id);
    expect(selfAccount(loaded!).email).toBeNull();
    expect(selfAccount(loaded!).emailConfirmed).toBe(false);
    // The address it used to hold is nobody's now, so anyone may take it.
    expect(second.register('newbie', 'another password', 'elder@example.com', 10).ok).toBe(true);
    // And it can claim a fresh one of its own.
    unwrap(second.setEmail(old.id, 'elder-again@example.com', 20));
    expect(second.findById(old.id)?.email?.confirmed).toBe(false);
    expect(second.confirmEmail(old.id, 'elder-again@example.com', 30)).toBe(true);
    expect(second.findByConfirmedEmail('elder-again@example.com')?.id).toBe(old.id);
  });

  it('sets a new password and refuses one that is too short', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', anEmail(), 0));
    expect(r.setPassword(bob.id, 'short')).toBe(false);
    expect(r.setPassword(bob.id, 'a brand new password')).toBe(true);
    expect(r.authenticate('bob', 'a brand new password')?.id).toBe(bob.id);
    expect(r.authenticate('bob', 'a good password')).toBeUndefined();
  });
});
