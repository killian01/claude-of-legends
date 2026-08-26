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

All four reports landed.

### F.2 Sim/server correctness reviewer (landed)

- [P0][high] FOG LEAK ON THE WIRE: projectiles AND zones go to every client
  unfiltered (server/snapshot.ts), so enemy skillshots and zones appear
  inside the fog and reveal hidden champion positions: a maphack vector,
  violating the fog-on-the-wire invariant. Death events (unit + killer ids)
  are likewise unscoped.
- [P1][high] Root cause of the online death bug confirmed: Sim.isVisible
  tests `u.dead` BEFORE `u.team === team`, so a player's own dead champion
  is invisible to its own team; reproduced through snapshot `gone`.
- [P2][medium] Ghost matches: when every player disconnects, the Match keeps
  ticking and building snapshots until a Sanctum falls; combined with
  never-ending matches (F.0) this is a CPU leak and a DoS vector.
- [P2][medium] Queue double-booking: queueing during an unstarted select
  auto-locks you into that match AND re-queues you; matchId gets overwritten
  and the first match keeps a ghost player.
- [P2][medium] Grievous wounds reduce heals but NOT shields: anti-heal is
  half-ineffective against shield kits.
- [P2][medium] Respawn slot uses `id % 5` while spawn uses team count:
  two same-team champions can respawn on the same exact coordinate.
- [P2][low] Ability dashes bypass roots (executeCast writes pos directly):
  a rooted champion can dash out of the root.
- [P2][low] Auto-attacks keep striking a target that entered stealth (tower
  and minion AI drop it; champion orders do not), and keep chasing targets
  that entered the fog.
- [P2][low] Post-victory, respawns and passive gold keep running; double
  Sanctum death in one tick resolves by Set insertion order.
- [P2][low] buyItem has no negative-cost guard (safe with current data).
- Determinism audit: clean. No wall-clock or unseeded randomness in the sim,
  the only sort has a deterministic tie-break, A* is deterministic.

Expanded report additions:

- [P1][high] SELF-CAST STEALING: executeCast 'self_or_ally' never compares
  the caster (default only), so Mend or a shield aimed at yourself lands on
  any ally within the search radius instead; a dying player pressing Mend
  next to a full-hp ally dies. Fix: the caster competes at distance 0.
- [P1][medium] CC applies to STRUCTURES: piercing skillshots stun towers
  (Torv R) and taunt forces a tower to retarget (Torv W); structures need CC
  immunity.
- [P1][medium] Rooted champions escape with any dash or Riftstep (dash specs
  write pos directly, root only gates path movement).
- [P1][medium] Auto-attacks never release a target that stealths (only
  towers and minions drop it), and sim-side orderAttack accepts stealthed or
  fogged targets (only the server validates for humans; bots and taunts
  bypass).
- [P1][medium] IN-MATCH REJOIN CORRUPTION: a client already in a match can
  send queue or create_lobby (no matchId guard); it ends up in two matches
  whose snapshots interleave into one ClientWorld (colliding ids, wrong
  identities).
- [P2] Death refreshes ability cooldowns (R included): dying is a free ult
  reset; sigil cooldowns correctly persist. Inconsistent and exploitable.
- [P2] isInvulnerable ignores units dying this tick: one ghost-protection
  tick when the outer tower dies.
- [P2] Homing bolts on the wire trace their fogged target's position tick
  by tick (part of the fog leak).
- [P2] Disconnect during select still seats the dead clientId (AFK champion,
  no bot substitution, no reconnection path); commands stay accepted for
  20 s after victory; a repeated match.tick() throw leaves a zombie match;
  static file guard `startsWith(DIST)` lacks a path separator (a sibling
  dist-old would be servable); 60 msg/s of move each trigger a full A*
  (cheap DoS); tower/minion last hits evaporate the 300 g champion bounty
  and kill XP goes to enemies who never participated; no item selling.

## G. Fix plan (batched, in order) — ALL FIVE BATCHES SHIPPED

Status: batches 0 through 4 are implemented, tested (128 green including
the match-must-end acceptance run), and pushed. Full bot matches conclude
on their own in 11.6 to 21.1 minutes across seeds with different winners.
Remaining P1/P2 items not covered by the batches (reconnect, skill points,
champion passives, minion unit collision, potions, camera freedom, fog
terrain dimming, assists, deeper art) stay tracked in docs/roadmap.md and
the sections above.

