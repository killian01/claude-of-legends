# Skills

Two kinds live here. The project's own, written for this repository and covered by
its `LICENSE`:

| Skill | What it does |
|---|---|
| `dev-server` | The local server and client in the background, with `stack.sh` and `node_env.sh` |
| `academy` | Testing the bot builder: tests, the `/api/bots` routes, the browser |
| `verify` | The three CI gates on the right Node, and reading a red run |
| `browser-e2e` | The puppeteer click-throughs and PR screenshots |

They follow the house rules (`CLAUDE.md`): no em or en dashes, no emojis. The stop
hook does not scan this directory, so keep them clean by hand.

## Vendored skills

The other seven are **not this project's work**. They are unmodified copies
of Matt Pocock's engineering and productivity skills, taken from
[`mattpocock/skills`](https://github.com/mattpocock/skills) and checked in here
so that a fresh clone gets the same working agent as the maintainer.

| Skill | Upstream path |
|---|---|
| `domain-modeling` | `skills/engineering/domain-modeling` |
| `grill-with-docs` | `skills/engineering/grill-with-docs` |
| `grilling` | `skills/productivity/grilling` |
| `prototype` | `skills/engineering/prototype` |
| `research` | `skills/engineering/research` |
| `setup-matt-pocock-skills` | `skills/engineering/setup-matt-pocock-skills` |
| `wayfinder` | `skills/engineering/wayfinder` |

They are copied verbatim: if one needs to change, change it upstream or fork it
under a different name, so that this directory stays a mirror and stays easy to
refresh.

Upstream is MIT licensed. Its notice is `LICENSE` in this directory and it
governs the seven vendored skills; the repository's own `LICENSE` covers the rest
of the project, the four project skills included.
