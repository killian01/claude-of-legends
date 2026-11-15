# A private lobby opens to Guests and outlives its match

> Amends ADR 0024 (a Guest opens, joins and starts a private lobby, queues it as a party, and
> removes a member as its host), ADR 0006 (a private lobby needs no account, and an account's
> name passes the word filter) and ADR 0033 (given an invite code, the landing's one request
> answers the invitation).

ADR 0024 let a visitor play the Ranked queue as a Guest and kept private lobbies an account's,
beside spectating and the Forge queue; ADR 0033 handed every visitor its Guest as the landing
opens. An invite link (`/?join=CODE`) still worked for an account alone: opened with none, it
showed the ordinary landing, which said nothing of the lobby it named, and the lobby was reached
only through the account form. And a lobby lasted one match. It was held by its host's socket,
closed when the host left, expired thirty minutes after it was made whoever was in it, and was
deleted when it started (`server/matchmaker.ts`); Play again sent each member into the Ranked
queue alone (`src/game/flow.ts`), and the link answered "Lobby not found or full", so a second
match together took a new lobby and a new link.

So a private lobby is now anyone's, and it stands from one match to the next under one code.

## Decision

- **A Guest has the private lobby.** Opening one, joining it, choosing a side, starting it,
  queueing it as a party and, as its host, removing a member leave `guestRefused`
  (`server/guests.ts`); spectating and the Forge queue stay an account's. Nothing moves on a
  ladder for it: a lobby's own match is never rated, scores no points (ADR 0027) and keeps the
  drawn house styles, as before, and a party it sends into the Ranked queue is a queue match like
  any other, its points included, rated for nobody when a Guest plays in it (`ratedWithGuests`,
  ADR 0024).
- **Codes of six letters.** The server hands out codes of six letters drawn from 23 (the
  alphabet without I, L and O), about 148 million of them. A page still reads five
  (`src/game/invite.ts`), the length of the codes before, so a link from before reads as a closed
  lobby rather than as nothing.