- **Batch 0, the game must be able to END (sim and balance)**: unstick the
  side-lane minions (waypoint reach radius vs tower footprints), real
  fountain regen (hp and mana), break the wave-annihilation equilibrium
  (siege minion every third wave plus wave scaling), make towers takeable
  (hp/armor tuning, minion damage to structures), accelerate the XP curve to
  the 20-25 min target, stop bots from suicide-diving towers, expose
  structure invulnerability in the Policy observation, let bots buy
  duplicate components, seed-driven match variety, guard post-victory
  respawn and gold.
- **Batch 1, death and combat readability**: fix the online death end to end
  (dead allies stay in the snapshot with a dead flag, SLAIN overlay online,
  camera holds), floating combat text with last-hit gold, self and enemy
  status display, cast and hit feedback (telegraphs, flashes), health bar
  redesign (backing, borders, self marker, champion vs minion), legible kill
  feed (team colors, unique bot names, killed-by-tower), semi-transparent
  minimap above-fixed shop, game clock and XP bar.
- **Batch 2, information and controls**: tooltips everywhere (abilities,
  sigils, items) from the data records, keybind hint bar, shop icons and
  HUD inventory, buy feedback, richer select screen (kit summaries, random
  button, team uniqueness enforced), match start countdown and
  announcements, Tab hold fix, Escape menu, recall on B (shop stays on P),
  attack-move on A, team chat and pings.
- **Batch 3, visual and audio identity**: distinct champion silhouettes and
  nameplates, per-champion VFX tinting, map art pass (river, bases, wall vs
  brush contrast), procedural item and ability icons, minimap champion
  marks, a minimal procedural SFX set (attack, cast, kill, tower, victory).
- **Batch 4, correctness and server hardening before any public URL**:
  fog-filter projectiles, zones, and death events; reap ghost matches; queue
  double-booking and in-match rejoin guards; self-cast preference fix; CC
  immunity for structures; rooted dashes; stealth released by auto-attacks;
  no cooldown refresh on death; grievous vs shields; respawn slots; cost
  guard; post-victory command and respawn freeze; static path guard.

### F.3 Browser UX reviewer (landed; 31 screenshots, zero console errors)

Confirms with evidence (already listed above): the ONLINE DEATH P0 (died 3
times, never saw a death screen, HUD frozen at 50/650, camera teleported to
map center), invisible casts, zero control hints, blind champion/sigil
select with no tooltips anywhere, no damage feedback, unreadable statuses,
no recall and fountain that does not heal, no XP bar, total silence, fog
with no visual feedback, no chat or pings.

New findings:

- [P1][high] The opaque minimap HIDES the world behind it, including enemy
  towers and champions mid-fight; the shop panel itself renders UNDER the
  minimap (last items hidden).
- [P1][high] World health bars nearly unreadable: hairline-thin, light on
  light lanes, stair-stacked in waves, same size for champions and minions,
  no mana or level over heads.
- [P1][high] Kill feed illegible: tower deaths read "The lane killed guest";
  bot names repeat identically on BOTH teams with no team color anywhere.
- [P1][high] Inventory invisible outside the shop panel; failed buys are
  100% silent (no toast, nothing).
- [P1][high] Sigil cooldowns render as raw "210" covering the D/F letters;
  trivially wasted with no tooltip warning of a 210 s cooldown.
- [P1][high] End of match: VICTORY/DEFEAT for ~20 s then a hard page reload,
  no stats, no rematch, no warning; disconnection likewise.
- [P1][medium] Walls vs brush indistinguishable (dark green discs vs green
  discs); nothing shows what blocks movement vs what conceals.
- [P1][medium] Locked high camera, no zoom: champion ~30 px; at the base
  more than half the screen is off-map void (looks broken at spawn).
- [P2] Empty name silently becomes "guest"; no input placeholder.
- [P2] "Practice vs dummies (offline)" actually launches a full bot 5v5:
  misleading label.
- [P2] Select screen: enemy team shows "-" forever; a third sigil click
  silently ejects the oldest; nothing says which sigil lands on D vs F.
- [P2] HOLDING Tab (the MOBA reflex) makes the scoreboard flicker open and
  closed on key repeat.
- [P2] Scoreboard lacks assists/CS/gold/items; teams labeled Team 1/2
  without marking yours.
- [P2] No game clock, no CS counter, no personal KDA outside Tab; 8 px
  ability names unreadable; "Lv6" covers the R name.
- [P2] Escape does nothing: no pause/options/quit menu at all.
- [P2] No order feedback on attack clicks (no target marker); move marker
  only 0.6 s; off-map clicks silently ignored.
- Works well (preserve): the whole menu-queue-select-game flow is smooth
  and error-free, minimap right-click move, auto-lock countdown, honest
  "Return to your fountain to buy" message, window resize.

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
