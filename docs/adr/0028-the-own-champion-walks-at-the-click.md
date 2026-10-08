# The own champion walks at the click, drawn where the server will have it

> Refines ADR 0001: the server still decides everything; the client now draws its own champion
> ahead of the newest snapshot, by the orders it has sent that have not landed yet.

Online play had no prediction. A click went up the wire, the server applied it between two ticks,
the next snapshot came back down, and the renderer drew it between its last two snapshots: the
champion answered a round trip and a tick or two after the click. From Europe that is a tenth of a
second and nobody notices. From another continent, a median round trip over 200 ms with spikes
of seconds, every click takes about a third of a second to show. The server is in Helsinki and stays there, so the client
has to stop waiting for it.

So the own champion is drawn where it is going (CONTEXT.md: Prediction), and nothing else moves.

- **The orders are numbered and the server answers the numbers.** A move, an attack, an
  attack-move, a stop, a recall and a cast carry `n`, the order's number in its connection's
  sequence (`src/net/protocol.ts`). The server keeps, per seat, the highest number it applied and
  the match time it applied it, and tells both in that seat's own snapshot (`SelfSnap ack`,
  `ackAt`). A seat taken back or taken over starts again from none, as its new connection
  numbers from one. The number is never recorded: a replay keeps the command alone
  (`withoutOrderNumber`, `server/match.ts`), so replays and `REPLAY_VERSION` are untouched.
- **The server tells the own champion's walk.** Its speed once nothing roots it (`ms`, from
  `unrootedMoveSpeed`, the speed `effectiveMoveSpeed` was already made of), its attack range, the
  path it still has to walk, the unit it is set on attacking, and whether a dash carries it,
  beside the statuses and the windup the snapshot told before. Only to that seat.
- **The client re-walks the newest state every frame** (`src/net/self_predict.ts`). It learns
  from the answers when an order sent now lands, in match time, and walks the newest state
  forward to that moment, each order still on its way applied when it lands, with the sim's own
  path search and walking step (`src/sim/pathfind.ts`, `src/sim/movement.ts`, over the map's
  walkability grid the browser already has): along the path, into range of the attacked unit and
  no further, held in place through a root, a stun or a windup, and stopped where a step would
  cross what cannot be walked, as strict navigation stops the sim's. A click therefore changes
  what is drawn on the very next frame, and the champion is drawn a round trip ahead of its last
  snapshot, which is where the server's own champion stands when an order sent now arrives.
- **What the newest state moves is eased, not jumped.** A new snapshot can say something the
  client could not know: a push between bodies, a root, a slow, an attack-move that stopped at the
  first enemy. The difference is taken into an offset that decays over about 120 ms, so the
  champion slides to the corrected walk over a few frames. A difference past 4 m is a move the
  server made (a recall home, a blink, a respawn) and is shown as the jump it is.
- **What is predicted, and what is not.** Moves, attack-moves (walked as a move), attacks (into
  range), stops, recalls (the channel stands the champion still) and casts whose windup plants the
  caster, when the mirror can tell the sim will start them (rank, cooldown, mana, no stun, and no
  unit to aim at, which only the server's sight settles). Dashes, blinks, an attack-move's
  acquisition, the pushes between bodies and walls an ability raises are not: they show a round
  trip late, as everything did before, and are eased in like any correction.
- **Display only.** The mirror world keeps the server's position for the own champion; every rule
  that reads one (the fog, the minimap, picking under the cursor, the lane guide's arrival) reads
  the server's. Only the drawing moves ahead: the champion, what hangs on it (the aim preview, its
  own telegraph) and the guidance arrow at its feet. Offline nothing changes; the local sim answers
  at once anyway. A spectator's mirror has no grid and draws what the server says.

## Consequences

- From another continent the champion turns and walks on the frame after the click instead of a third of a
  second later; from Europe the difference is small and the walk looks the same.
- The own champion is drawn ahead of every other unit by about a round trip: at 250 ms and
  walking speed, about a meter. An auto attack starts when the server's champion is in range, so
  against a unit walking away it can look a step late. The usual price of prediction, and smaller
  than the price of waiting.
- Before the first order of a connection is answered, when an order lands is guessed (a round
  trip of 120 ms); the first answer corrects it, and from far away the champion is then seen to
  catch up once, over a fraction of a second.
- `tests/self_predict.test.ts` serves a real sim to a mirror world through a connection with a
  delay each way and pins the promises: the next frame answers the click, no frame jumps, the
  drawing is where the server's champion will be, and it ends where the server's champion ends
  through a stop, a root the client could not know, an attack and a cast with a windup.
