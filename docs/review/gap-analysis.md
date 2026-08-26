# Gap analysis: what is missing to be playable

Master review checklist, opened after the first real playtest. Sources: the
maintainer's playtest findings, an exhaustive feature comparison against
the genre-defining MOBA, and the four fresh reviewer reports (merged below as they
land). Severity: **P0** = a new player cannot play or understand the game
without it; **P1** = hurts the experience badly; **P2** = polish or
deliberately deferred (tracked in docs/roadmap.md).

## Maintainer playtest findings (verbatim intent)

- No last-hit feedback: you cannot see gold earned or that a kill was yours. [P0]
- No way to discover the shop or ANY shortcut: zero keybind hints on screen. [P0]
- You cannot understand your champion or its spells: no tooltips, no
  descriptions, generic visuals. [P0]
- You cannot understand items: no tooltips beyond a stat line, no icons. [P0]
- Almost no animation; you do not understand when the game starts or what is
  happening. [P0]
- Overall design (items, spells, map, everything) needs a full pass to reach
  the world-of-claudecraft bar. [P1, ongoing]

## A. Combat readability and feedback

- [P0] Floating combat text: damage numbers, heals, and the gold popup on a
  last hit (the last-hit loop is invisible today).
- [P0] Own status display: you cannot see that you are stunned, rooted,
  slowed, shielded, or marked. Fairness rule (adopted from woc): never hide
  information a player acts on.
- [P0] Enemy CC telegraphs: a stunned or rooted enemy looks identical to a
  free one.
- [P1] Cast feedback: abilities fire with zero animation or windup; attacks
  are instant bolts with no swing.
- [P1] Hit feedback: no flash or shake when you take damage.
- [P1] Death feedback: units vanish instantly, no death state, no death recap
  (why did I die).
- [P1] Distinct VFX per ability (today every projectile and zone looks the
  same, tinted by team only).
- [P2] Level-up visual and announcement.

## B. Onboarding and information surfaces

- [P0] Keybind hints on the HUD: nothing tells the player about P (shop),
  Tab (scoreboard), D/F (sigils), right-click semantics.
- [P0] Ability tooltips on hover: name, description, damage, cooldown, cost,
  range, for your own 4 spells and 2 sigils.
- [P0] Item tooltips in the shop: what the stats mean, build paths, and item
  icons (text-only today).
- [P0] Match start sequence: a countdown, "minions spawn in 10s", any signal
  that the game began.
- [P0] Game timer on the HUD (there is no clock at all).
- [P1] Champion identity at select: role, difficulty, kit summary (today:
  names only).
- [P1] Announcements: first blood, tower destroyed, victory/defeat reasons.
- [P1] XP bar (experience progress is invisible today; only the level shows).
- [P1] Team kill totals on a top bar.
- [P2] Death recap details, damage breakdown.

## C. Core gameplay missing vs the genre-defining MOBA

Promised by docs/design/game-definition.md and absent:

- [P0] Recall (B, 8s channel). Today you must WALK home; nothing explains it.
- [P0] Attack-move (A key).
- [P1] Skill points: one per level to rank abilities (today: fixed numbers,
  only the R level gate exists).
- [P1] XP proximity share semantics documented vs implemented (verify).

Genre essentials never specced but expected by any MOBA player:

- [P0] Tower aggro switch: attacking an enemy champion under their tower MUST
  pull the tower onto you. Without it, tower dives are free and laning is
  broken.
- [P0] Fountain safety: the enemy fountain does not damage divers; backdooring
  the fountain area is free.
- [P0] Idle auto-defense: a champion standing still never fights back.
- [P1] Minion aggro rule: minions should turn on a champion who attacks a
  nearby allied champion (core laning pressure).
- [P1] Health potions (or equivalent) for early laning sustain.
- [P1] Cannon-style siege minion every few waves; minion scaling over time.
- [P1] Unit collision among minions (waves stack into one blob today).
- [P1] Stop (S) and hold position (H) commands.
- [P1] Assist credit and assist gold.
- [P2] Shutdown/kill-streak bounties.
- [P2] Camera unlock, edge pan, zoom, space-to-center (locked follow only).
- [P2] Range indicators while aiming an ability.
- [P2] Attack/move cursor differentiation and click-on-target highlight.
- [P2] Target frame (click an enemy to inspect their HP/items).

Multiplayer essentials:

- [P1] Pings (alert/danger on map and minimap).
- [P1] Team chat.
- [P1] Reconnect to a game in progress (today a refresh loses the match).
- [P2] AFK detection, end-of-game stats screen.

Deliberately cut for v1 (confirmed fine, tracked in roadmap): jungle camps,
neutral objectives, wards/trinkets, runes, draft mode, surrender, spectator,
emotes, item actives.

## D. Audio

- [P1] There is no sound at all: no SFX for attacks, casts, kills, towers,
  no ambient, no music, no announcer. Even a minimal SFX set (attack hit,
  cast, kill, tower shot, victory) transforms readability.

## E. Visual design (the woc bar)

- [P0] Champion visual identity: all ten champions are IDENTICAL capsules in
  team colors. Minimum: distinct silhouette (shape/size/headpiece) and color
  accent per champion, plus a nameplate (name + level) over every champion.
- [P1] Map art pass: ground texture variation, river band, base areas,
  jungle floor, decorative props (procedural, in the woc spirit).
- [P1] Item icons (procedural 2D icons are enough; woc generates icons).
- [P1] Ability icons (letter-only today).
- [P1] Minimap: champion icons or initials instead of anonymous dots.
- [P2] UI art pass on panels and frames; fog-of-war terrain dimming; day
  cycle or atmosphere.

