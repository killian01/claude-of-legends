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
reconnection. Promote it to a persistent player record server side:
token -> { playerId, handle, createdAt }. Handle uniqueness via a
discriminator (`bob#4821`) so display names stay free. Add an explicit
"recovery code" the player can copy to move their identity to another
browser. Effort: small, once storage exists.

### 2. Server persistence (the enabling layer)

Missing: any storage at all. Options, given the tiny-dependency rule:

- A JSON file store module (atomic write via rename, load on boot).
  Zero dependencies, trivially testable, fine for hundreds of players.
- SQLite (`better-sqlite3`): proper queries, but a native module that
  complicates the slim Docker image and the Windows dev loop.

Recommendation: a small `server/store.ts` module over JSON files
(`data/players.json`, `data/matches.jsonl` append-only), behind an
interface so SQLite can replace it if the files ever hurt. Effort: small.
Test-first like everything else.

### 3. Match results and history

Missing: the server discards the match at the victory event. It already
holds everything worth keeping in `ScoreRow` (kills, deaths, assists, cs,
level) plus winner, duration, champions, and which seats were human.

Wanted: on victory, append one match record; serve `GET /api/history/:playerId`
and show "Recent matches" on the profile (result, champion, KDA, duration,
date). Effort: small once storage exists. Record whether each seat was a
human, a bot fill, or a disconnect takeover; every consumer below needs
that flag.

### 4. Ranking and leaderboard (the headline request)

Missing entirely: no rating, no ladder, no way to say who is good.

What fits here: Elo (or Glicko-1 if we want confidence), one rating per
player, updated at match end from the team result; the deterministic sim
does not help here, this is pure bookkeeping. The design problem specific
to us is BOTS: today most matches are one human plus nine fill bots.
Policy proposal:

- A match is RATED only if it has at least one human on each team.
  Bot-filled seats neither gain nor lose rating.
- Rate it as team Elo: average team rating vs average team rating,
  K scaled down when few humans are involved.
- Everything else (solo vs bots, practice) records history and stats
  but never touches rating.

Leaderboard: `GET /api/leaderboard` (top 50 by rating, min 5 rated
matches), a "Ladder" tab on the home screen. Effort: medium; the rating
math is a small pure module with table tests, the rest is one endpoint
and one screen.

### 5. Profiles and career stats

Missing: any aggregate view of a player. Wanted: profile screen (own by
default, anyone from the leaderboard) with games, winrate, rating, and a
per-champion table (games, winrate, KDA, cs per minute). Cheap to derive
from the match log at request time at our scale; no precomputation
needed. Effort: small-medium, mostly UI.

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

Still open from this section: the rating delta on the post-game once
ranking exists.

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
- Party queue: a group that queues together and lands on the same team.
  Effort: medium.
- Friends list / presence: needs identity first; defer until profiles
  exist and demand is proven.

### 8. Spectator and replays

Missing: both. Notable because the architecture makes them unusually
cheap and the old review already called this out:

- Replay: record per-tick command streams plus the seed server side
  (the sim is deterministic); replay is "re-run the sim and render".
  Storage is kilobytes per match. Effort: medium, mostly UI (timeline,
  speed, free camera).
- Spectator: a fog-free (or delayed) snapshot stream to a client with
  no seat; the fog-scoping code already branches per recipient.
  Effort: medium.

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

- Dodge and AFK: leaving a rated match already triggers bot takeover;
  add a loss plus a short queue lockout for the leaver, and make
  "reconnected within grace" erase the penalty.
- Name squatting and impersonation: solved by the discriminator.
- Smurfing: accept it; token identity makes new identities free and
  fighting that means accounts, which we rejected.
- Boosting via private lobbies: private lobbies are never rated.

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
3. Storage module plus player identity (2, 1). The keystone batch;
   pure modules, heavy on tests.
4. Match log, history, profile screen (3, 5).
5. Elo plus ladder screen plus rating delta on the post-game (4), with
   the rated-match policy above.
6. Then by appetite: party queue (7), replays and spectator (8),
   mastery cosmetics (9), ranked integrity (10).

Batches 1 and 2 need no persistence and could ship this week; batch 3 is
where the server grows a disk for the first time and deserves its own
careful change with a store parity test.
