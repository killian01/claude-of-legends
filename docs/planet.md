# The planet: the battle royale map

The battle royale is played on a small planet: a true sphere of radius 80 m,
walkable all around, split into six regions that are the six faces of a cube
projected on the sphere (the dice layout). Fifty solo champions drop on it
for a ten minute match while the lit cap shrinks and the night falls outside
it. This page says how the planet is made, how to rebuild it, and the
conventions the sim, the generator and the model share.

## What ships

| File | What it is |
|---|---|
| `public/map/planet/layout.json` | The gameplay record: regions and their hearts, the poles, the crossroads, pads, caches, camps, creature arenas, bushes, sight blockers, the water level, the navigation header. |
| `public/map/planet/navigation.bin` | The walkability grid: 6 x 320 x 320 cells, little-endian int16 ground height in millimeters per cell in index order, -32768 for a blocked cell (1.2 MB). |
| `public/map/planet/planet.glb` | The model: terrain with a baked ground texture per face, water, every prop, GPU-instanced, WebP and meshopt (about 4.2 MB). |
| `public/map/planet/planet-light.glb` | The same scene with textures capped at 384 px, for phones (about 3.0 MB). |
| `art_src/planet/scene.json` | What Blender dresses: every prop, wall, mass, cliff rim, ramp, bridge, gate, shrine, pad, cache, camp, arena and bush, plus the terrain heights and the ground paint. `art_src/` is gitignored: the generator rewrites it, byte for byte, on every run. |

The sim reads `layout.json` and `navigation.bin` only:

- `src/sim/sphere_nav.ts`: the grid (`SphereNavGrid`), its decoder
  (`decodeSphereNav`) and the path search (`findSpherePath`).
- `src/sim/content/planet.ts`: the typed record and `assemblePlanet()`, a
  pure assembler from the parsed JSON (no I/O) that puts every point back on
  the sphere exactly.

No host loads the planet yet; wiring it into a match is the next step.

## Conventions (a contract between the sim and the generator)

- A sim position is a 3D point on the sphere, `|p| = 80`. Axes are the
  three.js world axes, y up. Heights are presentation only: the renderer
  lifts a unit by its cell's height; the sim never leaves the sphere.
- Face f has an outward normal N and tangent axes U, V with U x V = N:

  | Face | Region | N | U | V |
  |---|---|---|---|---|
  | 0 | Ruins | +X | (0, 0, -1) | (0, 1, 0) |
  | 1 | Cypress groves | -X | (0, 0, 1) | (0, 1, 0) |
  | 2 | Sanctuary | +Y | (1, 0, 0) | (0, 0, -1) |
  | 3 | Open ground | -Y | (1, 0, 0) | (0, 0, 1) |
  | 4 | Lakes | +Z | (1, 0, 0) | (0, 1, 0) |
  | 5 | Cliffs | -Z | (-1, 0, 0) | (0, 1, 0) |

- Gnomonic cells, n = 320 per face edge. Cell (f, i, j) has i along U and j
  along V, `u = (2i + 1) / n - 1`, center `normalize(N + u U + v V) * 80`,
  index `f n^2 + j n + i`. Cells are about 0.5 m at a face center and
  0.24 m at a cube corner.
- Lookup: the face is the axis of the largest component with its sign, ties
  broken x, then y, then z; `u = p.U / p.N`, `v = p.V / p.N`,
  `i = clamp(floor((u + 1) n / 2), 0, n - 1)`, same for j.
- Along every cube edge the two faces' rows line up one to one, so a cell's
  neighbor across an edge is found by stepping one cell past the edge on the
  face's plane and looking the point up. A cube corner cell has 7 neighbors.
- Only +, -, *, /, sqrt in `src/sim` (ADR 0019). Distances are chord lengths.
- The north pole holds the Sanctuary's spire and the south pole the Open
  ground's monolith, both impassable discs of 4 m: the sim's tangent frame
  is singular at the poles and nothing may stand there.

## The six regions

