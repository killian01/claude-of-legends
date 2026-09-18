# Accounts carry an email address, and a forgotten password is recoverable

ADR 0006 made accounts mandatory and deliberately left email out. The reasoning was sound and is
recorded there: an SMTP relay puts a deliberately isolated process back on a network it was kept
off, and an address is personal data this game had no use for. The cost was written down in the
same breath, under "What this does not solve": there is no recovery path at all, and since a name
is never re-issued, a forgotten password costs the account AND the name, permanently. That is a
harsh thing to do to somebody who mistypes a password they set once. This ADR pays the cost ADR
0006 declined to pay, and reverses only that one point of it.

An account now registers with an address. It is required at signup, and the account is usable the
instant it is created: the confirmation link is sent, not waited for. An unconfirmed account
queues, is rated, and places on the ladder exactly like any other. That is a decision, not an
oversight, and it is what keeps a third party out of the critical path: if the relay is down, or
the mail lands in a spam folder, or the player never reads it, nothing about playing the game
changes. The only thing an unconfirmed address cannot do is receive a password reset, which is
also the only thing it was collected for.

## The claim, and the squat it allows

An address is held from the moment someone registers with it. That is what stops ten accounts
sharing one mailbox, and it is also, unavoidably, what lets someone register with a stranger's
address and hold it. Reserving only on confirmation would have closed the squat and opened the
hole it was meant to close, since anybody could then invent `a1@x`, `a2@x` and never confirm.

The expiry is the whole answer. An unconfirmed claim lapses after seven days and the address goes
back into circulation, so a squat costs a burned account name per attempt and buys a week. When it
lapses, the account keeps its name, its rating and its entire history and loses only the claim:
nothing is ever deleted, which is what ADR 0006 promised. A confirmed claim never lapses, because
at that point a real person has proven they read that mailbox, and releasing it later would hand
their password reset to whoever registered it next.

For the same reason a reset link only goes to a confirmed address. A mistyped address at signup
belongs to a stranger who never asked for it; resetting into their inbox would hand them somebody
else's account.

## How the mail leaves the box

An HTTPS call to a transactional provider, made with `fetch`. No SMTP client, so no new package,
which keeps the dependency set at the two the game already has. The container still publishes no
port and still sits off the km01 network (`docs/deploy.md`); it only makes an outbound request. The
provider is behind one interface (`server/mailer.ts`), so replacing it is one class.

Two environment variables switch it on. Without them the process logs links instead of sending
them and says so loudly at boot, which is what a developer wants and what an operator must not
miss: that mode prints a bearer credential into the log.

Delivery is best effort everywhere it is used. Every caller treats a failure as "the player did not
get their link", never as "the operation failed", or an outage at a third party becomes an outage
of the game.

## Considered and rejected

- **A recovery code instead.** Shown once at registration, saved by the player, no network and no
  personal data at all. It solves the same problem more cheaply and it was the recommendation.
  Rejected because in practice almost nobody saves the code, which leaves the harsh outcome above
  in place for exactly the people it hurts.
- **Verify before you can play.** Closes the squat completely. Rejected: a mail in a spam folder
  then loses the player at the front door, and a relay outage stops all registration.
- **One account per verified address, enforced on the ladder.** Considered, since it would make
  every row on the ladder a distinct confirmed mailbox. Rejected: an unconfirmed account is a
  full account here, and half a ladder is worse than a ladder with a known limit.
- **Folding away dots and +tags.** That is a Gmail rule, not an email rule. Applying it everywhere
  would merge two genuinely different mailboxes at a provider that keeps them apart, locking a
  real person out of registering.

## What this does not solve

- **Smurfing and boosting.** Unchanged from ADR 0006, and worth restating because the email might
  look like it helps. It does not: an unconfirmed address is enough to play and to be rated, and
  inventing one is free. Two accounts queueing together still land one per side and can trade
  wins for about three rating points a match. This is a known, measured hole, left open on
  purpose while the server is small enough that a ladder reset costs nothing.
- **Reading who plays here.** Registration answers "that address is taken", which says an account
  exists on it. Uniqueness cannot be enforced without saying so. The per address throttle is what
  keeps that from being enumerable.

## Amended 2026-09-17: the address is asked for after the door, not at it

The form at the door asked for a name, a password and an address before a visitor had played
anything, and the counter said what that cost: visitors took the offline match, which asks for
nothing, and left without an account. The address is now optional at signup. The form asks for a
name and a password; the home then carries the line it already carried for accounts old enough to
predate addresses, "No email address on this account. Add one to be able to reset a forgotten
password", with the field beside it, and `/api/email` claims the address exactly as signup did.

Nothing else here moves. A claim is still held from the moment it is made, still lapses
unconfirmed after seven days, and a reset still goes only to a confirmed address. What changes is
who bears the cost of the missing recovery path: an account whose owner declined to give an
address, knowingly, on a line that says what it is for, rather than every visitor at the door. An
account without an address stands where ADR 0006 left every account, and the line on the home is
its way out.
