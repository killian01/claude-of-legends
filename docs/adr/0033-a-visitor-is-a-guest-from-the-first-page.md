# A visitor is a Guest from the first page

> Amends ADR 0024 (the Guest is handed out when the landing opens, not on Play) and ADR 0027
> (the line also keeps a Respawn best, and the level reads the line's points).
>
> Amended by ADR 0036: given an invite code in its body, the landing's one request also answers
> who opened that lobby, how many are in it, and whether they are queued or playing.

ADR 0024 handed a visitor a Guest when they pressed Play, and ADR 0027 gave that Guest a line on
the ladder of every human, a name of its own and a year under its cookie. What the landing showed
before the first match was the ladder and, for a browser that had played, the line's rank. The
name, the level and the best lived elsewhere: the name box on the end card and in the pause menu,
the level and the best in the browser's own storage, read only on Respawn's end card. A visitor
arriving on the landing saw nothing of what was already theirs.

So the landing now hands a visitor its Guest as the page opens, and shows it to them first, in
one place: the own panel (CONTEXT.md: Own panel).

## Decision

- **The landing's one request hands the visitor its Guest.** `POST /api/public/landing`
  (`server/landing_page.ts`, built pure and served by one route) resolves the browser's
  `loc_guest` cookie, or issues a Guest when there is none or it has lapsed, and sets the year's
  cookie again either way. It answers the ladder of every human as before, the own panel, and
  the week (the rotation, the starters, and when the week turns). A signed-in account reads its
  own and is handed no Guest. `POST /api/guest`, what Play asks, hands out the same Guest the
  same way. The route changes state now, so it takes POST only. Both routes refuse a request
  the browser marks as made by another site (`Sec-Fetch-Site: cross-site`): Lax keeps the
  cookie off such a POST, the route would hand out a new Guest, and the answer to a form
  posted from elsewhere could replace the Guest the browser holds.
- **The own panel.** Who the reader is and what they hold, before anything else: the name,
  changed in place under the account name rules and the word filter (`POST /api/ladder/name`,
  as before); the place on the ladder and the points; the level; the best; the next thing within
  reach (the line just above and how many points it is ahead, the next level); and the account,
  offered as keeping all of it on another device, once the Guest holds something kept (points or
  a chosen name). The offer is a line in the panel, never a prompt that stands between the
  visitor and Play.
- **The level reads the line's points.** One curve, `goalStep` in `src/ui/royale_goal.ts`, the
  one Respawn's end card climbs: Level 2 at 50 points, each next level a little further. It is
  read off the points the line holds, earned in the 5v5 and in the battle royale alike, wherever
  the level shows. The browser keeps only the last total it read, to tell what a match added.
- **The line keeps the Respawn best.** The most takedowns one seat scored in a Respawn match,
  counted since landing for a drop-in, as the end card counts them. The server raises it when the
  match ends, on the Guest's line or the account, and sends the card the best held before it, so
  the card says whether this one is new. An account made in the Guest's browser takes it with
  the points and the chosen name. On disk it is one more number of the Guest's record in
  `guests.json`, written when the rest of it is.
- **What the browser kept is not carried over.** The level and the best kept per browser,
  shipped on 2026-10-08, name nobody and live in one browser; the line starts from its own points
  and from a best of zero.
- **Not decided here.** Rewards for a level, a weekly ladder, daily aims, Mastery for Guests.

## Considered and rejected

- **Handing out the Guest on Play, as before.** The panel would have nobody to show until the
  first match, and the name could not be changed before it.
- **A GET that hands out the Guest.** A request that sets a cookie and may write a line is a
  state change, and every state-changing route here is gated on the method
  (`tests/architecture.test.ts`).
- **A level of its own per mode.** Two bars for one line of points would read as two progressions
  of one player.
- **Keeping the browser's level and best beside the line's.** Two numbers for one thing, which
  disagree as soon as a second browser plays.
