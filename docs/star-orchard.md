# Star Orchard: the map

The Star Orchard is the game's map (ADR 0021): a Blender scene of two
platforms, three lanes, two forests with their camps and a central plaza,
exported with its collisions and gameplay points. Every match is played on
it, practice and ranked, lobbies and the bots' Arena, replays and the
headless environment. It shipped first as a test mode beside the launch
map; the launch map is the tests' fixture now, and nothing draws it.

## What ships

`public/map/star-orchard/` holds one revision, the latest:

| File | What it is |
|---|---|
| `manifest.json` | The export's landmarks (spawns, camps, center), the navigation grid parameters and the visual report. |
| `gameplay.json` | The lanes, bases and 22 towers traced on the same Blender source (three a lane per team, two guardians a base). |
| `navigation.bin` | The walkability grid: 480 x 480 cells of 40 cm, a ground height per cell in millimeters, blocked cells for cliffs, water and forest off the paths. |
| `map.glb` | The model, rewritten for the browser by `scripts/import_map.mjs` (about 44 MB). |

The raw Blender exports, one folder per revision plus the HD variants,
live in `art_src/map_exports/`, gitignored: 180 to 600 MB each, nothing a
repository or a first load should carry. On the dev server they are served
under `/map-exports/` for the exploration pages that compare revisions.

## How it is wired

- `src/sim/content/star_orchard.ts` assembles the exported records into
  the same `GameMap` shape the launch map is, and refuses a gameplay record
  traced on another Blender source than the model. The spawn terrace is a
  band around the Sanctum, and the seats at its ends stand eleven meters
  from the middle: the map lists a fountain pad around every seat
  (`FountainSpot.pads`, read by `src/sim/fountain.ts`), so the whole terrace
  heals and sells, to a champion and a bot alike, from the first second.
  The burn on enemies stays on the fountain's own pad.
- `src/sim/terrain_nav.ts` is the walkability grid: the exported cells in
  sim orientation, exact cell traversal for movement, the ground height for
  the presentation. `Sim` takes it with the map (`SimOptions`) and, with
  strict navigation on, keeps every step, spawn and respawn on a walkable
  cell.
- The playbooks read the match's map, not the launch map, so the house
  bots walk the Star Orchard's lanes (`SlotContext.map`).
- `src/render/terrain_loader.ts` turns the model into the renderer's
  terrain: scenery batched by material, the painted towers kept
  as the attackable units, the authored Sanctum left standing on its own
  (the renderer's plinth and crystal used to be drawn through it), the
  minimap painted from the grid, and a ground height every unit and effect
  is lifted by.
- Every host hands the assembled export (`StarOrchard`: the map record, the
  decoded grid, the revision) to `buildMatchSim` in `src/net/replay.ts`,
  the one place a match's `Sim` is built. The server and the environment
  read the three records from disk once per process
  (`server/star_orchard.ts`); the browser fetches them once per page
  (`src/game/star_orchard_records.ts`), in the replay and sparring workers
  too, and downloads the model once (`src/game/star_orchard.ts`), parsed
  into a terrain per match behind the loading card. The content
  fingerprint hashes the map record and the grid, so a new revision refuses
  the replays recorded on the old one.

## Shipping a new revision

After a Blender export lands in `art_src/map_exports/star-orchard-<rev>/`
with its `gameplay.json`:

```
node scripts/import_map.mjs            # the highest light revision
node scripts/import_map.mjs 115        # or one by number
pnpm exec vitest run tests/star_orchard.test.ts tests/terrain_nav.test.ts
```

The import copies the three records as they are and rewrites the model:
unused vertex attributes pruned, textures capped at 2048 and re-encoded as
WebP, geometry quantized and meshopt-compressed. It runs gltf-transform
through `pnpm dlx`, fetched on first use. The test checks that the three
records and the model agree, that the model stays under 60 MB, and that a
match on the export runs its waves, camps and bots with every unit on open
ground.

## Known limits

- Fog of war by sight range only; the scenery does not occlude, and there
  is no brush yet.
- Tower foundations are baked into the grid and stay blocked after a tower
  falls.
- The export names its objects in French inside the model file; nothing
  reads them, and they will turn English with the Blender source.
- Video memory: the textures decode to about 1 GB on the GPU (one atlas per
  floor). GPU-compressed textures (KTX2) are the next step if that proves
  too much on laptops.
