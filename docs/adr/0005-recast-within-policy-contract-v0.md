# Recast is allowed within policy contract v0

Contract v0 (ADR 0002) freezes the action space, and `{ kind: 'cast', key, x, z }` carries no
room for hold-to-charge, toggles, or target-id casts. A recast, however, is just the same action
sent twice: pressing the key again inside a server-declared window resolves a follow-up, so the
wire format, the observation shape (`abilityReady` flips back on while the window is open), and
the decision budget (each press costs a token, ADR 0003) are all untouched. We therefore treat
recast as an additive semantic within v0 rather than a contract break, and allow it sparingly:
at most a few kits carry one (kits v2 uses exactly one). Hold-to-charge, toggles, target-id
casts, extra ability slots, and channels remain forbidden; they genuinely change the contract.

## Consequences

- A trained Phase 2 bot must learn that a ready ability key can mean "recast armed", not only
  "fresh cast"; the contract documentation must state which abilities carry a window.
- The windup and telegraph rules apply to each press independently; a recast is never a free or
  hidden action.
