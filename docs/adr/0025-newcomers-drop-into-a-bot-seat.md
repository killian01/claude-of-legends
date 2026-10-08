# Newcomers drop into a bot's seat

ADR 0024 let a person play the public queue with no account, and the queue fills every empty
seat with bots, so nobody waits. What it could not do was put two strangers in the same match:
with few people on at once, the queue only brought two of them
together if both were in it within the same few seconds, then only if the second one answered
a ten-second countdown the first one started. Two people on during the same twenty-minute
match is a far likelier event than two people pressing Play in the same ten seconds, so the
match itself is now the meeting place.

- **Drop in.** Entering the classic public queue while nobody is waiting in it, and while a
  public queue match is under way with at least one person connected, less than eight minutes
  in, with a bot seat left, seats the newcomer in that match at once, in place of a bot
  (`server/drop_in.ts`, `Match.takeBotSeat`). The liveliest such match wins, then the youngest.
  The newcomer joins the side with fewer people on it, so two strangers meet as opponents, and
  takes a house bot before a ranked one. The champion comes as the bot left it: its level, its
  gold, its items. Everyone in the match is told who joined.
- **Never rated, never recorded.** A seat taken mid-match earns no rating, no Record, no
  laurels and no leaver penalty for whoever took it: they did not play the match from the
  start. A Guest dropping in makes the match unrated for everyone, as ADR 0024 already rules
  for a Guest seated at the start. A ranked bot that hands its seat over is neither rated nor
  given a Record for that match.
- **Start takes the whole queue.** Whoever presses Start in the queue now takes everyone queued
  along at once. The countdown that left the others behind unless they answered it is gone:
  nobody on this server queues to wait for ten people.
- **Presence on the landing.** `/api/public/presence` answers counts only (people in public matches,
  whether one can still be joined, people queued), and the landing shows one line over its
  gold button when somebody is on, and nothing when nobody is.

A seat a dropped player left to a stand-in is never handed out: it is held for them (the
rejoin reservation). Private lobbies and the Forge queue are untouched.

## Considered and rejected

- **A longer queue.** Holding a lone player in the queue for a minute or two hoping for a
  second one costs every player that wait and still misses the overlap most of the time.
- **Dropping in at any point.** Past the first minutes the match is decided and the newcomer
  arrives with nothing of the start to learn from; eight minutes is where towers start to fall.
- **Rating a drop-in seat.** A seat that was a bot for part of the match is not a result that
  belongs to the person who finished it.