- **The invitation card.** An invite link opened with no account shows a band at the top of the
  landing, before the hero (`src/ui/invite_card.ts`, its words in `src/ui/landing_invite.ts`):
  who opened the lobby, how many of its ten seats are taken, whether its people are in a match,
  the name the visitor will join under, Join the lobby, and quieter Sign in and Create an
  account. The name is their Guest's, the one on the ladder (ADR 0027), changed in place under
  the account name rules and the word filter (`POST /api/ladder/name`). Sign in and Create an
  account keep the code through the sign-in (`src/game/reentry.ts`) and across a Discord round
  trip (the tab's session storage, `src/game/lobby_memory.ts`); Not now drops it. A full lobby,
  or one that has closed, says so and offers to open one. The band is part of the landing, not a
  layer (ADR 0020), and boot still takes the code off the address before anything else
  (`src/main.ts`).
- **The invitation is the landing's one request.** `POST /api/public/landing` takes the code in
  its JSON body, never in the address, which the access log keeps (PRIVACY.md), and answers it
  (`server/landing_page.ts`) with the name of the member who opened the lobby, the same for the
  lobby's whole life whoever hosts it, how many are seated, and whether they are queued,
  choosing champions or in their match; or with one answer for a code that is unknown, expired
  or closed. Never another member's name, never an id, never the code back.
- **The landing opens one too.** A fifth way in, the Private lobby, behind Play with friends
  (`src/ui/landing_modes.ts`), and under the ways a line to type a code and Join.
- **A lobby outlives its match.** Starting it keeps it under its code: the rules are a module of
  their own (`server/lobby.ts`), the records the Matchmaker's. It knows its members by whose they
  are, the account or the Guest, each with their side, twenty at most, since every session after
  a match opens a new socket; a Guest made into an account keeps its place. When the match is
  over, by a winner, by every person gone past the rejoin grace, or by a failure
  (`server/match_close.ts`), the lobby opens again. Where Play again stood, the end screen of a
  lobby's match offers Back to the lobby: a new session joins the same code and lands on the side
  it played, and a seat held in a match that has its winner gives nothing back, so the session is
  not pulled into the match just ended (`server/classic_rejoin.ts`). A tab that reloads during a
  lobby session, a deploy's reload included, goes back in (`src/game/lobby_memory.ts`). Return to
  menu and the lobby's Leave leave it; the link still brings a member back while it stands.
- **Graces.** After a match, the lobby gives the people who played it a minute to come back
  (`RETURN_GRACE_MS`): they show as coming back, and nobody starts until they are in or the
  minute is over. A connection that drops without leaving keeps its member's turn as host for a
  minute (`DROP_GRACE_MS`), and a lobby nobody has played in yet stands through it, so a reload
  loses nothing.
- **The host.** The member who opened it, whenever they are in it; then those who played its last
  match, in the order they joined; then everyone else in join order. A host away within a grace
  stays host, and nobody starts meanwhile; nobody hosts while the lobby's people are queued or
  playing. The lobby says who hosts it and tells everyone else it waits for them
  (`src/ui/lobby_view.ts`). The host may remove any other member while the lobby is open: the
  member leaves the lobby, and the lobby keeps only the id of their account or Guest, which the
  code refuses. The refusal is per id, and at most twenty ids are kept, the oldest dropped
  first; a removed Guest can come back as a new Guest.
- **The link during its match.** Opening it while the lobby's people are in their queue, select
  or match waits in the lobby for the next one, and says so; a member whose seat in it is held is
  offered Rejoin the match. It is never a drop in (ADR 0025 stays the Ranked queue's).
- **A party keeps its lobby.** The host sends the people in the lobby, five at most, into the
  Ranked queue together, once none of them is locked out of it. The lobby waits behind the party:
  Cancel in its queue, and its end screen, go back to the lobby.
- **Kept in memory.** A lobby lives in the server's memory and nowhere else, so a restart forgets
  every one, as it forgets every match, and the page then says the lobby has closed. An open
  lobby nobody is in closes thirty minutes after the last person left, one where nothing happens
  for two hours closes with "Lobby expired.", and one whose match is never reported over opens
  again after three hours.
- **Ceilings.** At most `MAX_LOBBIES` (200) stand at once, playing or not; one more takes the
  place of the open lobby left empty the longest, once that was over three minutes ago, or is
  refused in plain words, as a full server refuses a match. From one connection (its address, an
  IPv6 one folded to its /64; `server/code_guess.ts`): ten lobbies opened in ten minutes, and
  five open at once whose openers are in them; twenty different wrong codes in ten minutes, past
  which neither the socket nor the landing looks a code up, except for a member coming back to
  their own lobby, who is never counted and never refused; five Guest name changes in an hour. A
  code asked again is counted once, a code this server handed out in the last day answers closed
  and is never counted, and no success clears a count. At that pace, the lobbies standing are
  months of trying away from one connection. The cap on sockets per address stands
  (`server/conn_limit.ts`).
- **An account's name passes the word filter.** The invitation card puts the opener's name in a
  sentence the site says to whoever holds the code, and a Guest's chosen name already passes the
  word filter. Registering, renaming and the name a Discord identity gives an account now pass it
  too (a blocked one from Discord is treated as an invalid one), through one helper in
  `server/account_name.ts`. Names already held stay as they are.
- **Not decided here.** A lobby for the battle royale or a Thornfray (ADR 0034: no party, no
  invitation); a lobby kept through a restart.

## Considered and rejected

- **Keeping lobbies an account's, the card pointing at the form.** The form would stand between
  a friend and the first match, which ADR 0024 put first.
- **Rating or scoring a lobby's match.** Its people pick their sides and the rest are house bots:
  the points machine ADR 0027 kept lobbies out of, now open to Guests nobody can hold to a name.
- **Members kept by socket.** A socket lasts one session, and a member comes back on the next.
- **A new code for every match.** The link already shared would stop working.
- **Naming whoever hosts on the invitation.** The host changes as people come and go, and
  whoever holds a code would learn each one's name in turn; the opener's is the one name a code
  gives away, for the lobby's whole life.
- **The host passing to whoever is in the lobby first.** Someone who opened the link during the
  match would hold the lobby when the people who played it come back; the opener, then those who
  played, come first.
- **Holding an away member's seat.** A member who left may not come back, and the seat would turn
  a newcomer away; coming back, they take their side if it has room, else the other.
- **The invitation from the socket.** What the socket does with a code is join, and a visitor
  who has not pressed Join is not in the lobby; the landing already makes the one request a
  screen reads.
- **A route of its own for the invitation.** One more public route that names a person to
  whoever holds a code.
- **Counting every wrong answer.** People who share one internet connection, reloading one closed
  link, would lock each other out; a code is counted once, and a code this server handed out is
  never counted.
- **Answering closed to a connection over its budget.** A lobby still standing would read as gone
  to everyone behind that connection; the card says why it cannot look.
- **A budget per Guest.** A Guest costs one request to make, so a budget per Guest is no budget;
  a connection is what a script cannot multiply as cheaply.
- **Seating a latecomer in the running match, in a bot's seat.** A drop in is the Ranked queue's
  (ADR 0025); a lobby's sides are chosen before its match, and the latecomer chooses theirs for
  the next one.
