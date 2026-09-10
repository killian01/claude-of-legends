# The Star Orchard is the map

The game launched on a map written as data: the point-symmetric three-lane square in
`src/sim/content/map.ts`, drawn by the renderer from that record (a painted ground, walls,
brush, procedural towers and Sanctums). The Star Orchard is the authored map: a Blender
scene of two platforms, three lanes, two forests with their camps and a central plaza,
exported with its collisions and gameplay points (`docs/star-orchard.md`). It shipped first
as a test mode, an offline practice match behind its own tile, while the rest of the game
stayed on the launch map. On 2026-09-10 the maintainer played its third export revision and
decided it was the game's map, and that a test mode beside the real one was a fork nobody
wanted to keep.

## Decision

Every match is played on the Star Orchard: practice, the ranked queue, the Forge queue,
lobbies, the bots' Arena, the night coach's sparring, replays, spectating and the headless
environment. The test mode and its tile are gone.

- **One construction.** `buildMatchSim` in `src/net/replay.ts` is the only place a match's
  `Sim` is built, live and replayed alike, and it takes the Star Orchard first: the map
  record assembled from the export, a fresh walkability grid over the decoded export (the
  sim blocks its towers into it), strict navigation. `tests/architecture.test.ts` keeps
  `new Sim(` out of every other file under `src/`.
- **Every host reads the same export.** The sim stays free of I/O: a host reads the three
  records (`manifest.json`, `gameplay.json`, `navigation.bin`) and hands them in as a
  `StarOrchard` (`src/sim/content/star_orchard.ts`). The server and the environment read
  them from disk once per process (`server/star_orchard.ts`, `public/` in a checkout,
  `dist/` in the container); the browser fetches them once per page
  (`src/game/star_orchard_records.ts`), workers included, so a replay's second pass and a
  sparring match run on the grid without Three.js. The model is the browser's alone
  (`src/game/star_orchard.ts`): downloaded once, parsed into a terrain per match.
- **The content fingerprint covers the map that plays.** A replay is a re-simulation, and a
  cell that opens or closes moves a match as surely as a champion's damage does: the
  fingerprint hashes the map record and the decoded grid, so a new export revision moves it
  and an older record says "recorded under an older version" rather than playing a match
  nobody played. `REPLAY_VERSION` moves to 4 as well: every earlier record is the launch
  map's, and the ones from before the fingerprint existed carry none to be refused by. The
  161 replays recorded on the launch map are refused; their results, the ladder and the
  records stand.
- **The launch map stays as the tests' fixture.** Two hundred sim tests build on its
  coordinates through `new Sim(seed)`, and porting them buys nothing a player sees. It is
  the default of the `Sim` constructor and of the playbook interpreter for that reason
  alone; no host reaches it. The renderer's procedural dressing for it goes, since nothing
  draws it.
- **Playbook positions are bounded by the map that plays** (`STAR_ORCHARD_SIZE`), not by
  the fixture.

## Consequences

- The first match on a device downloads the model (44 MB) behind a card that says how far
  it is; the online session starts the download while the queue and the select run. The
  records are half a megabyte. The textures decode to about 1 GB on the GPU
  (`docs/star-orchard.md`, known limits); phones are measured after the switch, and a
  lighter texture set or GPU-compressed textures are the next step if they choke.
- Shipping a new export revision (`scripts/import_map.mjs`) changes what every match plays
  and moves the fingerprint: the replays recorded before it stop playing. That is the
  honest outcome and the viewer says so.
- A match's sim costs about three times what it did on the launch map: the walkability grid
  is ten times finer and the bots' pathfinding works on it. The pathfinder keeps its scratch
  state between searches now (`tests/pathfind_scratch.test.ts` pins that nothing else
  changed), which took a tick from 1.7 ms to 1 ms in Node; a sparring in the browser takes
  about twenty five seconds instead of ten, and the Arena's night runs longer. Fewer or
  hierarchical searches are the next step if that weighs.
- The known limits of the export are now the game's: fog by sight range only, no brush, tower
  foundations that stay blocked after a tower falls. Each is a piece of work on the map, not
  on the switch.
- `tests/star_orchard.test.ts` and `tests/fountain.test.ts` play the export through a match;
  `tests/replay_fingerprint.test.ts` pins that the grid is in the fingerprint.
