# The bot is the rated subject on the bot ways

Amends ADR 0013, which decided that the rating subject is always the account, one rating
per way of playing, and rejected a ladder of bots on the grounds that the account is the
identity and a bot is a choice, like a champion. That reasoning holds for a champion and
does not hold for a bot, which is the thing being authored. We decided that on the two
bot ways, the account's bot in a live match and that bot in the Arena, the rated subject
is the bot. By hand and the Forge queue are unchanged: a person sits in those seats, so
the account is rated.

The reason is what the mode is for. A bot is written, measured and rewritten; the Academy,
sparring, the night coach and the Briefing all exist to iterate on one. Rating the account
averages every attempt an owner has running, so a weak bot drags down the rating a strong
one earns, and the owner's cheapest way to protect a good rating is to stop experimenting.
That is the opposite of the behavior every other part of the mode encourages. Rating the
bot puts the number on the thing whose playbook produced it, which is also the only number
a reader of a Bot page can act on.

The account keeps its identity everywhere it already had it. A bot names its owner on the
ladder, on its page and in the pool; the ladder of a bot way ranks bots and shows the
owner beside each. Nothing about the account's own ways changes, and nothing about ADR
0006 changes: an account is still required, and a bot still belongs to exactly one.

## Considered options

- **The account stays the subject** (ADR 0013 as written): rejected here. It is coherent
  and it is what shipped, but the drag is real and it punishes exactly the iteration the
  Academy, the Arena and the night coach are built to produce. Measured on the live
  server the day this was decided: one owner holding three bots read one rating for all
  three, so a bot that never won pulled the same number a better one pushed.
- **One designated bot carries the account's rating**, the others playing unrated:
  rejected. It keeps the ladder a ladder of people at the cost of making every other bot's
  play worthless, which is a strange thing to tell an owner iterating on three.
- **A second ladder of bots beside the account's**: rejected. Two numbers for one match,
  and the page would have to say which one matters. A rating that nobody acts on is
  display, and the Bot page's tally already is that.

## Consequences

- A bot rating is keyed by bot and way, not by account and way (`bot_ratings`). Existing
  rows are per account and cannot be split across an owner's bots after the fact, so they
  are dropped: on a server this young that is a handful of rated matches, and every bot
  re-places in three.
- Rating a match reads a seat's **rated subject** rather than its account: the account for
  a hand or Forge seat, the bot for a live bot seat or an Arena seat. The rule that makes
  a match rated is untouched, an owned seat on each side, and so is the weight scaling
  with owned seats.
- The seating rule that puts at most one bot per account in an Arena match becomes
  load-bearing rather than incidental: it is what stops an owner feeding one of their bots
  to another for rating.
- The wins, losses and form of a bot way come from the bot's own Record (`bot_records`,
  which already holds one entry per bot per match with its rating movement) instead of a
  pass over the match log per account (`server/way_stats.ts`). The match log keeps its
  seat ways for the hand and Forge ladders, which still read it.
- The ladder page's two bot tabs list bots: name, owner, champion, rating, rank, form.
  Placement is a bot's first three rated matches on the way. The reader's own place on a
  bot tab is their best-placed bot, with the others listed under it.
- The home's account drawer shows the account's place by hand as it does today and, for
  the bot ways, the account's best bot on each rather than one account number.
