# Meta-game review: what a MOBA has around the match, and what we lack

Status: full feature review of the out-of-game layer (August 2026). This is
the companion to `out-of-game-review.md`, which covered shipping, ops, and
hardening; almost everything on that list has since landed (Docker, README,
reconnection, settings, lobby TTL, per-IP caps). This document covers the
missing PRODUCT: identity, ranking, history, profiles, social, spectate.

## Where the project stands today

Everything a player is lives in their browser: `loc-name` (display name),
`loc-token` (reconnect token), `loc-settings` (audio). The server keeps
zero state across restarts; a match that ends is gone without a trace. The
end screen shows a stats card and a "Return to menu" button that is
`window.location.reload()`. Matchmaking is a FIFO queue with opt-in bot
fill, plus private lobbies whose teams alternate by join order.

Consequences, stated plainly:

- Two players named "bob" are indistinguishable everywhere.
- No match leaves a record; there is nothing to rank, list, or review.
- You cannot play WITH a friend: lobby seats alternate teams by join
  order (`matchmaker.ts` `(i % 2)`), so a duo always lands on opposite
  sides and there is no team picker.
- Every match costs a full page reload to leave; rematch does not exist.

## The gap map

### 1. Player identity (the keystone; everything below depends on it)

Missing: any durable notion of "this player". Rankings, history, and
profiles are all keyed by identity; none can exist before it does.

What fits here: NOT accounts. No passwords, no email, no OAuth; that is a
liability and a signup wall a ten-champion browser MOBA does not need. We
already have the right primitive: `loc-token` proves "same browser" for
reconnection.

FIXED: `server/players.ts` promotes the token to a persistent player
record (id, name, per-name discriminator, created and last-seen); every
hello creates or refreshes it, and handles display as `bob#4821`. Still
open: a "recovery code" flow to move an identity to another browser.

### 2. Server persistence (the enabling layer)

Missing: any storage at all. Options, given the tiny-dependency rule:

- A JSON file store module (atomic write via rename, load on boot).
  Zero dependencies, trivially testable, fine for hundreds of players.
- SQLite (`better-sqlite3`): proper queries, but a native module that
  complicates the slim Docker image and the Windows dev loop.

FIXED as recommended: `server/store.ts` over JSON files
(`data/players.json` atomic tmp-then-rename, `data/matches.jsonl`
append-only with torn-line tolerance), `DATA_DIR` overridable, the
Docker image ships a node-owned `/app/data` for the volume.

### 3. Match results and history

Missing: the server discards the match at the victory event. It already
holds everything worth keeping in `ScoreRow` (kills, deaths, assists, cs,
level) plus winner, duration, champions, and which seats were human.

FIXED: the moment a winner lands, `server/records.ts` builds one record
from the final scoreboard (seats held by a connected human carry their
playerId, bot fill and walk-outs carry null) and it is appended to the
match log. "Recent matches" shows on the home career panel with result,
champion, KDA, CS, duration, and date.

### 4. Ranking and leaderboard (the headline request)

FIXED, with the policy exactly as proposed: `server/rating.ts` is team
Elo (average vs average, every human on a team moves together), a match
is rated only with at least one human on each side, K scales with the
human count, and bot seats never move. Ratings and rated-game counts
persist on the player record; each rated match embeds the signed delta
in its record, shown on the career panel's recent list. `server/ladder.ts`
serves `GET /api/ladder` (top 50, three rated matches to place), and the
home screen's Ladder panel renders it with each row expandable into that
player's public profile (`/api/player/:id`).

### 5. Profiles and career stats

MOSTLY FIXED: `server/profile.ts` derives games, winrate, K/D/A, and
per-champion lines from the match log at request time; the home screen
gained "Profile and history" (`/api/me` by token). `/api/player/:id` is
already public for other players, but no UI links to it yet; that
arrives with the ladder. Rating joins once ranking exists.

### 6. Post-game screen and match lifecycle (no more reload)

FIXED in the change that landed after this document: every exit
(end screen, escape menu, notices, queue and lobby cancels) is now an
in-app transition. `src/game/flow.ts` routes the exit action, every
layer gained a real teardown (`Presentation.dispose` in boot.ts sweeps
input, HUD, minimap, renderer, music), the end screen gained "Play
again" (offline: same pick replayed; online: back into the public
queue), and a deliberate leave tells the server to hand the champion
to a bot with NO seat reservation (`server/main.ts` 'leave'), so
requeueing after walking out no longer yanks the player back into the
abandoned match. `window.location.reload()` is gone from the client;
`scripts/e2e_lifecycle.mjs` drives both scenarios.

