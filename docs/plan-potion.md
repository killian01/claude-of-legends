# The Sapdraught build plan

Issue #3 asks for a cheap health potion: one bag slot, a click or a key to drink it, a heal
over a few seconds. It softens an early lane mistake without moving the item economy. It
touches the sim, the policy contract (an additive v0 action, ADR 0005), the wire, the HUD on
a desktop and on a phone, and the house bots, which must drink by the same rule in the same
change. This file is the proposal; every choice under "Proposed" is a default the maintainer
can overturn before the first phase lands.

## Proposed

| Topic | Choice |
|---|---|
| Name | **Sapdraught**: an original compound (sap, the Orchard's trees; draught, a drink), searched for IP on 2026-10-04 and clean. It goes into `CONTEXT.md` with phase 1. |
| Price | 50 gold, tier 1, no `stats` (so `recalcChampion` folds nothing in), sold back at the usual 70 percent. |
| Carrying | One per bag slot, no stacking (a stack count would add a field to the bag on the wire and in the observation). At most two carried, so a bag is never filled with them. |
| Effect | 150 health over 10 s, stepped every tick like the damage over time (`stepDots`, `sim.ts`). A status on the unit, `{ kind: 'draught'; until; perSecond }`, beside the recall's (`combat/status.ts`). |
| Damage | Does not cancel it. A canceled drink is a trap a newcomer cannot read; the 10 s length is what keeps it weak in a fight. |
| Repeat | One draught at a time: a drink while one is running is refused, and the Sapdraught stays in the bag. |
| Recall | A drink is not an order: it does not cancel a recall channel, and a recall does not cancel it. |
| Budget | Free, like `recall` and `sell` (ADR 0003 spends tokens on casts and sigils only). The one-at-a-time rule is its own limit. |
| Where | Bought at the fountain like every item (or anywhere while dead); drunk anywhere, alive. |
| Battle royale | Absent: the shop is refused there and loot only draws from the house builds, which never name it (`royale/loot.ts`). The drink action is refused in a royale like `recall`. |

## The seams

- **Item**: `ItemDef` (`src/sim/content/items.ts`) gains an optional `drink?: { heal: number;
  seconds: number }`; an item with it is a consumable. The table stays the one source.
- **Action**: `{ kind: 'drink'; slot: number }` in `Action` (`src/sim/policy.ts`), additive v0,
  dispatched in `src/sim/action_dispatch.ts` beside `sell` (same slot check) to a new
  `src/sim/draught.ts` (start, step, the guards), never appended to `sim.ts` beyond the call.
- **Observation**: `self.drinking?: number`, the seconds left (additive v0), beside
  `self.recalling` in `src/sim/observe.ts`. The bag is already `self.items`.
- **Contract text**: one line in `headless/README.md` with the other additive actions, and the
  parser in `src/net/policy_wire.ts`.
- **Wire**: `{ t: 'drink'; slot }` in `ClientMsg` (`src/net/protocol.ts`), sent from
  `src/net/client_world.ts`, applied by `applySimCommand` (`src/net/replay.ts`) so live play and
  the replay agree; the kind joins `SEAT_ORDER_KINDS` in `server/match.ts`.
- **Desktop**: a left click on a bag slot holding a Sapdraught drinks it (the right click
  still sells); the keys 1 to 6 drink from that slot. The hints and the first steps name it
  only once it is carried.
- **Phone**: the bag at `scale(0.62)` is far under a finger, so the touch bar
  (`src/ui/touch_bar.ts`) shows a Drink button while one is carried, greyed while a draught
  runs. Checked at 844x390 with touch, both schemes.
- **House bots**: the kits (`src/sim/playbook/kit.ts`) open with one Sapdraught when the first
  shop leaves 50 gold spare, then the build as before; the laner playbook
  (`src/sim/content/playbooks/laner.ts`) gains a play `{ when: hp below 0.55 and not
  atFountain; do: drink }` above its `retreat`. A playbook `do` kind `drink` (it passes to the
  next play when no Sapdraught is carried or one is already running, so the trigger language
  needs nothing new) joins the interpreter (`src/sim/playbook/`) and the validator, so an
  Academy bot can write it too; stored playbooks stay valid, the change is additive.
- **Look**: a painting under the item icons is optional (the manifest test lists what is on
  disk); the shop card reads "Drink: 150 health over 10 s".

## The phases

1. **The sim and the contract** (landed 2026-10-05; `src/sim/draught.ts`, `tests/draught.test.ts`). The item, the status, the action, the observation field, the
   wire message, the replay path, `CONTEXT.md` and `headless/README.md`. The shop and the bots
   do not offer it yet (`buyItem` refuses a consumable until phase 2), so nothing a player sees
   changes. Tests: a drink heals 150 over 10 s and empties the slot; refused while one runs,
   dead, in a royale, or on a slot without one; damage does not stop it; recall survives it;
   the replay of a drink matches the live match; the remote policy path parses and applies
   it. One night.
2. **People and bots together** (landed 2026-10-06; `tests/draught_bots.test.ts`). On the
   touch bar Drink rides beside the bottom button on the right edge (the column has no room
   between the score box and the minimap) and as a fifth row on the left. The kit walker
   carries one Sapdraught whenever the build has nothing to buy and a slot is spare
   (`draughtStep`, `kit.ts`), not only at the start; every house style leads with the shared
   `DRINK_PLAY` (`content/playbooks/drink.ts`). Left for later: the Drink button greyed while
   a draught runs online (`ccChips` in `server/snapshot.ts` and `toStatus` in the client
   world do not carry `draught` yet), and a painting for the icon. The shop lists it, the desktop click and keys, the phone's
   Drink button, the house kits and the laner's play, the playbook `drink` kind. Tests: a
   house bot buys one at the start and drinks under the same guard a person meets (through
   `action_dispatch`, not a side door); the validator accepts the new `do` kind. Checked in a
   browser on a desktop and at 844x390. A News entry. One night.
3. **Tuning**, only if matches show it: the price, the heal, the carry cap. Numbers in the
   item table, no code.

## Open for the maintainer

- Damage canceling the heal (the issue left it open); the plan says no.
- Whether a drink should spend a decision token; the plan says no, for the reason above.
- Whether forged champions' and Academy bots' builds may name it (the plan lets them).
