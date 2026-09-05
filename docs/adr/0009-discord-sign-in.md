# Discord is a door: an account can be created and entered through it

Supersedes ADR 0008, which added an optional Discord link to an account and drew a hard line at
"never a way to sign in". This ADR erases that line on purpose. The linking it shipped asked a
player to fill in the whole signup form first and offered the link as a garnish, and the
maintainer's verdict was blunt: linking a Discord to an account that already exists is not worth a
button. What people actually want from the Discord button is to skip the form.

So the button now reads **Continue with Discord**, and it does the whole thing: one round trip
through Discord either creates an account or signs back into the one that Discord already made.
Nothing is typed. No name, no password, no email address.

## What one round trip does

The departure and the callback are ADR 0008's, unchanged in shape: authorization code flow,
`identify` scope and nothing else, one call to `/users/@me`, the access token dropped with the
function that held it, an unguessable single-use `state` as the whole anti-forgery story
(`server/discord_state.ts`). What changed is what the callback does with the identity that comes
back:

- **Nobody has this Discord id yet**: an account is created on the spot. Its name is derived from
  the Discord display name (`server/discord_name.ts`): stripped to the name space of
  `server/account_name.ts`, clamped, deduplicated with a numeric suffix, with a neutral fallback
  when nothing usable survives. The account starts with no password and no email. A session opens
  and the browser lands home, signed in.
- **This Discord id already has an account here**: that account is signed in. The stored copy of
  the Discord name refreshes on the way through, so a rename over there catches up at the next
  sign-in.

One Discord account, one game account, exactly as ADR 0008 ruled, and for a stronger reason now:
the id is not a fact about the account, it is the way back into it.

## What it costs, said out loud

ADR 0008 rejected sign-in because a second door is a second way to lose an account, and because it
puts somebody else's uptime in front of ours. Both objections were real and both are now accepted,
with their blast radius kept small:

- **The door only opens accounts it made.** A name-and-password account is untouched by all of
  this: it has no Discord id in the index, so no Discord round trip can ever open it. Whoever
  holds a player's Discord holds only the game account that Discord created, which is exactly the
  deal every player of a "continue with" button already understands.
- **A Discord outage locks out only Discord accounts,** and only until it ends. The name and
  password door does not depend on Discord and never will. A Discord account is not sealed forever
  to its origin either: the email and reset routes of ADR 0007 accept it like any other account,
  and a password landed that way opens the front door too. The home screen deliberately does not
  advertise this: a strip asking a fresh Discord account for an email address, to recover a
  password it does not have, read as noise and was cut.
- **No password to guess.** Until that reset lands one, a Discord account has no password at all,
  and `authenticate()` refuses it outright rather than comparing against anything. There is
  nothing to brute-force; the only way in is a callback Discord itself signed off on.

## What ADR 0008 keeps

Everything about privacy and scope survives verbatim: `identify` and nothing else (unless the
deployment turns on the auto-join amended in below, which adds `guilds.join` and nothing more), no
token stored, the Discord id never leaves the server at all, the stored Discord name goes to the owner
(`selfAccount`) and never to another player, and `tests/architecture.test.ts` still holds that
line. Optionality survives too: the button appears only on a server with the two Discord secrets
set, and an account created the classic way plays, is rated and places on the ladder identically.

## What linking loses

The link-to-an-existing-account flows are gone: the offer on the signup form, the row on the home
screen, the unlink button, the pending-link ticket and its cookie, the `/api/discord/pending` and
`/api/discord/unlink` routes. Not because they were broken, but because they answered a question
nobody was asking. `/api/discord/status` remains so the client knows whether to show the door, and
`registry.linkDiscord` remains as the callback's way to refresh the stored name.

Unlink deserves its own sentence: for a Discord account the link is the door, and an unlink button
would be a lock-yourself-out button. If a player truly wants their Discord released, that is a
support conversation, not a self-serve control, until an account holds a password to fall back on.

## Amendment, 2026-09-05: the door can also open the server

A player who signs up through Discord is, by construction, a Discord user, and the community for
this game lives on a Discord server. Sending them to a link afterwards wastes the one moment they
are already holding the door. World of ClaudeCraft solved this before us and documents the
mechanism; we take the same one.

With `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` both set, the departure asks for `guilds.join` on
top of `identify`, and the callback adds a brand new account to that one server for them:
`PUT /guilds/{id}/members/{user}`, authorized as the bot, with the player's own access token in
the body, which is the pair Discord requires. 201 means added and 204 means already a member, and
both are a yes. Nothing else changes: the token still never leaves the function that got it, it is
still never stored, and the join happens inside `exchange()` precisely so that stays true.

Three properties are load-bearing and tested (`tests/discord.test.ts`):

- **Off by default.** Neither variable set and the scope is `identify` alone, exactly as above.
  A deployment opts in; it cannot happen by accident.
- **Best effort, always.** A refused, rate-limited, broken or unanswered join never costs anybody
  their account. The sign-in has already succeeded by then; the join is the last thing tried and
  the first thing given up on.
- **Idempotent.** An existing member is a success, not an error, so a second round trip through
  the door is uneventful.

The cost, said out loud: the consent screen now reads "Join servers for you" alongside the
username, at the exact moment somebody is deciding whether to sign up at all. That is a heavier
ask than `identify` alone, and it is the reason this is a switch rather than the default. The
`email` scope stays rejected below for reasons that have not changed; `guilds.join` differs from it
in that it stores nothing about the player and reads nothing back.

The home screen says which of the two happened. `?discord=created` offers the invite;
`?discord=joined` says they are already in and turns the link into a door
(`src/ui/discord_welcome.ts`). Asking somebody to join a server they are standing in reads as a
bug, so the two are not allowed to say the same thing.

## Considered and rejected

- **Keeping link-after-creation alongside the door.** Two flows, two explanations, and the second
  one earns its keep only for a player who wants Discord sign-in on an account they made by hand;
  that player can be served later if they turn out to exist.
- **Asking the player to confirm the derived name before creating.** A form again, which is what
  the button exists to avoid. The derived name is visible immediately on the home screen, and a
  rename feature is the honest fix if names turn out to matter this much.
- **Widening the scope to `email` to also capture an address.** It would seed password recovery,
  but it stores a second piece of personal data nobody typed here, and the `identify`-only promise
  is worth more than the convenience.
- **Auto-joining on every sign-in rather than on account creation.** Adding a returning player to
  the server on their tenth match is either a no-op or an unasked-for re-join after they left it
  on purpose. Leaving is a decision, and a login should not undo it.
