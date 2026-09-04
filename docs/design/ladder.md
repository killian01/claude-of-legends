# The ladder

The ladder (CONTEXT.md: Ladder, Way, Tier, Placement, Form, Emblem) is the
account's reason to queue again. It was a collapsible box on the home
screen with a top fifty and nothing of the reader on it; it is now a page.

## The four ladders

One rating per way, one ladder per rating (ADR 0013 and the Forge queue's
own pair): by hand, the account's bot in a live match, that bot in the
Arena, and by hand in the Forge queue. Three rated matches on a way place
the account there; until then it is in placement, and the page says how
many of the three it has played. A seat is rated on its way when its rating
moved, which is the one reading that holds for a hand seat, a live bot
seat and an Arena seat alike (`server/way_stats.ts`).

## The page

Reached from the home's bar (Ladder) and from the ladder card in the
account drawer, a full page like the Academy, opened under the bar so the
next section is one click away, one tab per way, by hand first.

- **The reader's place** at the top: the tier's emblem, the tier, the
  rating, the rank of the placed or the placement's count, the climb to the
  next tier as a bar and a number, the rated record and the form (the last
  ten results). Beside it, the one button that moves this ladder: the
  public queue by hand, the queue again with a bot (the bot is picked at
  champion select), Play now with a ranked bot on the Arena tab, the Forge
  queue on its tab. Without a bot, the Academy.
- **The podium**: the top three as cards, the favorite champion's portrait
  behind the name.
- **The table**: rank, emblem and name, rating, rated games, win rate, form
  (the last five), the most played champion. The reader's own row is lit;
  beyond the top fifty it is pinned under the table with its true rank, so
  nobody is ever off the ladder they are on. By hand, a row opens on the
  account's career; on the bot ways the account's ranked bots sit in the
  row as chips, a Bot page each. On the Forge tab the favorite may be a
  forged champion, shown by its name and its splash.
- **Placing**: the accounts with one or two rated matches on the way, so a
  young server's ladder shows who is coming.
- **The pool** on the Arena tab, unchanged: every ranked bot, a page each.

## The home

The bar of the home shows the reader's place by hand beside their name:
the emblem, the tier and the rating. That block opens the account drawer,
whose ladder card shows the same place in large (emblem, tier, rating, the
climb, rank or placement), one line per other way where the account has
rated play, and the button to the page. The career below it in the drawer
counts the seats the account played by hand: its bots' matches belong to
each bot's Record and page, and to the bot ladders.

## The emblems

One image per tier, the same everywhere the tier shows
(`docs/design/tier-emblem-prompts.md`). Until the art lands the emblem is a
CSS banner in the tier's color with one pip per tier climbed, so the page
reads the same with or without it. The emblem is drawn small enough for a
name in the lobby and on the scoreboard, where it goes next.

## Not now

Seasons: a reset on a young server erases the little progression there is.
Steps inside a tier: the tiers are the glossary's bands; the climb bar
shows the progress inside one without borrowing another game's divisions.
