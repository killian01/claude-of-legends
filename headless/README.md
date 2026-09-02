# The environment

A match with no browser and no server, stepped from outside the repo. This is
ADR 0002 phase 2's half of the Policy contract: a trainer in any language gets
exactly the observation and action space an in-sim bot gets, and nothing else.

```
pnpm build:env      # bundles to dist-env/env.cjs
pnpm env            # builds, then reads requests on stdin
```

One request per line of stdin, one response per line of stdout. stdout carries
nothing but protocol; diagnostics go to stderr.

## Requests

| Request | Answer |
|---|---|
| `{"t":"info"}` | `{"t":"info","contract":0,"periodTicks":5,"seed":1,"maxTicks":24000,"seats":[...]}` |
| `{"t":"reset","seed":42}` | `{"t":"obs",...}` with the first observations |
| `{"t":"step","actions":{"0":{"kind":"move","x":90,"z":90}}}` | `{"t":"obs",...}` |
| `{"t":"close"}` | `{"t":"bye"}`, then the process exits |

`reset` also takes `seats` (a full seat table, see below) and `maxTicks`.
Anything malformed answers `{"t":"error","message":...}`; a malformed action
inside an otherwise valid `step` is dropped silently, which means that seat
said nothing this slot and its persistent intentions carry on.

An `obs` answer is:

```json
{
  "t": "obs",
  "tick": 10,
  "time": 0.5,
  "done": false,
  "winner": null,
  "observations": { "0": { "...": "one Observation per remote seat" } }
}
```

Observations are keyed by seat index, and appear only for seats that reached a
decision slot during the step. A dead seat gets none, exactly like a bot.

## Seats

By default the environment runs a full 5v5 where seat 0 is remote and the other
nine run a house style (`laner`, `brawler`, `sieger` or `objective`) drawn from
the seed. Champions come from the fill: the roster's lanes completed by role, no
duplicate inside a team, drawn from the seed, the same deterministic rule the
server uses, so a default environment match and a default server match line up.

To choose your own, pass a seat table to `reset`:

```json
{"t":"reset","seed":42,"seats":[
  {"team":0,"championId":"korrath","remote":true},
  {"team":0,"championId":"maera"},
  {"team":1,"championId":"vesk","bot":"laner"}
]}
```

`remote` seats are stepped by you. Everything else runs the named house style
in-sim (`laner`, `brawler`, `sieger` or `objective`; default: the Laner).

## One step is one decision slot

A step advances five ticks, which is exactly one decision slot for every seat
(4 per second of sim time, staggered per seat so the ten do not all decide on
the same tick). You send at most one action per seat per step; sending more
buys nothing, because the latest one wins and it is consumed on the slot.

The action you send is dispatched on the NEXT slot, not the one that produced
the observation you are answering. That single slot of pipeline is what being
remote costs, and it is identical here and on the live server, so a policy
trained against this environment behaves the same when it connects for real.

Ability and sigil casts spend from the decision budget (ADR 0003), the same
token bucket a human spends from: about 4 per second, at most 2 banked. Movement
and attack intentions are persistent state and cost nothing, so a step spent
restating an unchanged intention is a step wasted.

## The contract

`src/sim/policy.ts` is the whole contract: `Observation` in, `Action` out,
version 0, frozen. `info` reports the version it speaks. It changes only by
additive optional fields (ADR 0005), because a breaking change breaks every bot
trained against it. Additive action kinds count too: `recall` and `sell`
(`{"kind":"sell","slot":n}`, the human rule: at the fountain, seventy percent
back) arrived after v0 shipped, and a policy that never sends them is unaffected.
The latest additive fields are the lineup: `seats` (both teams' champions and roles,
with the assigned lane for the own team), `items` on a visible champion row, and
`laneOpponents` (per lane, the enemy seen there the most over the last three minutes).

The observation is built from team vision, never global sim state: the fog
applies to a remote policy exactly as it does to a human. Acting is fogged too,
an attack on a unit your team cannot see is refused.

## A trainer, in about twenty lines

```python
import json, subprocess

env = subprocess.Popen(
    ["node", "dist-env/env.cjs"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
)

def request(msg):
    env.stdin.write(json.dumps(msg) + "\n")
    return json.loads(env.stdout.readline())

state = request({"t": "reset", "seed": 42})
while not state["done"]:
    obs = state["observations"].get("0")
    action = {"kind": "noop"} if obs is None else your_policy(obs)
    state = request({"t": "step", "actions": {"0": action}})

print("winner:", state["winner"])
request({"t": "close"})
```

Gymnasium bindings over this stream are not written yet; the stream is the
contract, and a `gymnasium.Env` wrapper around it is a small, welcome PR.