## F. Reviewer reports

Pending: sim/server correctness, browser UX.

### F.0 Playability-by-simulation reviewer (landed)

Verdict: a full 5v5 bot match NEVER ends. Three seeds, 10 sim-minutes: zero
towers destroyed, both Sanctums intact, all champions AFK at their fountains
by minute 10. Root causes, all measured:

- [P0][high] MATCH NEVER ENDS: convergence of the three findings below.
- [P0][high] TEAM 1 SIDE-LANE MINIONS STUCK FOREVER: the top and bot tier-1
  towers at (50,137) and (137,50) sit exactly ON lane polyline waypoints;
  their navgrid footprint pushes the nearest walkable cell to ~2.12 from the
  waypoint, beyond WAYPOINT_REACHED = 2 in minion_ai.ts, so laneProgress
  never advances. 56 minions measured stacked per side lane at 6 min, while
  team 0 waves arrive 5 at a time and get slaughtered: frozen side lanes and
  a structural asymmetry favoring team 1. Fix: reach radius vs footprints,
  or move waypoints off tower spots.
- [P0][high] FOUNTAIN REGEN MISSING (confirms F.1): healing 32% to 85% at
  base regen takes a measured 337 s; by minute 10 both entire teams idle at
  their fountains (51-84% of champion time AFK at base). Mana never refills
  either.
- [P0][high] TOWERS ARE MECHANICALLY UNKILLABLE: 2500 hp and 40 armor vs a
  champion's ~26 dps means ~96 s of uninterrupted dps while the tower kills
  a full-hp fighter in 5.1 s; and opposing minion waves annihilate each
  other exactly (spawn cadence = kill cadence, measured), so minion pressure
  never reaches a tower. No tower falls, so no Sanctum, so no end.
- [P1][high] Unbounded entity growth: minions 41 to 210 in 10 min
  (+19/min net), tick cost 0.43 to 1.17 ms and climbing linearly.
- [P1][high] XP curve far too slow for the 20-25 min target: levels 2-4
  after 10 min; level 6 nearly unreachable, so ultimates are dead content.
- [P1][high] The laner bot suicide-dives towers: it attacks structures at
  FARM_RANGE 8 while towers reach ~9 plus radii, and only flees at 32% hp;
  10 of 23 deaths were to towers.
- [P1][high] The Policy observation cannot express structure invulnerability
  (ObsUnit has no flag; dealDamage silently ignores protected structures):
  an ADR 0002 contract gap, bots waste commands on immune targets.
- [P1][high] Every all-bot match is IDENTICAL across seeds: the sim Rng is
  never consumed anywhere and bots are deterministic, so zero match variety.
- [P1][medium] Bot shopping cannot complete two-component recipes needing
  duplicates (won't buy a second heart_gem for colossus_heart); no tier 2
  ever completed; gold pools unspent.
- [P1][medium] Out-of-game time is crushing: ~40 s per early death
  (respawn 8+1.5xlevel plus a 28.6 s walk to mid), 5-6 min per retreat.
- [P2][high] A move order onto a structure's footprint strands the unit
  beside it with no terminal state.
- [P2][low] The stacked minion blob (no unit collision) is a degenerate AoE
  farm and bodyblocks better than the tower it hugs.
- Healthy signals: no projectile/zone leaks, per-seed determinism holds,
  champion-vs-champion kills do happen (23 in 10 min), bots buy, level, and
  fight; they are alive in lane, just unable to close or defend a game.

### F.1 Spec-coverage reviewer (landed)

Confirms (already listed above): recall, attack-move, skill points, own and
enemy status display, keybind discovery, game clock, projectiles and zones
crossing the fog unfiltered.

New findings:

- [P0][high] ONLINE DEATH BUG: a dead champion vanishes from the mirror
  world (`Sim.isVisible` false for dead, snapshot puts it in `gone`,
  ClientWorld deletes it): no death screen online, HUD frozen, camera falls
  to map center. Reproduced by test. Fix: keep own-team dead champions in
  the snapshot.
- [P1][high] "Full regen at fountain" promised, only base regen exists:
  healing at home takes minutes (bots idle at the fountain because of it).
- [P1][high] No-duplicate-champions-within-a-team is enforced for bots only;
  two humans on one team can lock the same champion.
- [P2] Select screen: no random button; 45 s deadline vs the promised 60 s.
- [P2] Respawn scales with level, not game time as promised.
- [P2] Kit fidelity vs roster.md (beyond deferred passives): no knockup or
  knock-aside primitives (Korrath R stuns instead), Fenn R not untargetable,
  Ashvyn E root unconditional (no max-range logic), Dain W single pulse,
  Torv Q pushes everyone at landing, dashes are instant teleports (dash and
  blink conflated), no vision-granting zone primitive.
- [P2] ADR 0003 drift: rate and cap hardcoded (not configurable); a bot
  gets ONE action per 250 ms window while a human can move and cast in the
  same window (a structural human advantage the ADR rejects); the
  cast-applies-next-tick semantics and the headless parity test do not exist
  yet; a budget-rejected cast gives the player zero feedback.
- [P2] Shop button disabled state ignores the component discount (full price
  check) so buyable upgrades can look unaffordable.
- [P2] Ship-readiness: no Dockerfile; README still says "day 0, the code
  lands next"; roadmap.md never mentions the passive-hook system that
  champion files point to.
- [P2] ADR 0001 partially honored: no monolith line-count ratchet test, no
  persisted golden trace (double-run in-process only).
