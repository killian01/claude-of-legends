# Star Orchard: the authored map, as a test mode

The Star Orchard is the first authored map: a Blender scene of two
platforms, three lanes, two forests with their camps and a central plaza,
exported with its collisions and gameplay points. It is still being built,
so it does not replace the launch map. It plays in a **test mode**: the
"Star Orchard" tile on the home runs the offline practice match on it (the
same champion select, the same house bots, the same HUD), while ranked,
lobbies, bots, replays and the environment stay on the launch map.

## What ships

`public/map/star-orchard/` holds one revision, the latest:

| File | What it is |
|---|---|
| `manifest.json` | The export's landmarks (spawns, camps, center), the navigation grid parameters and the visual report. |
| `gameplay.json` | The lanes, bases and 22 towers traced on the same Blender source (three a lane per team, two guardians a base). |
| `navigation.bin` | The walkability grid: 400 x 400 cells of 40 cm, a ground height per cell in millimeters, blocked cells for cliffs, water and forest off the paths. |
| `map.glb` | The model, rewritten for the browser by `scripts/import_map.mjs` (about 40 MB). |

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
  optional terrain: scenery batched by material, the painted towers kept
  as the attackable units, the team's crystal sized to sit inside the
  authored Sanctum's crown (the renderer's own plinth and crystal overflowed
  it), the minimap painted from the grid, and a ground height every unit
  and effect is lifted by.
- `src/game/star_orchard.ts` downloads the export once per page and builds
  a match's map, grid and terrain; `src/main.ts` runs the practice match on
  them when the home resolves the `orchard` mode.

## Shipping a new revision

After a Blender export lands in `art_src/map_exports/star-orchard-<rev>/`
with its `gameplay.json`:

```
node scripts/import_map.mjs            # the highest light revision
node scripts/import_map.mjs 114        # or one by number
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

- Test mode only: no online play, rating, replay or environment on it.
- Fog of war by sight range only; the scenery does not occlude, and there
  is no brush yet.
- Tower foundations are baked into the grid and stay blocked after a tower
  falls.
- The export names its objects in French inside the model file; nothing
  reads them, and they will turn English with the Blender source.
- Video memory: the textures decode to about 1 GB on the GPU (one atlas per
  floor). GPU-compressed textures (KTX2) are the next step if that proves
  too much on laptops.
