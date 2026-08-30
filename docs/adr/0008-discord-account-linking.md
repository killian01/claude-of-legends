# An account can link a Discord account, and linking proves nothing else

> **Superseded by ADR 0009.** The Discord button now creates and signs into accounts, and the
> link-to-an-existing-account flows this ADR describes are gone. The privacy decisions here (the
> `identify`-only scope, no stored token, the id never leaving the server, one Discord one
> account) survive unchanged and ADR 0009 leans on them.

Players find each other on Discord before they find each other here. Today the two identities have
nothing to do with one another: the name on the ladder and the name in the chat are two strings
that happen to be typed by the same person, and there is no way to show that they are. This ADR
adds one optional, reversible fact to an account: the Discord account its owner proved they hold.

The link is offered where it is most useful, which is while the account is being created, and it is
offered again from the home screen for every account that already exists. It is never required. An
account with no Discord queues, is rated and places on the ladder exactly like any other, on the
same principle that kept an unconfirmed address playable in ADR 0007: nothing a third party
controls sits in the path of playing the game.

## What a link is, and what it is not

A link is an OAuth2 authorization code flow with the `identify` scope and nothing else. The access
token it produces is used for exactly one call, to `/users/@me`, and is then dropped with the
function that held it. Nothing is stored but the Discord user id, the display name that came back,
and when. This server cannot read a message, list a guild, or act as anybody on Discord, and it
could not start doing so without a visible edit to the scope in `server/discord_oauth.ts`.

A link is **not** a way to sign in. Name and password remain the only way into an account
(ADR 0006). This was the fork in the road and it was taken deliberately: making Discord a second
door means that whoever holds a player's Discord holds their game account, and it means an outage
at Discord locks people out of a game that otherwise has no dependency on it. The link answers
"is this the same person" and refuses to answer "let this person in".

The id is what uniqueness is judged on: it is stable, and the name beside it is a copy of what
Discord showed at link time, kept only so the owner recognises the link they made. It goes stale
the day they rename themselves there, and relinking refreshes it.

## One Discord, one account

An id is exclusive while it is held. That is what makes the link worth anything: an alt account is
free to make here, and a link that ten accounts could share would prove nothing about any of them.
So a second account cannot claim a Discord that is already on one, at signup or afterwards.

Unlinking releases it, immediately and completely. It is the owner's Discord, not ours, and holding
it after they said no would be holding something we were only lent. The account keeps its name, its
rating and its whole history: nothing is ever deleted here, exactly as ADR 0006 promised and ADR
0007 kept. This is why the id needs no expiry of any kind, unlike an email claim: it was verified
the instant it existed, so there is nothing to confirm and nothing to lapse.

## The link is the owner's business and nobody else's

The linked name goes into `selfAccount` and never into `publicAccount`, on the same line ADR 0007
drew for the email address. The ladder, the player card and every other route another player can
reach carry neither the name nor the id, and `tests/architecture.test.ts` holds that line. The
Discord id never leaves the server at all, not even to its owner: it is the same identifier
everywhere on Discord, the owner has no use for a snowflake, and the name is what tells them which
account they linked.

## The round trip, and what carries it

The browser leaves for Discord and comes back to the server, which sends it home with one query
parameter saying how it went. A top-level navigation rather than a popup: a popup is what a phone
browser blocks and an ad blocker eats, and this has to work on the page a player just typed their
name into.

Two short-lived things make that work (`server/discord_link.ts`). A **state** remembers what was in
flight, is unguessable, and is single use: bringing back a state nobody issued is how a forged
callback is caught. A **pending link** is what comes back for somebody who has no account yet, held
under a ticket the browser carries in a fifteen-minute cookie and spent by `/api/register`. Neither
is persisted, and that is the difference from the one-time mail links of ADR 0007: a confirmation
link waits in a mailbox for days and must outlive a deploy, while both of these are minutes old
with their owner watching. A restart mid-flow costs one click.

The pending link is only peeked at until the account is actually created. A signup refused for a
taken name must not silently spend the link the player just made, or fixing a typo would mean going
round through Discord again.

## Switching it on

Two environment variables, `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`, exactly as ADR 0007's
mail relay is switched on by two. Without both, the routes answer "not configured", the client
never offers a button that cannot work, and the boot log says so. `DISCORD_REDIRECT_URI` overrides
the callback for a deployment whose public origin is not the one links are built from; by default
it follows `PUBLIC_URL` like everything else. See `docs/deploy.md`.

## Considered and rejected

- **Sign in with Discord.** The obvious next step, and the reason the answer is no is written
  above: a second door is a second way to lose an account, and a hard dependency on somebody
  else's uptime for the front door of a game that has none anywhere else.
- **Requiring a link at signup.** It would cut into alt accounts, which is a real problem
  (ADR 0007 lists it as unsolved). Rejected because it turns a third party into the gate on the
  front door, and shuts out everyone who does not use Discord at all.
- **Showing the linked name on the public profile.** Tempting, since finding each other is the
  point. Rejected for now: it publishes a handle that reaches a person outside this game, to
  everyone who can open a ladder row, and that is not a default anybody chose. It stays a
  per-account decision to make later, not a consequence of linking.
- **Storing the access token to read guild membership.** It would allow a role on the community
  server to mean something in the game. Rejected: it widens the scope, makes this server hold a
  live credential for another service, and buys nothing the link itself does not already prove.
- **A popup window for the round trip.** Keeps the form filled in behind it. Rejected: popups are
  blocked on exactly the phone browsers the touch controls were added for.

## What this does not solve

- **Smurfing.** A link makes an alt account more expensive, not impossible: a second Discord
  account is free to make, and an account with no link at all is still a full account here. The
  hole ADR 0007 left open is narrowed and not closed.
- **Proving anything to Discord.** Nothing here writes to Discord: no role is granted, no message
  is sent, no bot joins a server. What a community does with the fact of a link is outside this
  repo, and would need a bot that is not in it.
- **A stale name.** The stored name is a copy from link time. It is refreshed when the owner
  relinks and not before, because there is no token kept to ask again with.
