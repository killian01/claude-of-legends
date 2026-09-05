# One weighted ledger prices every paid act, in embers

Supersedes the economy half of ADR 0011, whose store decision and whose ledger, append-only
with balances derived and every failure refunded, this one keeps whole.

Every surface that spends real money on a player's behalf grew its own meter, and no two
of them speak the same language. The weekly creation ledger (ADR 0011) bounds 3D builds.
Three rolling-day counters bound 2D art, animation bakes and model calls. A fourth,
server-wide ceiling now bounds the sum of all of them. Not one of those numbers is
expressed in what the act costs, so each was set by intuition, and every time two acts
turned out to cost differently we added another counter: the animation meter exists only
because sharing the build's meter made a champion with per-spell clips impossible to
finish in a day, on an act the glossary already said the creation had paid for. That is
the shape of the problem rather than an incident. Counters cannot trade either: a creator
who wants a fifth spell animation cannot give up two splash rerolls to get it, even though
nothing in the design says the two are worth the same to the server, and today nobody can
say which is dearer.

So one ledger and one unit price everything. The append-only ledger ADR 0011 built stays
exactly as it is, with balances derived and never stored, and the unit it counts becomes
the **ember**: what the Forge and the Academy both burn when the server pays a provider for
a player. Every paid act debits a number of embers proportional to what it costs us, every
account receives a weekly grant of embers that rolls over, and any failure refunds exactly
what it debited, technical or content-blocked, as it does now. The player arbitrates their
own week: rerolls against animations, a rebuilt model against an afternoon with the coach.
One number to explain, one number to tune, one number to sell when payments land.

The **Creation** stops being a unit. It goes back to meaning the ordinary thing, a champion
someone forged, and the act of building its 3D model is priced in embers like every other
act. The per-account daily counters retire with it: their job was to bound one player's
spend and the ember balance does that directly, in the unit that matters. The server-wide
ceilings stay, because they do a job no per-account number can, and so do the blanket API
rate limit and the per-champion running-job rail, which bound rate and concurrency rather
than money.

The balance is shown, and every price with it, because a currency nobody can see is worth
no more than the counters it replaces. The ember count lives on the account, in the drawer
that already holds the profile and the standing, and is repeated at the head of the Forge
editor: on the account rather than in a panel, because the Academy spends the same unit and
a balance living inside the Forge would be in the wrong place the day it ships. Every act
that costs names its price on the control that starts it, before it is pressed. The balance
moves where the creator can watch it move. And a refusal names the number it met, never a
bare limit the creator is learning about for the first time by being stopped.

Playtest, 2026-09-04, is what settled that. The stock line sits in one place today, inside
the build panel at step four of a draft, and only one of the five meters (the daily 2D one)
appears anywhere on screen at all. A creator who ran out of daily bakes while animating a
kit read it as running out of creations, because the only number in the interface was the
creations one and it was not the one that had stopped them. Two numbers were wrong at once:
the invisible one that refused, and the visible one that had nothing to do with it.

The weights are not in this decision, on purpose. We know their shape, not their sizes: a
3D build reconstructs geometry and rigs it and is far and away the dearest; a bake retargets
an existing rig and is a fraction of it; a 2D image is a fraction again; a model turn is
cheaper still and priced mostly on what it writes back, its input side having just dropped
about ninety percent to prompt caching. Shape is not a price, and a ratio invented from
shape would be the same intuition we are trying to leave. Two measurements set the numbers,
and both are one line of plumbing away: the provider balance already has an endpoint
(`server/generation/tripo.ts`, reading 940 on 2026-09-05), so recording it either side of
each task kind prices the 3D and 2D acts exactly; and every Messages API response already
carries `usage`, so logging it prices every model turn. The ember table lands with that
data, and the size of the weekly grant lands after it, from what a normal week actually
costs. Until then this ADR has decided a mechanism and named no price.

Considered and rejected: keeping a counter per action and adding one whenever two costs
diverge (what we have, it is why the animation wall existed, and no number of counters ever
lets a player trade); pricing in the provider's own units, Tripo credits or tokens (it
leaks a vendor into the game's vocabulary and dies the day we swap providers, which is the
one thing the ADR 0010 seam exists to survive); a balance in euros (it turns every click
into a purchase in the player's head, and commits to payments and a rounding policy before
we have measured anything); and calling the unit a credit (bland, and the glossary already
refused the word for the creation).

## Consequences

- `CONTEXT.md` gains **Ember** and the **Creation** entry stops describing a unit; both land
  before any code, as the naming rule requires.
- The ledger's reasons (`weekly_grant`, `finalize`, `refund`) survive unchanged; only the
  magnitude of a delta moves, from one to the act's weight. Balances standing when this
  ships migrate by multiplying by the ember weight of a build.
- The account drawer and the Forge header gain the balance, every costing control gains its
  price, and the Academy gains both: it is a spending surface under this decision and shows
  nothing today.
- `quota_events` outlives the per-account meters: the server-wide ceilings still count on
  it, and it stays the only record of how often each act is asked for.
- Nothing ships until the calibration pass has run. An ember table guessed rather than
  measured would be this same decision with better vocabulary.
