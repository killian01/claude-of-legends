# Guests play the public queue, unranked

> Amended by ADR 0027: a Guest scores points on the ladder of every human, and is kept on disk,
> under a hashed token, once it scores or names itself. Its matches are still rated for nobody.

ADR 0006 made an account the price of reaching the server, and named the middle it rejected:
"Guests keep playing, unranked". Its cost was stated as real and paid by the invited player.
The maintainer's reading is that a person wants to play people first and register later, if at
all. The practice match is a 5v5 against bots in a tab;
what the landing promises is a MOBA.

So a person can now enter the public queue with no account. The landing's gold button asks
the server for a Guest (`POST /api/guest`), which answers with a name (`Wanderer 4821`) and a
cookie of its own, `loc_guest`, separate from the account session. The WebSocket upgrade
accepts either cookie. Everything else ADR 0006 decided stands, because the Guest is kept out
of every place it protected:

- **The ladder.** A Guest has no rating, and a match with a Guest seated by hand is not
  rated for anyone: a stranger nobody can hold to a name must not move an account's number.
  The queue still fills every empty seat with bots, so a Guest always gets a match.
- **Identity.** A Guest is a negative id held in the server's memory for a day, never
  written to disk; a restart forgets every Guest. The name holds a space, which no account
  name may (`server/account_name.ts`), so it can never be mistaken for or collide with one.
- **Records.** A Guest's seat is recorded like a house bot's: no account behind it, no
  laurels, no match history, nothing on a profile.
- **Everything else.** Private lobbies, spectating, the Forge queue, bot seats and every
  `/api` route that needs an account still need one. A Guest picks from the starter
  collection plus the week's rotation, as a fresh account does.

What carries over from an account for free: a dropped connection holds the Guest's seat
for the rejoin grace (the reservation is keyed on the id, and the cookie survives a reload),
and walking out costs nothing, since there is no rating to penalize.

## Considered and rejected

- **Guests rated on a shadow rating.** It would put an unverifiable identity back on the
  ladder, which is the whole of what ADR 0006 fixed.
- **Guests only against each other.** Five to ten people a day come through the landing;
  two Guests would almost never meet, and the queue would be a bot match with extra steps.
- **Keeping the landing's button on the offline match.** It stays one quiet line under the
  gold button, for a server that cannot be reached.