The rating delta landed with ranked integrity: the server sends each
human a `match_result` (rated flag, signed delta, new rating) the
moment the match is recorded, and the end screen shows it above the
final scoreboard.

### 7. Social: parties, invites, team choice

Missing: any way to play together on purpose, beyond reading a lobby
code aloud.

- FIXED: lobby team picker. The lobby screen shows two team columns
  with a switch button ('lobby_team' message); joins balance sides by
  default, a full side refuses, and the chosen sides survive into the
  match, so a duo vs bots finally works.
- FIXED: invite links. 'Copy invite link' in the lobby yields
  `/?join=CODE`; a visitor with a stored name deep-links straight into
  the lobby, a first-timer gets the home screen with the code
  prefilled (src/game/invite.ts, consumed once at boot).
- FIXED: party queue. The lobby host can "Queue as a party" (up to
  five): the whole lobby enters the public queue as one group, both
  screens swap to the queue, and `server/party.ts` packs whole groups
  onto the two sides (balancing solos across teams, so mixed matches
  stay rateable). Groups that cannot pack simply wait their turn.
- Friends list / presence: needs identity first; defer until profiles
  exist and demand is proven.

### 8. Spectator and replays

Missing: both. Notable because the architecture makes them unusually
cheap and the old review already called this out:

- FIXED: replays, exactly as sketched. `src/net/replay.ts` is the
  shared construction and command-application path (server/match.ts
  builds and applies THROUGH it, so live and replay cannot drift), the
  server saves (seed, picks, events) per finished match under
  data/replays (last 40 kept), and a Watch button on the career panel
  runs the match in the browser behind a read-only world with a
  REPLAY bar (pause, 1x/2x/4x, exit). Disconnect takeovers and rejoins
  replay too. tests/replay.test.ts pins the exact-state round trip.
  Still open: timeline scrubbing and a free camera.
- Spectator (live): still open; a fog-free (or delayed) snapshot
  stream to a client with no seat; the fog-scoping code already
  branches per recipient. Effort: medium.

### 9. Progression and cosmetics

Missing: account levels, unlocks, mastery. Deliberately thin today:
all champions and skins are free picks. Recommendation: keep everything
free (it is a portfolio game, not a store); if progression is wanted,
make it purely cosmetic and derived from the match log (champion mastery
levels on the profile, title strings on the loading screen). Effort:
small, but only worth it after profiles exist. No monetization, ever,
without a licensing review of the CC0 asset base.

### 10. Ranked integrity (only once ranking exists)

Rating creates incentives; these arrive with it, not before:

- FIXED (walk-outs): a deliberate leave from a live rated-eligible
  match costs a flat rating penalty (no rated game counted) plus a
  60 second queue lockout with a clear refusal message; a dropped
  connection is never punished, its seat reservation and the rejoin
  grace stand. AFK detection (present but idle) remains open.
- Name squatting and impersonation: solved by the discriminator.
- Smurfing: accept it; token identity makes new identities free and
  fighting that means accounts, which we rejected.
- FIXED (boosting): matches carry their source from the matchmaker,
  and only public-queue matches can be rated; a private lobby match
  never touches rating, whatever its seats.

## Dependency graph

```
storage (2) -> identity (1) -> match log (3) -> rating+ladder (4)
                                     |               |
                                     v               v
                              profiles (5) <- post-game delta
lifecycle/no-reload (6)  [independent, unlocks rematch and all meta screens]
lobby team picker + invite links (7a)  [independent, no storage needed]
spectator/replay (8)  [independent]
progression (9), integrity (10)  [after 4 and 5]
```

## Recommended order of attack

1. DONE: match lifecycle without reload plus the post-game exits (6).
2. DONE: lobby team picker and invite links (7a).
3. DONE: storage module plus player identity (2, 1).
4. DONE: match log, history, career panel (3, 5).
5. DONE: Elo, the ladder screen, and rating deltas in history (4),
   then the delta on the in-game end screen and ranked integrity for
   walk-outs and lobby boosting (10).
6. DONE: party queue (7).
7. DONE: deterministic replays with the in-browser viewer (8).
8. Then by appetite: live spectator (8), mastery cosmetics (9),
   AFK detection (10), a friends list if demand shows up (7).
