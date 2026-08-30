// Accounts: the persistent identity a person plays under (CONTEXT.md).
// One name, owned; one password, the only secret; one email address; the
// rating and history earned under it. Replaces the token-keyed identity
// ADR 0006 retired, where a cleared localStorage made a new player and a
// free-text name belonged to nobody.
//
// Two indexes, and the difference between them is the whole design.
//
// The name index is keyed on the folded reading of the name
// (server/account_name.ts) and an entry is NEVER removed. A name an
// account releases by renaming stays pointed at that account: the name is
// also the login identifier, so recycling it would send the old owner's
// password to a stranger's login attempt.
//
// The email index CAN release, and must (ADR 0007). An address is held
// from the moment someone registers with it, which is what keeps ten
// accounts off one mailbox, and is also what would let someone hold a
// stranger's address forever. So an unconfirmed claim lapses after a week
// (server/email_claim.ts) and the address goes back into circulation. A
// confirmed one never lapses: a real person has proven they read that
// mailbox, and taking it from them would hand their password reset to
// whoever registered it next.
//
// A third index arrived with ADR 0008, and it behaves like neither. A
// linked Discord id is verified the instant it exists, because it came
// back from Discord itself rather than from a form, so there is nothing
// to confirm and no claim to lapse. It is exclusive while it is held (one
// Discord account, one game account) and it is released the moment the
// owner unlinks, which is theirs to do: it is their Discord, not ours.

import { foldName, validateName } from './account_name';
import type { DiscordIdentity } from './discord_oauth';
import { foldEmail, validateEmail } from './email_address';
import { claimHolds } from './email_claim';
import { hashPassword, type PasswordHash, validatePassword, verifyPassword } from './password';
import { BASE_RATING } from './rating';
import { loadJson, saveJsonAtomic } from './store';

export interface AccountEmail {
  // As the owner typed it; this is what mail is addressed to.
  address: string;
  // The folded reading uniqueness was judged on.
  fold: string;
  // When the claim was staked. The lapse window runs from here.
  claimedAt: number;
  // Set once the owner has followed the link sent to it.
  confirmed: boolean;
}

// A Discord account this one is linked to (ADR 0008). The id is what
// uniqueness is judged on and never changes; the name is a copy of what
// Discord showed at link time, kept only so the owner recognises the link
// they made, and it goes stale the day they rename themselves there.
export interface DiscordLink {
  id: string;
  username: string;
  linkedAt: number;
}

export interface Account {
  id: number;
  // As the owner typed it; this is what everyone sees.
  name: string;
  // The folded reading uniqueness was judged on, stored so a reload does
  // not have to recompute the whole index from names.
  fold: string;
  password: PasswordHash;
  // Absent on an account registered before ADR 0007, and on one whose
  // unconfirmed claim lapsed. Such an account plays exactly as before; it
  // simply has no way to recover a forgotten password until it adds one.
  email?: AccountEmail;
  // Absent unless the owner linked one, which is optional and always was:
  // an account with no Discord queues, is rated and places on the ladder
  // exactly like any other (ADR 0008).
  discord?: DiscordLink;
  createdAt: number;
  seenAt: number;
  // Elo (server/rating.ts); only rated matches move it.
  rating: number;
  ratedGames: number;
}

// Everything about an account that may leave the server TO ANOTHER
// PLAYER. The password hash and salt are absent by construction rather
// than by deletion, and so are the email address and the linked Discord,
// which are nobody else's business. tests/architecture.test.ts holds
// every one of those lines.
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

// What an account may see about ITSELF, which is the public shape plus
// the address it registered with, whether that address is confirmed, and
// the Discord name it linked. Never built for anyone but the signed-in
// owner. The Discord ID is deliberately not here either: the owner has no
// use for a snowflake, and the name is what tells them which account they
// linked.
export interface SelfAccount extends PublicAccount {
  email: string | null;
  emailConfirmed: boolean;
  discord: string | null;
}

export function selfAccount(a: Account): SelfAccount {
  return {
    ...publicAccount(a),
    email: a.email?.address ?? null,
    emailConfirmed: a.email?.confirmed ?? false,
    discord: a.discord?.username ?? null,
  };
}

export type RegisterError =
  | 'name_invalid'
  | 'name_taken'
  | 'password_invalid'
  | 'email_invalid'
  | 'email_taken'
  | 'discord_taken';
