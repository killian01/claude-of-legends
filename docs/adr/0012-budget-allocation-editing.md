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