- **Sanctuary (+Y)**, the hot drop: the spire, a paved plaza with six golden
  caches, the Warden's arena 19 m from the spire, a colonnade, four shrines,
  a ring road, hedges, cypress alleys and woods toward the corners. Richest
  loot (about 80 of the 250 caches).
- **Open ground (-Y)**: rolling relief, the monolith in a ring of menhirs,
  scattered schist massifs, boulders, lone trees, tall grass. Sparse cover.
- **Ruins (+X)**: the Pyrefang's arena in a ring of broken pillars, a grid of
  streets every 22 m, standing halls with the Star Orchard's painted
  facades, houses with doors, courtyards, towers, rubble heaps.
- **Cypress groves (-X)**: a labyrinth of winding trails through deep woods
  (carved: solid wherever the ground is more than a noisy margin from a
  trail), clearings, many bushes, the elder cypress at the heart.
- **Lakes (+Z)**: an island heart inside a ring lake reached by two bridges
  and two isthmuses, outer lakes crossed by bridges or squeezed into
  isthmuses, ponds, reeds and lilies.
- **Cliffs (-Z)**: the Voidmaul's arena on a central mesa with three ramps,
  four plateaus (3.2 to 4 m) with ramps toward the roads, crag walls carved
  between the roads.

The cube edges are the borders: open along most of their length, marked by
two low rock ridges each and crossed by the heart-to-heart roads under gate
arches. The eight cube corners are crossroads: a paved plaza, a glowing
beacon and a launch pad.

## The generator

`scripts/planet/generate.mjs` is the single source of the layout. It is
deterministic: one fixed seed, its own PRNG (`random.mjs`, the same
mulberry32 as `src/sim/rng.ts`), no `Math.random`. Run it from the repo
root (Node 22):

```sh
node scripts/planet/generate.mjs                       # writes the three records
node scripts/planet/generate.mjs --debug /tmp/planet   # plus planet-map.png, the six faces in the dice layout
```

It runs in about 8 seconds and prints a report (walkable share per region,
why cells are blocked, counts, timings). It exits non-zero when a gameplay
check fails. The modules:

| Module | Role |
|---|---|
| `sphere.mjs` | The cube-sphere conventions, vector helpers, the neighbor table. |
| `random.mjs` | The seeded stream and 3D gradient noise. |
| `terrain.mjs` | The ground as one field: relief per region, lakes, plateaus, ramps, flattened plazas, the lift of solid masses. |
| `world.mjs` | Placement state and the fit rules: two solid footprints touch or leave 2.9 m between them; nothing solid on a path, a plaza or the water's edge. |
| `network.mjs` | Hearts, crossroads, beacons, the road network, gate arches, border ridges, pads. |
| `regions.mjs` | The six region designs (`ground`, `afterPaths`, `dress`). |
| `scatter.mjs` | Shared passes: masses, solids, bushes, dressing, carved fields. |
| `raster.mjs` | Cells from placements: heights, water, cliffs (steeper than 1:1), footprints, masses, bridge decks; the ground paint. |
| `analysis.mjs` | Distance fields, the opening that removes passages under 2.5 m, connected components with the sim's moves. |
| `gameplay.mjs` | Bushes kept, caches placed (Poisson, 6 m apart, density by region and heart), validation, sight blockers. |
| `output.mjs` | The binary grid, base64 packing, the debug PNG. |

