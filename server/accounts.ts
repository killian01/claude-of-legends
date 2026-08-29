// Accounts: the persistent identity a person plays under (CONTEXT.md).
// One name, owned; one password, the only secret; the rating and history
// earned under it. Replaces the token-keyed identity ADR 0006 retired,
// where a cleared localStorage made a new player and a free-text name
// belonged to nobody.
//
// The name index is the interesting part. It is keyed on the folded
// reading of the name (server/account_name.ts), so Bob and b_o_b cannot
// both exist, and an entry is NEVER removed. A name an account releases
// by renaming stays pointed at that account: the name is also the login
// identifier, so recycling it would send the old owner's password to a
// stranger's login attempt, and let whoever grabbed the name inherit a
// reputation earned by someone else.

import { foldName, validateName } from './account_name';
import { hashPassword, type PasswordHash, validatePassword, verifyPassword } from './password';
import { BASE_RATING } from './rating';
import { loadJson, saveJsonAtomic } from './store';

export interface Account {
  id: number;
  // As the owner typed it; this is what everyone sees.
  name: string;
  // The folded reading uniqueness was judged on, stored so a reload does
  // not have to recompute the whole index from names.
  fold: string;
  password: PasswordHash;
  createdAt: number;
  seenAt: number;
  // Elo (server/rating.ts); only rated matches move it.
  rating: number;
  ratedGames: number;
}

// Everything about an account that may leave the server. The password
// hash and salt are absent by construction rather than by deletion, and
// tests/architecture.test.ts holds that line.
export interface PublicAccount {
  id: number;
  name: string;
  createdAt: number;
  rating: number;
  ratedGames: number;
}

export function publicAccount(a: Account): PublicAccount {
  return {
    id: a.id,
    name: a.name,
    createdAt: a.createdAt,
    rating: a.rating,
    ratedGames: a.ratedGames,
  };
}

export type RegisterError = 'name_invalid' | 'name_taken' | 'password_invalid';
export type RenameError = 'name_invalid' | 'name_taken';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// What the on-disk file holds: the accounts, plus every name ever taken.
// Retired names have no account fields of their own; they are just a
// claim that nobody else may have this one.
interface StoredState {
  accounts: Account[];
  // folded name -> the account that holds or held it.
  names: [string, number][];
}

export class AccountRegistry {
  private readonly byId = new Map<number, Account>();
  // Folded name -> account id. Never shrinks: see the header.
  private readonly nameOwner = new Map<string, number>();
  private nextId = 1;

  constructor(private readonly file: string) {
    const state = loadJson<StoredState>(file, { accounts: [], names: [] });
    for (const a of state.accounts) {
      this.byId.set(a.id, a);
      this.nextId = Math.max(this.nextId, a.id + 1);
    }
    for (const [fold, id] of state.names) this.nameOwner.set(fold, id);
    // A name index that lost entries (a hand-edited file) would let a
    // retired name be taken again, so rebuild what the accounts imply.
    for (const a of this.byId.values())
      if (!this.nameOwner.has(a.fold)) this.nameOwner.set(a.fold, a.id);
  }

  private persist(): void {
    // A broken disk must not break gameplay: identities keep working in
    // memory and the failure is loud in the log.
    try {
      const state: StoredState = {
        accounts: [...this.byId.values()],
        names: [...this.nameOwner.entries()],
      };
      saveJsonAtomic(this.file, state);
    } catch (err) {
      console.error('account registry persist failed', err);
    }
  }

  // Whether this name is free for `forAccountId` to take. A name the
  // asking account already holds or held is theirs to take back.
  private nameFree(fold: string, forAccountId?: number): boolean {
    const owner = this.nameOwner.get(fold);
    return owner === undefined || owner === forAccountId;
  }

  register(name: string, password: string, now: number): Result<Account, RegisterError> {
    const nameErr = validateName(name);
    if (nameErr) return { ok: false, error: 'name_invalid' };
    const passErr = validatePassword(password);
    if (passErr) return { ok: false, error: 'password_invalid' };
    const fold = foldName(name);
    if (!this.nameFree(fold)) return { ok: false, error: 'name_taken' };
    const account: Account = {
      id: this.nextId++,
      name,
      fold,
      password: hashPassword(password),
      createdAt: now,
      seenAt: now,
      rating: BASE_RATING,
      ratedGames: 0,
    };
    this.byId.set(account.id, account);
    this.nameOwner.set(fold, account.id);
    this.persist();
    return { ok: true, value: account };
  }

  // The name is matched on its folded reading, so a player who typed
  // "Bob" at signup still gets in typing "bob". Returns undefined for
  // both an unknown name and a wrong password, so the answer cannot be
  // used to learn which names exist.
  authenticate(name: string, password: string): Account | undefined {
    const id = this.nameOwner.get(foldName(name));
    if (id === undefined) return undefined;
    const account = this.byId.get(id);
    // A retired name points at an account whose current name is another
    // one; logging in with the old name must not work.
    if (!account || account.fold !== foldName(name)) return undefined;
    if (!verifyPassword(password, account.password)) return undefined;
    return account;
  }

  rename(id: number, name: string, now: number): Result<Account, RenameError> {
    const account = this.byId.get(id);
    if (!account) return { ok: false, error: 'name_invalid' };
    const nameErr = validateName(name);
    if (nameErr) return { ok: false, error: 'name_invalid' };
    const fold = foldName(name);
    if (!this.nameFree(fold, id)) return { ok: false, error: 'name_taken' };
    account.name = name;
    account.fold = fold;
    account.seenAt = now;
    // The name left behind keeps pointing here, and so stays out of
    // everyone else's reach for good.
    this.nameOwner.set(fold, id);
    this.persist();
    return { ok: true, value: account };
  }

  // Last seen, moved in memory only: this happens on every connection and
  // it is not worth a whole-file rewrite (see server/sessions.ts on the
  // same discipline). It reaches disk on the next persist for any reason.
  touch(id: number, now: number): void {
    const account = this.byId.get(id);
    if (account) account.seenAt = now;
  }

  // One rated match landed for this account; the delta is already signed.
  applyRating(id: number, delta: number): void {
    const a = this.byId.get(id);
    if (!a) return;
    a.rating += delta;
    a.ratedGames += 1;
    this.persist();
  }

  // A leaver penalty: rating drops without counting a rated game (a
  // walk-out must not speed a placement up).
  penalize(id: number, amount: number): void {
    const a = this.byId.get(id);
    if (!a) return;
    a.rating -= amount;
    this.persist();
  }

  all(): Account[] {
    return [...this.byId.values()];
  }

  findById(id: number): Account | undefined {
    return this.byId.get(id);
  }

  // Whether a name is available to a would-be registrant, for the signup
  // form to answer before the password is typed.
  nameAvailable(name: string): boolean {
    return validateName(name) === null && this.nameFree(foldName(name));
  }

  get count(): number {
    return this.byId.size;
  }
}
