# The news build plan

The result of the maintainer's interview on 2026-09-13, after the forest round and the
Reddit preparation: a News section, so the server reads as a place where things happen,
and a client that reloads itself on a new deployment, because the one deploy that removed
the bar's Live entry was not seen by the players whose tab had stayed open. This file holds
what was decided; the two changes ship in that order, each as one commit and one deployment.

## What was decided

**What a news is.** Written by hand, in English, about the server only: an update, an
event, a decision. Nothing generated from the players (no sealed champions, no Arena
nights, no promotions) and no counter, because a counter reads small on a quiet day and the
home's panels already show the latest from the Forge and the ladder. The goal is that a
visitor sees life on a quiet day, and a dated note from three days ago is alive where a
zero is not.

**Where the entries live.** In the repository, as data-as-code: one object per entry in a
table, committed like content, served with the build. Writing a news is a commit and a
deployment, and since the deployment now reloads every open tab, that is exactly the moment
every player sees it. A server-side file editable without a deployment is not built; the
day it is wanted it stacks on top of the table.

**The shape of an entry.**

```ts
{
  day: '2026-09-11',              // published, UTC
  title: 'The forest round',
  body: ['One paragraph.', 'Another.'],   // plain text, no markdown
  image: 'forest-round.webp',    // optional, under public/news/, 1280 wide
  link: { label: 'Play', to: 'play' },    // optional, inside the site only
  at: '2026-09-20T20:00:00Z',    // optional: an event's time
}
```

An entry with `at` in the future is an event: it stays pinned at the top of the section
and of the landing's line, with the time in the reader's zone and how far away it is; once
past it takes its place by `day`. A link points at a tile or a section of the home (`play`,
`forge`, `academy`, `ladder`), never at a free URL.

**Who sees it.** Signed in: a News entry in the home's bar, address `#news`, a section
like the ladder, with a dot on the entry while the newest news is under seven days old
(no state stored, nothing added to PRIVACY.md). Signed out: one line on the landing under
"Or try it first", the newest entry's thumbnail, date and title, opening the same section
read-only over the landing.

**The first five entries**, at the dates the repository knows, short, each with an image
from the screenshots taken on the Star Orchard:

| Day | Title | Source |
|---|---|---|
| 2026-08-30 | v0.1.0: Claude of Legends is open | the tag |
| 2026-09-01 | The Forge: build the eleventh champion | ADR 0010, 0011 |
| 2026-09-03 | Bots: the Academy and the Arena | ADR 0013 |
| 2026-09-11 | Two rings and the last creature | ADR 0022 |
| 2026-09-11 | The forest round | ADR 0023 |

A sixth, "We are on Reddit", the day the post goes up.

**The rule.** `CONTRIBUTING.md`, beside the screenshots: a change the player sees adds
a news entry in the same change. `CONTEXT.md` gets the term.

## The client reloads on a new build

The page never reloads between screens (ADR 0020), so a player signed in before a deploy
keeps the old code until they reload themselves; the entry document is `no-cache` and the
assets are hashed, so a fresh load is always the new build. And the client cannot tell:
`/api/public/build` carries the replay version and the content fingerprint, neither of
which moves for a change to the interface.

- **The build id** is the name of the entry bundle the server serves, read off
  `dist/index.html` at boot (`server/build_info.ts`), and exposed as `build` beside
  `version` and `content`. The client knows its own from `import.meta.url`. In
  development the server has no `dist/` and says `null`, and the client never reloads.
- **When it checks** (`src/net/build_watch.ts`): when a WebSocket closes (a deployment
  restarts the server, so every open tab loses its socket at that moment), when the tab
  regains focus, and every 60 seconds for a tab with no socket open (a practice match
  against bots runs in the browser alone). The decision is a pure function of the two
  ids, tested; the watcher is the thin thing around it.
- **What it does**: a three-second notice, "New version, reloading", then `location.reload()`,
  everywhere. An online match is already gone with the server; a practice match is cut,
  it costs nobody anything; a text being typed in the Forge or the Academy is lost, the
  champion draft is on the server. Nobody plays on the old version once a new one is up.
- `docs/deploy.md` says it: a deployment cuts every player, so deploy at a quiet hour,
  which the access log shows.

## The section

- `src/ui/news_entries.ts`: the table. `src/ui/news.ts`: the pure decisions, tested:
  the order (pinned events first, then by day descending), whether the dot shows, an
  event's countdown text, the landing's line. `tests/news_entries.test.ts`: the structural
  gate, dates valid and unique per title, no dash or emoji or URL in the text, every named
  image present under `public/news/`, every link a known destination.
- `server/news_page.ts`: the wire shape, from the table and the clock, tested; served by
  `/api/public/news`, public like the build. The client mirrors the shape and reads that
  one request (`src/ui/news_section.ts` for the section, the landing's line beside it).
- The bar entry, in `home_screen.ts` with the other sections; the landing's line in
  `landing.ts`.
