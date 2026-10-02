# The ground is a plane or a sphere

Every match so far was played on flat ground: a position was `{x, z}`, a distance was
`hypot(dx, dz)`, a step was `pos.x += dir.x * s`, and that arithmetic was written inline in
every system of the sim, from a minion's step to a skillshot's line. The battle royale
(ADR 0031) is played on the Wanderseed, a small planet a champion can walk all the way round
in every direction (the maintainer, 2026-10-02: a true sphere, not a world that wraps, not a
round island drawn curved). Nothing of the flat arithmetic is right on a sphere.

## Decision

One geometry, two grounds, read off the point itself.

- **A point on the sphere carries y.** `Vec2` gains an optional `y`. A point on the plane never
  has one, so the Star Orchard's positions, its wire format and its replays keep their shape.
  A point on the sphere is a 3D point on the sphere of radius R (the planet's 80 m): the sim's
  ground is the sphere itself, and heights stay presentation, as the Orchard's grid heights are.
- **`src/sim/geo.ts` holds all ground arithmetic.** Distance, squared distance, the delta and
  the direction from one point to another, offsetting a point along a direction, advancing a
  point and its heading together, stepping toward a target, turning a direction a quarter or
  an angle, the signed cross product, the distance to a segment, a tangent basis, the outward
  normal. Each function looks at the point: without y, it is the plane's formula, written in
  the operation order the sim wrote inline, so the 5v5 rounds as it did; with y, the sphere's.
- **Chords, not arcs.** On the sphere every distance is the chord |a - b|, and offsetting a
  point by s along a great circle puts it exactly s away from where it started:
  `q = p (1 - s^2 / 2R^2) + dir s sqrt(1 - s^2 / 4R^2)`. The square root and the four
  operations only, exact on every engine (ADR 0019). At the reach of a fight (25 m on an 80 m
  sphere) a chord is 0.4 percent shorter than its arc, below anything a player can see.
- **Directions belong to a point.** A direction is a unit tangent vector at the point it was
  taken at. One kept across ticks (a projectile's heading, a dash, a knockback) is advanced
  with its point (`advance`), which turns it along the great circle; one taken at a point and
  used at another is carried (`carry`). The plane's directions never turn.
- **A tangent frame with two poles.** Where the sim needs an absolute angle (a random
  direction, a fan of bolts from a heading), `basis(p)` gives east as +y x p and north a
  quarter turn left of it. The frame is singular at (0, +R, 0) and (0, -R, 0); the Wanderseed
  keeps both impassable (the Sanctuary's spire and the Open ground's monolith).
- **The ground's navigation is behind one seam.** The Orchard keeps its grid and its A*
  (`src/sim/navgrid.ts`, `terrain_nav.ts`, `pathfind.ts`) untouched; the planet's is a
  gnomonic cube-sphere grid (`src/sim/sphere_nav.ts`, six faces of 320 by 320 cells, about
  0.5 m at a face's center), with its own A* across face edges. The sim reaches either through
  the same operations: walkable here, nearest walkable, line of walk, a path, the ground
  height, blocking a circle.
- **A gate keeps it so.** `tests/architecture.test.ts` refuses raw coordinate arithmetic in
  the systems that run on the planet; they call `geo.ts`.

## Consequences

- Every system that runs on the planet (movement, separation, dashes, projectiles, zones,
  vision, spell targeting, combat ranges, the champions' kits and passives, the camps and the
  big creatures, the bots) is rewritten over `geo.ts` once. The systems only the 5v5 has
  (lanes, waves, towers, the fountain, the recall) stay on the plane's arithmetic and never
  run on the planet.
- `REPLAY_VERSION` moves if any plane formula could not keep its operation order; the replays
  recorded before then stop playing, as ADR 0021 said a rule change would.
- The client places the world the same way: a sphere point is its own world position, lifted
  along the normal by the ground height; the camera, the clicks, the telegraphs and the
  overlays follow the curved ground (`docs/plan-royale.md`).

## Considered and rejected

- **A world that wraps** (a torus drawn curved): the same refactor for a world the drop view
  cannot show as a globe. The maintainer chose the true sphere.
- **Six flat faces glued at their edges** (a cube's surface drawn as a sphere): flat
  arithmetic on each face, but eight corners where a circle is not a circle, and up to a
  fifth of distortion between a step in the sim and a step on screen.
- **Positions as 3D everywhere, y = 0 on the plane**: bit-identical arithmetic, but a field on
  every position of every 5v5 record, wire message and replay for nothing.