export type RenameError = 'name_invalid' | 'name_taken';
export type SetEmailError = 'email_invalid' | 'email_taken' | 'unknown_account';
export type LinkDiscordError = 'discord_taken' | 'unknown_account';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// What the on-disk file holds: the accounts, plus every name ever taken.
// Retired names have no account fields of their own; they are just a
// claim that nobody else may have this one. Email claims are NOT stored
// separately: they live on the account and are rebuilt into an index at
// boot, because unlike a name an address has exactly one holder at a time.
interface StoredState {
  accounts: Account[];
  // folded name -> the account that holds or held it.
  names: [string, number][];
}

export class AccountRegistry {
  private readonly byId = new Map<number, Account>();
  // Folded name -> account id. Never shrinks: see the header.
  private readonly nameOwner = new Map<string, number>();
  // Folded email -> account id. Shrinks when a claim lapses.
  private readonly emailOwner = new Map<string, number>();
  // Discord id -> account id. Shrinks only when the owner unlinks; there
  // is nothing here to expire, since the link was verified when it was
  // made and stays true until somebody undoes it.
  private readonly discordOwner = new Map<string, number>();
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
    for (const a of this.byId.values()) {
      if (!this.nameOwner.has(a.fold)) this.nameOwner.set(a.fold, a.id);
      if (a.email) this.emailOwner.set(a.email.fold, a.id);
      if (a.discord) this.discordOwner.set(a.discord.id, a.id);
    }
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

  // Whether this address is free, releasing it first if the claim on it
  // has lapsed. Lazy rather than swept, so the answer is right the instant
  // the week is up rather than at the next sweep.
  private emailFree(fold: string, now: number, forAccountId?: number): boolean {
    const owner = this.emailOwner.get(fold);
    if (owner === undefined || owner === forAccountId) return true;
    const holder = this.byId.get(owner);
    if (!holder?.email || holder.email.fold !== fold) {
      // The index outlived what it pointed at.
      this.emailOwner.delete(fold);
      return true;
    }
    if (claimHolds(holder.email, now)) return false;
    this.releaseEmail(holder);
    return true;
  }

  // Drops a lapsed claim: the address goes back into circulation and the
  // account keeps its name, its rating and its whole history. Nothing is
  // ever deleted here, which is what ADR 0006 promised and ADR 0007 keeps.
  private releaseEmail(account: Account): void {
    if (!account.email) return;
    this.emailOwner.delete(account.email.fold);
    account.email = undefined;
  }

