# What every paid act actually costs

The calibration ADR 0017 asks for, and the input its ember weights come from. Everything
here is measured rather than estimated, and the method lives in the repo so it can be
re-run: the server writes a sample per paid act into `spend_samples` (`server/spend.ts`),
and `scripts/spend_report.mjs` reads it back.

## Tripo, exact, per task

Tripo returns `consumed_credit` on a settled task, so the cost is exact, attributable, and
retroactive: no balance differencing, and no error when two jobs overlap. Read 2026-09-05
off the tasks of the first forged champion, built 2026-09-04.

| Act | Tripo task | Credits |
|---|---|---|
| One 2D image (splash, model reference, weapon art, one spell icon) | `generate_image` | 10 |
| The champion's 3D model | `image_to_model` | 30 |
| The weapon prop | `image_to_model` | 30 |
| The rig, once per champion | `animate_rig` | 25 |
| A bake of five clip roles | `animate_retarget` | 30 |
| A bake of one clip role | `animate_retarget` | 10 |

A retarget is priced by how many clips it carries. Two points fit five credits of base plus
five per clip (5 + 5n gives 30 at n=5 and 10 at n=1), which is a hypothesis on two samples
and not yet a law: a three-clip bake would settle it, and the log will collect one.

What that made the first champion cost, end to end: seven images at 10, a model at 30, a
weapon at 30, one rig at 25, and two bakes at 30 and 10, so **195 credits**, of which 70,
more than a third, went on 2D. The image is the cheapest single act and the most repeated
one, which is exactly the trade the old per-action counters could not express.

The account balance read 940 credits on 2026-09-05 (`server/generation/tripo.ts` has the
endpoint). **What one credit cost in money is the one number not measurable from here**: it
is on no public endpoint, the pricing page refuses an automated read, and it is whatever
the maintainer paid for the pack. The report takes it as an argument for that reason, and
every Tripo row stays exact in credits and blank in dollars until it is given.

## The model calls, exact, per response

Every Messages API response reports `usage`, so the same is true on this side. The server
now folds the input side off `message_start` and the output side off the closing
`message_delta` and files a sample. List prices for `claude-sonnet-5`, read 2026-09-05:
2 dollars per million input tokens, 10 per million output, a cache read a tenth of an input
token, a cache write a quarter more than one.

The fixed part of a kit conversation, measured directly against the API on 2026-09-05:

| Piece | Tokens |
|---|---|
| The rules block (grammar, passive catalog, bounds, cost schedule, task) | 3037 |
| A real splash at 1.5 MB | about 1370 |

Both are cached from the second turn of a conversation, verified in one round trip:

```
write  input 14  cache_write 3037  cache_read 0
read   input 14  cache_write 0     cache_read 3037
```

So the fixed prefix of a kit turn fell from about 4400 tokens at 2 dollars per million to
the same 4400 at 0.20, which is 0.9 cents a turn down to 0.09. What a turn costs on top of
that is its output, and that is what the log is now collecting.

## What is still missing, and how to finish it

1. The dollar price of a Tripo credit. One number, from whoever bought them.
2. Output tokens per turn, for the kit conversation and for the coach, from real use. The
   log fills this in on its own now.
3. A three-clip bake, to confirm or kill the 5 + 5n retarget rule.
4. A night's worth of coach calls, to price the night against an Academy turn. These are
   already told apart in the log (`night` against `coach`).

With those, `scripts/spend_report.mjs` prints the relative table the ember weights come
from, and the size of the weekly grant follows from what a normal week costs.
