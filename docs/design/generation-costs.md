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

A credit costs **one US cent**: 10 dollars for 1000, the pack the maintainer bought
(2026-09-05). It is on no public endpoint and the pricing page refuses an automated read,
so the report takes it as an argument rather than carrying it as a constant. The account
balance read 940 credits the same day (`server/generation/tripo.ts` has the endpoint), which
is 9 dollars and 40 cents of runway.

In money, then: an image costs 10 cents, a model or a weapon 30, the rig 25, a five-clip
bake 30 and a one-clip bake 10. **The first forged champion cost 1 dollar 95**, of which 70
cents went on 2D.

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
the same 4400 at 0.20, which is 0.9 cents a turn down to 0.09.

One real kit turn, measured against the API on 2026-09-05 with the true rules block, a real
1.5 MB splash and a creator's opening line, answering with a complete kit:

```
input 1590   cache_write 3037   cache_read 0   output 983
```

At the sonnet-5 list that is 0.32 cents of input, 0.76 of cache write and **0.98 of output**,
so **2.1 cents for the opening turn** and about 1.5 for a later one, once the rules and the
splash are read back from cache instead of written to it. Output is half the bill and rising
as a share, which is the shape to remember: caching has taken the input side about as far as
it goes, and what is left is what the model writes.

A player's message can cost up to three of those. `SUGGEST_ATTEMPTS` is 3: a kit that fails
validation or comes in under the budget floor is sent back, so a bad message is a 6 cent
message.

The coach has not been measured yet. Same shape, its preamble cached the same way, a bigger
`max_tokens` (8000) but a much smaller real answer, a comment line and a few patch
operations, so it should land under a kit turn. The log tells `coach` from `night` and will
settle it.

## What an act costs, all together

Measured unless marked. One ember is one cent of what the server spends, which makes the
weights read straight off this column.

| Act | Cost | Embers |
|---|---|---|
| A model turn, coach (estimated) | under 1 cent | 1 |
| A kit conversation turn | 1.5 to 2.1 cents | 2 |
| One 2D image | 10 cents | 10 |
| A one-clip bake | 10 cents | 10 |
| The rig, once per champion | 25 cents | 25 |
| A five-clip bake | 30 cents | 30 |
| The 3D model | 30 cents | 30 |
| The weapon | 30 cents | 30 |
| **A whole champion, as the first one was made** | **1.95 dollars** | **195** |

The ember is defined as a cent of cost and not as a Tripo credit, even though the two happen
to coincide today: the coincidence is Tripo's price, and the definition has to survive the
day that changes or the day a provider is swapped (ADR 0010).

## What a week costs, which is the question that started this

The old weekly grant was 3 creations. A creation covered a model, its weapon and its bakes,
so about 115 cents of 3D, and the 2D rode a separate daily meter of 40 images: 4 dollars a
day, 28 a week, per account, on top. Three creations plus a week of that allowance is
roughly **31 dollars per account per week**, or 6200 a month at fifty players. Nobody ever
spent near it, which is exactly why it went unnoticed: a ceiling nobody touches still sets
what a bad week can cost.

Priced instead in what a player can actually make:

| A free week of | Embers | Per account per month | Fifty players |
|---|---|---|---|
| One champion a month | 50 | 2 dollars | 100 dollars |
| One champion a fortnight | 100 | 4 dollars | 200 dollars |
| One champion a week | 200 | 8 dollars | 400 dollars |

That is the decision the grant size is, and it is now a decision rather than a guess.

## What is still missing

1. The coach, and the night, against a real answer rather than a shape. The log tells the
   two apart already.
2. A three-clip bake, to confirm or kill the 5 + 5n retarget rule.
3. Output tokens across many real turns rather than one, to know the spread and not just
   the middle.

All three fill in on their own as the game is played; `scripts/spend_report.mjs` reads them
back. None of them moves the order of magnitude of the table above.