  // `discord` is the identity a round trip through Discord already
  // proved, if the signup form carried one (ADR 0008). It is the last
  // thing checked and the first thing that would be wasted, so nothing
  // else about registration changes when it is absent, which is the
  // normal case.
  register(
    name: string,
    password: string,
    email: string,
    now: number,
    discord?: DiscordIdentity,
  ): Result<Account, RegisterError> {
    const nameErr = validateName(name);
    if (nameErr) return { ok: false, error: 'name_invalid' };
    const passErr = validatePassword(password);
    if (passErr) return { ok: false, error: 'password_invalid' };
    const emailErr = validateEmail(email);
    if (emailErr) return { ok: false, error: 'email_invalid' };
    const fold = foldName(name);
    if (!this.nameFree(fold)) return { ok: false, error: 'name_taken' };
    const eFold = foldEmail(email);
    if (!this.emailFree(eFold, now)) return { ok: false, error: 'email_taken' };
    // Through findByDiscordId rather than the index directly, so an index
    // entry that outlived the account it pointed at (a hand-edited file)
    // refuses nobody.
    if (discord && this.findByDiscordId(discord.id)) {
      return { ok: false, error: 'discord_taken' };
    }
    const account: Account = {
      id: this.nextId++,
      name,
      fold,
      password: hashPassword(password),
      email: { address: email.trim(), fold: eFold, claimedAt: now, confirmed: false },
      discord: discord ? { id: discord.id, username: discord.username, linkedAt: now } : undefined,
      createdAt: now,
      seenAt: now,
      rating: BASE_RATING,
      ratedGames: 0,
    };
    this.byId.set(account.id, account);
    this.nameOwner.set(fold, account.id);
    this.emailOwner.set(eFold, account.id);
    if (account.discord) this.discordOwner.set(account.discord.id, account.id);
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

  // Claims an address for an account: at registration through register(),
  // afterwards through here (a typo at signup, a changed mailbox, or an
  // account old enough to have none). The new claim starts unconfirmed
  // whatever the old one was, so changing an address cannot inherit the
  // trust of the address it replaced.
  setEmail(id: number, email: string, now: number): Result<Account, SetEmailError> {
    const account = this.byId.get(id);
    if (!account) return { ok: false, error: 'unknown_account' };
    const emailErr = validateEmail(email);
    if (emailErr) return { ok: false, error: 'email_invalid' };
    const fold = foldEmail(email);
    if (!this.emailFree(fold, now, id)) return { ok: false, error: 'email_taken' };
    // Setting the address you already have changes nothing, and must not:
    // restaking the claim here would un-confirm a confirmed address and
    // restart its week. Re-sending the link is a separate act.
    if (account.email?.fold === fold) return { ok: true, value: account };
    if (account.email && account.email.fold !== fold) {
      this.emailOwner.delete(account.email.fold);
    }
    account.email = { address: email.trim(), fold, claimedAt: now, confirmed: false };
    this.emailOwner.set(fold, id);
    this.persist();
    return { ok: true, value: account };
  }

  // The link was followed. `address` is what the link was issued for, and
  // it has to still be the account's address: an old link must not
  // confirm an address the account moved to afterwards.
  confirmEmail(id: number, address: string, now: number): boolean {
    const account = this.byId.get(id);
    if (!account?.email) return false;
    if (account.email.fold !== foldEmail(address)) return false;
    if (!claimHolds(account.email, now)) return false;
    account.email.confirmed = true;
    this.emailOwner.set(account.email.fold, id);
    this.persist();
    return true;
  }

  // Who to send a reset link to. CONFIRMED only, and that is the point: a
  // mistyped address at signup belongs to a stranger who never asked for
  // it, and resetting into their inbox would hand them the account.
  findByConfirmedEmail(email: string): Account | undefined {
    const id = this.emailOwner.get(foldEmail(email));
    if (id === undefined) return undefined;
    const account = this.byId.get(id);
    if (!account?.email?.confirmed) return undefined;
    return account;
  }

  // Attaches a Discord identity that has already been proved (ADR 0008),
  // either at signup through register() or afterwards through here. There
  // is no unconfirmed state to pass through: this only ever runs on an
  // answer that came back from Discord itself.
  //
  // Relinking the same Discord to the same account refreshes the name it
  // shows and nothing else, so a player who renamed themselves on Discord
  // can see the link catch up without unlinking first.
  linkDiscord(
    id: number,
    identity: DiscordIdentity,
    now: number,
  ): Result<Account, LinkDiscordError> {
    const account = this.byId.get(id);
    if (!account) return { ok: false, error: 'unknown_account' };
    const holder = this.findByDiscordId(identity.id);
    if (holder && holder.id !== id) return { ok: false, error: 'discord_taken' };
    // This account swapping one Discord for another: the id it is leaving
    // goes back into circulation on the spot, or a link its owner
    // replaced would stay out of everyone's reach for nothing.
    if (account.discord && account.discord.id !== identity.id) {
      this.discordOwner.delete(account.discord.id);
    }
    const linkedAt = account.discord?.id === identity.id ? account.discord.linkedAt : now;
    account.discord = { id: identity.id, username: identity.username, linkedAt };
    this.discordOwner.set(identity.id, id);
    this.persist();
    return { ok: true, value: account };
  }

  // The owner's to undo, and it releases the id: it is their Discord, and
  // holding it after they said no would be holding something we were only
  // ever lent. The account keeps its name, rating and history, exactly as
  // when an email claim lapses. Returns whether there was one to drop.
  unlinkDiscord(id: number): boolean {
    const account = this.byId.get(id);
    if (!account?.discord) return false;
    this.discordOwner.delete(account.discord.id);
    account.discord = undefined;
    this.persist();
    return true;
  }

  findByDiscordId(discordId: string): Account | undefined {
    const id = this.discordOwner.get(discordId);
    if (id === undefined) return undefined;
    const account = this.byId.get(id);
    // The index outlived what it pointed at (a hand-edited file).
    if (account?.discord?.id !== discordId) return undefined;
    return account;
  }

  // A reset landed, or an owner changed their password deliberately.
  setPassword(id: number, password: string): boolean {
    const account = this.byId.get(id);
    if (!account) return false;
    if (validatePassword(password)) return false;
    account.password = hashPassword(password);
    this.persist();
    return true;
  }

  // Releases every claim whose week is up. Lazily done on lookup too, so
  // this is housekeeping rather than correctness: it keeps the index from
  // holding addresses nothing will ever ask about again.
  purgeExpiredClaims(now: number): number {
    let released = 0;
    for (const account of this.byId.values()) {
      if (account.email && !claimHolds(account.email, now)) {
        this.releaseEmail(account);
        released++;
      }
    }
    if (released > 0) this.persist();
    return released;
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