The navigation grid is derived from the same placements `scene.json` lists:
a solid prop, wall or mass in the scene is a blocked footprint in the grid,
never the other way round. After rasterizing, the generator removes every
walkable sliver narrower than 2.5 m (a morphological opening), keeps the
largest connected component (with the sim's no-corner-cutting moves) and
checks that every pad landing is 3 m clear, every camp 7 m clear, every
arena open, and every cache on open ground.

Shipped numbers: 75 percent of the surface walkable (cells: 74.6 percent;
per region from 64 percent in the groves to 87 percent in the ruins), one
component, 10 pads, 250 caches (16 golden), 20 camps, 174 bushes, 2442 sight
blockers.

## The model

`scripts/planet/build_planet.py` runs in Blender 4.2 LTS, headless:

```sh
/opt/blender/blender-4.2.23-linux-x64/blender -b --factory-startup \
  --python scripts/planet/build_planet.py -- \
  [--previews /tmp/planet-work/previews] [--samples 12] [--views all|globe|views|<name>] \
  [--bake-size 2048] [--no-export]
```

It reads `scene.json` and `navigation.bin` and:

- builds the terrain as one cube-sphere mesh (160 quads per face edge,
  displaced by the generator's heights; steep faces flat shaded), with the
  six faces' seams welded;
- bakes one ground texture per face (2048 px) from region colors, the
  Star Orchard's limestone, slate, moss and schist textures (cropped from the
  shipped `map.glb`), and the generator's paint (paths, paving, shore, bare
  rock, forest floor, camp floors);
- adds the water caps, every prop as a linked duplicate of one mesh per kind,
  halls, hedges, bridges, ramp balustrades and cliff slabs;
- exports, then runs `gltf-transform` (`instance`, `webp`, `meshopt`, and
  `resize` to 384 px for the light model) into `public/map/planet/`;
- with `--previews`, renders the globe from four sides and five in-game
  views (18 m above the ground, looking down at 55 degrees, 50 degree field
  of view) with Cycles.

Cycles runs on three fixed threads (`RENDER_THREADS`) and the previews
default to 12 samples at 960 x 540: the build box also serves the game.
Scratch files go to `$PLANET_WORK` (default `/tmp/planet-work`): the texture
crops and the baked ground are cached there by the scene's hash, so a rerun
with an unchanged scene skips the bake. A full build takes about one minute
without previews, eight to ten with them. The script prints how far the
mesh's ground sits from the grid's heights on walkable cells, bridge decks
left out (mean 3 mm, worst sample about 1 m, next to steep ground where a
mesh quad, twice a cell's size, spans the slope).

Axes: Blender is z up, so a sim point (x, y, z) is Blender (x, -z, y), and
the glTF exporter's +Y up gives the sim's axes back.

## The path search

`findSpherePath` is A* over the grid (8 neighbors, no corner cutting, chord
costs) with a great-circle lower bound as the heuristic, computed with
square roots only (`arcLowerBound`), weighted by 1.2, then greedy
line-of-walk smoothing. `lineOfWalk` is an exact cell traversal: a
great-circle arc is a straight line on every gnomonic face, so the walk is a
grid DDA per face and never skips a cell.

The weight matters. With the plain heuristic a 250 m search expanded about
95 000 cells (70 ms median); weighted, it expands about 3 600 (1.5 to 2 ms
median, 10 to 13 ms at worst on the build box), and the smoothed paths come
out within a fraction of a percent of the plain search's. A 50 m search
takes about 0.2 ms. `tests/sphere_nav.test.ts` measures it on the shipped
planet.

## Tests

- `tests/sphere_nav.test.ts`: lookup and center round trips on every cell,
  the index convention, ties at edges and corners, neighbor symmetry across
  edges and corners, the traversal against dense sampling, blockers and
  snapshots, heights, decoding, paths across faces and around both poles,
  determinism, and the search budget on the shipped planet.
- `tests/planet_layout.test.ts`: the shipped layout against the shipped
  grid: points on the sphere, counts, one connected walkable surface, the
  poles blocked, pads landing 50 m away on open ground, caches 6 m apart on
  open ground with golden ones at the hearts, camps 7 m open and away from
  pads, creature arenas open in their regions, bushes off pads and caches,
  gentle walkable heights.

## Rebuilding after a change

1. Edit the design in `scripts/planet/` (a region is one object in
   `regions.mjs`).
2. `node scripts/planet/generate.mjs --debug /tmp/planet` and look at the map.
3. `pnpm vitest run tests/planet_layout.test.ts tests/sphere_nav.test.ts`.
4. Rebuild the model with Blender (above), look at the previews.
