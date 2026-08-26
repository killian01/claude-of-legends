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

## F. Reviewer reports (to merge)

Pending: playability-by-simulation, spec-coverage, sim/server correctness,
browser UX. Their findings land here with the same severity scale.
