# Roadmap

Living document. The 48 hour build scope is defined by the ADRs in `docs/adr/` and the ongoing design sessions; this file records what is deliberately deferred.

## Shipped since the review

- **The passive-hook system** (batch 7): ChampionPassive hooks
  (onAttackHit, modifyDamage, onTick, onHealGiven) with all ten roster
  passives implemented as code-bearing content, tuned against full bot
  matches. New champions with passives remain the flagship community
  contribution.
- **Skill points and ability ranks** (batch 7): one point per level,
  basics to rank 5, R free at 6 and point-gated at 11/16, +22 percent
  base and -6 percent cooldown per rank, HUD pips and + buttons, additive
  Policy contract fields, `skill` wire message.
- **Lane essentials** (batch 6): tower aggro switch on champion
  aggression, fountain true damage, idle auto-defense, minion soft
  collision, minion aggro on champion attackers.
- **Out-of-game** (batch 8): end-of-match stats screen (no more hard
  reload), champion roster browser and role-labeled champion select.
- **Champion skins** (batch 9): three cosmetic palette skins per champion
  (data in `src/sim/content/skins.ts`), picked at champion select, carried
  in the snapshot identity block, rendered with a team-colored base ring
  so allegiance always reads. New skins are an easy community
  contribution; real 3D skins ride the deferred model pipeline below.

- **The environment** (batch 10, Phase 2 of ADR 0002): a match stepped from
  outside the repo over NDJSON on stdio (`headless/`), one step per decision
  slot, with remote policies driven through the same dispatch, the same slot
  schedule, and the same decision budget as in-sim bots. Pinned by a parity
  test: the same policy attached in-sim and driven remotely produces the
  identical world.

## Future options (explicitly deferred)

- **Bots on the account** (playbooks, the Academy, coach orders, the Arena,
  the Briefing): built on `feature/bots`, `docs/design/bots.md` and
  `docs/plan-bots.md`; the follow-ups listed there (house bots obeying
  team pings, bot sharing, bots on forged champions, style presets,
  seasons) remain deferred.
- **Reconnect to a live match**; a bot substituting for a disconnected
  player.
- **Post-review polish tail**: health potions, assists, camera freedom,
  range indicators, fog terrain dimming.

- **Model-weights registry and server-side inference** for community-trained RL bots. For now trained bots join as normal clients only (bot-as-client, see ADR 0002).
- **Gymnasium bindings** over the environment stream (`headless/README.md`). The NDJSON stdio environment itself has shipped; the Python wrapper around it has not.
- **Remote policies on the live server**: a trained bot connecting to the real server as a client (bot-as-client, ADR 0002). The sim seams exist (`Sim.addRemoteSeat`, `queueRemoteAction`, `takeRemoteObservation`); the wire messages and the seat handshake do not.
- **In-game map editor pipeline** (world-of-claudecraft pattern: editor to JSON to compiled TS module) and community-contributed map variants.
- **Offline practice mode**: shipped (the Practice tile on the home boots a full local bot 5v5); a true practice range with target dummies remains deferred.
- **Accounts, persistence, ranked matchmaking.**
- **Mobile controls.**
- **Visual upgrade of the map and units** (models, textures, terrain detail, VFX). Deliberately deferred: the renderer sits behind the IWorld seam, so art improves without touching gameplay code. A bounded readability and polish pass happens in phases 8 and 9 of the sprint; the real art pass is a flagship community contribution (the world-of-claudecraft image-to-GLB pipeline is reusable for champion and prop models).
