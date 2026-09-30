# Every human scores points, on one ladder, from the first match

> Amends ADR 0006 (a Guest now has a line on a ladder, kept by a cookie; the rating ladder is
> untouched) and ADR 0024 (a Guest is kept on disk once it scores or names itself).

ADR 0024 let a visitor play the public queue without an account, and kept the Guest off every
ladder, because a ladder was a rating and a stranger nobody can hold to a name must not move an
account's number. That is still right for the rating. What it left the landing was a ladder of a
handful of accounts, a bot column most visitors could not place on, and a Play button whose fine
print said "Unranked." The counter's reading of the visitors is that they come to play people and
leave before a match ends: one end of match reported for thirty-seven started. A ladder only the
patient could reach was one nobody reached.

So every human now scores, from the first match, on one ladder: the ladder of every human, the
accounts and the Guests together (CONTEXT.md: Points, Ladder).

- **Points for actions, banked as they come.** A human seat in a classic public queue match earns
  (`server/points.ts`): a minion or camp last hit 1, a champion kill 10, an assist 5, a tower its
  team destroys 15 to every human of that team, a ring creature or the Warden taken by the team
  15, an Ascendant 25, the win 50 to every human of the winning team and a loss played through
  15. Deaths cost nothing. Each award is banked on the player's line the tick it lands and the
  player is told (`{ t: 'points' }`, to that player alone), so a player who leaves at minute
  twelve keeps what minute twelve had given them: almost nobody finishes a twenty-two minute
  match, and a ladder paid at the end would pay almost nobody. A seat that changes hands earns
  nothing for the bot that stood in: a player who leaves stops earning, and one who comes back,
  or drops into a bot's seat, earns from the moment they sit down.
- **Weighed by the people in the match.** At the moment of each award, from the humans connected:
  two when a human sits on the other team, one and a half when another human sits only on the
  seat's own team, one alone. A match against people is worth more than one against bots, and a
  match beside a friend sits between the two.
- **And by the bots it faces.** A seat whose opposing lane seats play the Gentle player earns
  half; against the drawn house styles, the whole. The difficulty stays automatic, as the public
  queue has it (`gentleTeams` in `server/guests.ts`): Gentle when every human in the match is a
  Guest, the drawn styles as soon as an account is in it. The match's start decides it, and the
  match keeps that decision for its points. The two weights multiply: a lone Guest facing Gentle
  bots earns half, beside another Guest three quarters, and a human opponent still doubles it.
  Rounded to an integer, one action at a time, so a last hit is always worth at least its point.
- **The end pays only a seat still playing.** The win and the loss played through go to a seat
  that issued a command in the last three minutes of match time. A tab left open while the allied
  bots win pays nothing; the actions pay only when there are actions anyway.
- **Only the classic public queue.** A private lobby would be a points machine: two friends
  farming a bot-filled match on their own terms, as long as they like. The Forge queue is left
  out with it, since its champions are not the roster's and its numbers are not comparable.
  Spectators never score, and neither do coach seats: the bot is playing.
- **One ladder, Guests and accounts together.** Ranked by points (equal points rank the older
  line first), names and numbers only, and whether a line is a Guest's or an account's, never an
  id (`GET /api/public/ladder`, `server/points_ladder.ts`). The landing shows its top where the
  bot column stood; the home shows it first in its ladder section, the rating ladders beside it
  as they were. The rating, the ranked queue's rule and ADR 0006's promise about it are untouched:
  a match with a Guest in it is still rated for nobody.
- **A Guest is kept once it scores or names itself.** Until then it lives in memory for a day as
  ADR 0024 had it. From its first points or a chosen name it is written to `guests.json`, under
  the SHA-256 of its cookie's token and never the token, so the file opens nobody's line, and it
  lives a year after it was last seen. Its negative id is stable across restarts (the file keeps
  the next id to hand out), and the `loc_guest` cookie lasts a year, set again on each visit.
  Points and the last seen moment reach disk on a timer and at shutdown, never on every minion;
  so do an account's.
- **A Guest may name its line.** At the end of a match and in the pause menu, under the account
  name rules (`server/account_name.ts`) and the word filter, and free among the accounts, their
  retired names included, and the other Guests alike: registration and a rename refuse a name a
  Guest holds, the same way they refuse one an account holds.
- **Registering claims the browser's Guest.** An account created in a browser that holds a
  Guest's cookie, through the form or through Discord, takes that Guest's points and may take its
  chosen name, and the Guest is retired, its cookie cleared. Only at the account's creation, and
  one Guest per new account: an existing account signing in takes nothing, so points cannot be
  pooled from many browsers into one line.

## Considered and rejected

- **Points only for a finished match.** One report of a finished match for thirty-seven started;
  the ladder would stay empty, and leaving early would cost a newcomer everything they did.
- **Rating the Guests instead.** ADR 0024 rejected it and nothing here changes why: a rating is a
  claim about who beats whom, and it has to rest on identities. Points are a record of what was
  done, which is safe to give to anyone who did it.
- **Points in private lobbies, weighted down.** Any weight above zero is still a machine, only a
  slower one.
- **A ladder of Guests apart from the accounts.** Five to ten people a day; two ladders would be
  two short lists, and the account would read as a different game rather than the same line kept
  on every device.
- **Keeping the offline practice link on the landing.** Visitors play online now. The practice
  match stays for accounts on the home's tile, and the landing still falls back to it by itself
  when no Guest can be opened.
