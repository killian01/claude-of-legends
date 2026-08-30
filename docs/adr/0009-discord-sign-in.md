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
  password door does not depend on Discord and never will. And a Discord account is not sealed
  forever to its origin: its owner can add an email address from the home screen, confirm it, and
  use the ADR 0007 reset to land themselves a password. From then on both doors open it.
- **No password to guess.** Until that reset lands one, a Discord account has no password at all,
  and `authenticate()` refuses it outright rather than comparing against anything. There is
  nothing to brute-force; the only way in is a callback Discord itself signed off on.

## What ADR 0008 keeps

Everything about privacy and scope survives verbatim: `identify` and nothing else, no token
stored, the Discord id never leaves the server at all, the stored Discord name goes to the owner
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
