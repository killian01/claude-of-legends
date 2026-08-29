# Accounts are mandatory to reach the server

Identity used to be the browser's session token: the first hello created a player record, and the
display name was free text refreshed on every hello (`server/players.ts`). That kept the "no
account, no install" promise, and it cost a ladder nobody could trust. One human produced a new
record with a fresh rating on every cleared localStorage, private window, or second device, so the
ladder listed the same person several times over. The name belonged to no one, so anyone could
type another player's name and sit next to them on a scoreboard; the `#disc` suffix distinguished
them in the data and nobody read it. And the token was a bearer credential with no secret behind
it: whoever held it held the rating, with no way to revoke it and no way to recover it.

So an account is now required for anything that touches the server: the queue, private lobbies,
spectating, replays, and the meta API. The offline practice match needs none, because it opens no
connection and a login wall in front of it would only add a dependency it does not have. An
account is a unique name plus a password, hashed with scrypt from `node:crypto`. There is no
email, so there is no password recovery: the server keeps its deployment isolation
(`docs/deploy.md`) with no external service, no new dependency, and no personal data, and the UI
has to say plainly that a lost password is a lost account. Uniqueness is judged on a folded
reading of the name (case and separators removed, ASCII only), so `bob`, `Bob` and `b_o_b` are one
name; the `#disc` suffix disappears with the ambiguity it existed to paper over. An account may
rename itself, but a name it releases is never re-issued: the name is also the login identifier,
so recycling it would send the old owner's password to a stranger's account and let whoever
grabbed it inherit a reputation earned by someone else. Reserving the folded key for good costs a
line and no clock; a quarantine period would only make the same collision quieter. Login is a
cookie (`httpOnly`, `Secure`, `SameSite=Lax`) carrying an opaque id into a server-side session
list, which rides the WebSocket upgrade on its own, keeps the credential out of URLs and out of
reach of any script on the page, and can actually be revoked. Failed logins slow down, per account
and per address, and never lock: a lockout would let anyone bench the top of the ladder on demand.

Existing data does not migrate. `players.json` and `matches.jsonl` are archived and the ladder
restarts, which costs the playtesters their history and buys a clean cut: no claim window to write
and later delete, no half-authenticated records, and no migration script rehearsed against
production. The rename that the glossary has been asking for since ADR 0001 lands in the same cut,
for free: `Player` becomes `Account` everywhere, including the persisted field names, because
there is nothing left on disk to migrate. One consequence of restarting the ladder is worth
naming, because it is loudest on day one and then never again: K scales with how many humans
played, so the early matches of a young server move a rating by about three points, and for a
while every account sits in a narrow band around the base rating. The ladder therefore breaks a
tie on rated games played rather than on account age, so that among equals it is evidence that
ranks, not who signed up first.

## Considered and rejected

- **Guests keep playing, unranked.** The obvious middle: play instantly, register only to
  appear on the ladder, and "no account to play" stays true. Rejected in favour of one kind of
  identity and one code path; the cost is real and it is the invited player who pays it.
- **Email with password reset.** The only way to make a lost password recoverable. It needs an
  SMTP relay or a third party, which puts this deliberately isolated process back on a network
  it was kept off, and it means storing personal data.
- **OAuth (Discord, Google).** No password to store and recovery handled by someone else, but
  it makes signing in depend on a third party being up and reachable.
- **Signup limits per address.** Considered against smurfing and rejected, see below.

## What this does not solve

- **Smurfing.** Registration is free and instant, so one person can still hold ten accounts and
  put ten rows on the ladder. Mandatory accounts fix the accidental duplicate, which is the
  common case, not the deliberate one. This is a decision, not an oversight: do not read the
  ladder as one row per human.
- **A forgotten password.** There is no recovery path at all, by construction. The only remedy
  is a new account, with a new name and a rating from scratch.
