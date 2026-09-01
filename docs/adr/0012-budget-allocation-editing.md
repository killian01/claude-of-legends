# Budget-allocation editing replaces raw numeric editing in the Forge

The Forge editor exposed every stat and spell number as a typed field. Playtesting
showed two failures: creators had no idea what a value means or which values are
reasonable, and the rational response to raw numbers is to max everything and let the
validator say no. We decided the primary editing surface is budget ALLOCATION, not
number entry: base stats and growth are pulled on the Stat polygon (a vertex stops
where the power budget runs out, so overspending is impossible by construction), each
spell's amounts move on one power dial with the same clamp, and spell structure is
asked for in plain words through the kit suggestion conversation. Numbers stay
visible everywhere but are read, not typed.

Raw editing did not disappear; it moved behind the fold. The rhythm fields (cooldown,
mana cost, cast range, windup) stay typed because they are choices in plain units,
body radius stays typed because it is free, and the full structural editor lives
under an Advanced collapse per spell. The deterministic validator remains the sole
authority on every path; the widgets only make its rules tangible early.

Considered and rejected: labeled bounds and per-spell cost lines on the raw fields
(still invites maxing, still asks the creator to know what a number means), and
curated presets per cast kind (a second content surface to balance, duplicating what
the conversation already does better).

Playtest follow-up (2026-09-01). The polygon only plays when the kit already claims its
share: the fresh draft carried a placeholder kit so light that every vertex reached its
rail with budget to spare, so the fresh draft now carries a kit that weighs what a roster
kit weighs (`src/sim/forge/fresh_draft.ts`). And the kit conversation no longer asks the
model to land the numbers: every proposal is fitted to the budget line by the power
dial's own scaling, one shared factor across the four spells (`fitKitPower`), before
validation. The model owns structure and theme, the arithmetic owns the amounts, and a
well-shaped answer lands in one model call instead of the two or three the old
"spend 90 to 100 percent" retry loop needed, which is what made the conversation feel
unresponsive. Left open on purpose: a creator who deliberately lightens the kit below
roughly half the budget can still reach every stat rail, because the rails sit inside
what the budget affords a bare kit. That is the budget's verdict, not a defect; widening
the rails or capping the stat share would be a separate balance decision.
