// The account registry: registration, authentication, renaming, and the
// name index that never gives a name back. Everything survives a reload
// from disk, because a restart must not hand someone else your name.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountRegistry, publicAccount } from '../server/accounts';
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

function unwrap<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(`expected ok, got ${String(r.error)}`);
  return r.value;
}

describe('registration', () => {
  it('creates an account at the base rating', () => {
    const a = unwrap(reg().register('Torvald', 'a good password', 100));
    expect(a.id).toBe(1);
    expect(a.name).toBe('Torvald');
    expect(a.rating).toBe(BASE_RATING);
    expect(a.ratedGames).toBe(0);
  });

  it('refuses a name that breaks the rules, and a password that is too short', () => {
    const r = reg();
    expect(r.register('ab', 'a good password', 0)).toEqual({ ok: false, error: 'name_invalid' });
    expect(r.register('bob smith', 'a good password', 0)).toEqual({
      ok: false,
      error: 'name_invalid',
    });
    expect(r.register('bobby', 'short', 0)).toEqual({ ok: false, error: 'password_invalid' });
  });

  it('refuses a name already taken, however it is dressed', () => {
    const r = reg();
    unwrap(r.register('bob', 'a good password', 0));
    for (const attempt of ['bob', 'Bob', 'BOB', 'b_o_b', 'b-o-b', 'B-o_B']) {
      expect(r.register(attempt, 'another password', 0)).toEqual({
        ok: false,
        error: 'name_taken',
      });
    }
    // A genuinely different name is still free.
    expect(r.register('bob1', 'another password', 0).ok).toBe(true);
  });
});

describe('authentication', () => {
  it('lets an account in with its own password, folded name and all', () => {
    const r = reg();
    const a = unwrap(r.register('Bob', 'a good password', 0));
    expect(r.authenticate('Bob', 'a good password')?.id).toBe(a.id);
    // Typed differently the next day; it is the same name.
    expect(r.authenticate('bob', 'a good password')?.id).toBe(a.id);
    expect(r.authenticate('b_o_b', 'a good password')?.id).toBe(a.id);
  });

  it('refuses the wrong password', () => {
    const r = reg();
    unwrap(r.register('bob', 'a good password', 0));
    expect(r.authenticate('bob', 'the wrong password')).toBeUndefined();
  });

  it('answers the same way for an unknown name as for a wrong password', () => {
    const r = reg();
    unwrap(r.register('bob', 'a good password', 0));
    // Both undefined: the response must not tell an attacker which names exist.
    expect(r.authenticate('nobody', 'a good password')).toBeUndefined();
    expect(r.authenticate('bob', 'wrong')).toBeUndefined();
  });
});

describe('renaming', () => {
  it('changes the displayed name and the login name together', () => {
    const r = reg();
    const a = unwrap(r.register('bob', 'a good password', 0));
    unwrap(r.rename(a.id, 'stella', 10));
    expect(r.findById(a.id)?.name).toBe('stella');
    expect(r.authenticate('stella', 'a good password')?.id).toBe(a.id);
  });

  it('never hands a released name to anyone else', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', 0));
    unwrap(r.rename(bob.id, 'stella', 10));
    // The newcomer cannot inherit the name, nor the reputation on it.
    expect(r.register('bob', 'another password', 20)).toEqual({ ok: false, error: 'name_taken' });
    expect(r.register('B-o_B', 'another password', 20)).toEqual({ ok: false, error: 'name_taken' });
    expect(r.nameAvailable('bob')).toBe(false);
  });

  it('refuses the old name at the login form, since it is nobody now', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', 0));
    unwrap(r.rename(bob.id, 'stella', 10));
    // The name still points at this account, but it is not its name.
    expect(r.authenticate('bob', 'a good password')).toBeUndefined();
  });

  it('lets an account take back a name it used to hold', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', 0));
    unwrap(r.rename(bob.id, 'stella', 10));
    expect(r.rename(bob.id, 'bob', 20).ok).toBe(true);
    expect(r.authenticate('bob', 'a good password')?.id).toBe(bob.id);
  });

  it('refuses a rename onto somebody else', () => {
    const r = reg();
    const bob = unwrap(r.register('bob', 'a good password', 0));
    unwrap(r.register('carl', 'another password', 0));
    expect(r.rename(bob.id, 'Carl', 10)).toEqual({ ok: false, error: 'name_taken' });
    expect(r.rename(bob.id, 'x', 10)).toEqual({ ok: false, error: 'name_invalid' });
  });
});

describe('ratings', () => {
  it('applies a signed delta and counts the rated game', () => {
    const r = reg();
    const a = unwrap(r.register('bob', 'a good password', 0));
    r.applyRating(a.id, 12);
    r.applyRating(a.id, -5);
    expect(r.findById(a.id)?.rating).toBe(BASE_RATING + 7);
    expect(r.findById(a.id)?.ratedGames).toBe(2);
  });

  it('penalises a leaver without counting a rated game', () => {
    const r = reg();
    const a = unwrap(r.register('bob', 'a good password', 0));
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
    const bob = unwrap(first.register('bob', 'a good password', 0));
    first.applyRating(bob.id, 20);
    unwrap(first.rename(bob.id, 'stella', 10));

    const second = reg(file);
    expect(second.findById(bob.id)?.name).toBe('stella');
    expect(second.findById(bob.id)?.rating).toBe(BASE_RATING + 20);
    expect(second.authenticate('stella', 'a good password')?.id).toBe(bob.id);
    // A restart must not hand the released name to someone else.
    expect(second.register('bob', 'another password', 20)).toEqual({
      ok: false,
      error: 'name_taken',
    });
    // And the next account still gets a fresh id.
    expect(unwrap(second.register('carl', 'another password', 20)).id).toBe(bob.id + 1);
  });
});

describe('the public shape', () => {
  it('carries no secret at all', () => {
    const a = unwrap(reg().register('bob', 'a good password', 0));
    const pub = publicAccount(a);
    const json = JSON.stringify(pub);
    expect(json).not.toContain(a.password.hash);
    expect(json).not.toContain(a.password.salt);
    expect(Object.keys(pub).sort()).toEqual(['createdAt', 'id', 'name', 'ratedGames', 'rating']);
  });
});
