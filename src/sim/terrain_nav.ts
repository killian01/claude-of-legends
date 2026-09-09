// A walkability grid exported from an authored terrain (the Star Orchard,
// docs/star-orchard.md): fixed-size cells in meters with a world origin,
// blocked cells baked from cliffs, water and forest, and a ground height per
// cell for the presentation. The sim reads only walkability; the heights
// ride along so the renderer and the sim agree on the same grid.
//
// Coordinates: the export is glTF Y-up with rows along the model's z axis,
// which the sim flips (sim z = -model z). decodeTerrainNav() turns the
// exported buffer into sim orientation once; the grid never sees the model's
// frame again. Pure and deterministic: the same export gives the same grid
// on every host.

import { NavGrid } from './navgrid';
import type { Vec2 } from './types';

export interface TerrainNavSpec {
  version: number;
  cells: number;
  // Meters per cell.
  cellSize: number;
  // The corner of cell (0, 0), in the model's frame (x, model z).
  origin: Vec2;
  // Height units per stored integer (0.001 for millimeters).
  heightScale: number;
  // The stored value that marks a blocked cell.
  blockedValue: number;
}

export interface TerrainNavData {
  cells: number;
  cellSize: number;
  // The corner of cell (0, 0) in sim coordinates.
  origin: Vec2;
  heightScale: number;
  // Row-major, sim orientation (row 0 at the lowest sim z); blocked cells
  // hold `blockedValue`.
  heights: Int16Array;
  blockedValue: number;
}

// Decodes an exported navigation buffer (little-endian int16 per cell) into
// sim orientation. Throws on a spec or buffer that cannot be a grid.
export function decodeTerrainNav(spec: TerrainNavSpec, buffer: ArrayBuffer): TerrainNavData {
  if (
    spec.version !== 1 ||
    !Number.isInteger(spec.cells) ||
    spec.cells < 1 ||
    spec.cells > 1024 ||
    !Number.isFinite(spec.cellSize) ||
    spec.cellSize <= 0 ||
    !Number.isFinite(spec.heightScale) ||
    spec.heightScale <= 0 ||
    !Number.isFinite(spec.origin.x) ||
    !Number.isFinite(spec.origin.z) ||
    buffer.byteLength !== spec.cells * spec.cells * 2
  ) {
    throw new Error('terrain navigation export is invalid or incomplete');
  }
  const view = new DataView(buffer);
  const heights = new Int16Array(spec.cells * spec.cells);
  for (let row = 0; row < spec.cells; row++) {
    const source = spec.cells - 1 - row;
    for (let column = 0; column < spec.cells; column++) {
      heights[row * spec.cells + column] = view.getInt16((source * spec.cells + column) * 2, true);
    }
  }
  return {
    cells: spec.cells,
    cellSize: spec.cellSize,
    origin: { x: spec.origin.x, z: -spec.origin.z - spec.cells * spec.cellSize },
    heightScale: spec.heightScale,
    heights,
    blockedValue: spec.blockedValue,
  };
}

// Search radius, in meters, for the ground under a point that sits on a
// blocked cell (a unit clipped into a cliff foot, a projectile over water).
const HEIGHT_SNAP_RADIUS = 3;

export class TerrainNavGrid extends NavGrid {
  readonly cellSize: number;
  readonly origin: Vec2;
  private readonly heights: Int16Array;
  private readonly heightScale: number;
  private readonly blockedValue: number;

  constructor(data: TerrainNavData) {
    super(data.cells, [], 0);
    this.cellSize = data.cellSize;
    this.origin = { x: data.origin.x, z: data.origin.z };
    this.heights = data.heights;
    this.heightScale = data.heightScale;
    this.blockedValue = data.blockedValue;
    const blockers = new Uint8Array(data.cells * data.cells);
    for (let i = 0; i < blockers.length; i++) {
      blockers[i] = data.heights[i] === data.blockedValue ? 1 : 0;
    }
    this.restoreBlockers(blockers);
  }

  private local(x: number, z: number): Vec2 {
    return { x: (x - this.origin.x) / this.cellSize, z: (z - this.origin.z) / this.cellSize };
  }

  override worldToCell(x: number, z: number): { cx: number; cz: number } {
    const p = this.local(x, z);
    return { cx: Math.floor(p.x), cz: Math.floor(p.z) };
  }

  override cellToWorld(cx: number, cz: number): Vec2 {
    return {
      x: this.origin.x + (cx + 0.5) * this.cellSize,
      z: this.origin.z + (cz + 0.5) * this.cellSize,
    };
  }

  override blockCircle(x: number, z: number, r: number): void {
    const p = this.local(x, z);
    super.blockCircle(p.x, p.z, r / this.cellSize);
  }

  override unblockCircle(x: number, z: number, r: number): void {
    const p = this.local(x, z);
    super.unblockCircle(p.x, p.z, r / this.cellSize);
  }

  // Exact cell traversal (a grid DDA) rather than the base class's fixed
  // sampling: at 40 cm cells a sampled segment can skip a blocked cell at a
  // corner, which is exactly the clip a cliff foot or a railing forbids.
  override lineOfWalk(a: Vec2, b: Vec2): boolean {
    if (![a.x, a.z, b.x, b.z].every(Number.isFinite)) return false;
    const start = this.local(a.x, a.z);
    const end = this.local(b.x, b.z);
    const current = { cx: Math.floor(start.x), cz: Math.floor(start.z) };
    const goal = { cx: Math.floor(end.x), cz: Math.floor(end.z) };
    if (!this.isWalkableCell(current.cx, current.cz) || !this.isWalkableCell(goal.cx, goal.cz))
      return false;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const stepX = Math.sign(dx);
    const stepZ = Math.sign(dz);
    const intervalX = dx ? Math.abs(1 / dx) : Number.POSITIVE_INFINITY;
    const intervalZ = dz ? Math.abs(1 / dz) : Number.POSITIVE_INFINITY;
    let crossingX = dx
      ? (current.cx + (stepX > 0 ? 1 : 0) - start.x) / dx
      : Number.POSITIVE_INFINITY;
    let crossingZ = dz
      ? (current.cz + (stepZ > 0 ? 1 : 0) - start.z) / dz
      : Number.POSITIVE_INFINITY;
    while (current.cx !== goal.cx || current.cz !== goal.cz) {
      if (Math.abs(crossingX - crossingZ) < 1e-10) {
        // Through a corner: both neighbors must be open, never a diagonal
        // squeeze between two blocked cells.
        if (
          !this.isWalkableCell(current.cx + stepX, current.cz) ||
          !this.isWalkableCell(current.cx, current.cz + stepZ)
        )
          return false;
        current.cx += stepX;
        current.cz += stepZ;
        crossingX += intervalX;
        crossingZ += intervalZ;
      } else if (crossingX < crossingZ) {
        current.cx += stepX;
        crossingX += intervalX;
      } else {
        current.cz += stepZ;
        crossingZ += intervalZ;
      }
      if (!this.isWalkableCell(current.cx, current.cz)) return false;
    }
    return true;
  }

  // Ground height under a sim point, in meters: the cell's exported height,
  // or the nearest walkable cell's within a few meters, else 0.
  heightAt(x: number, z: number): number {
    const c = this.worldToCell(x, z);
    if (this.isWalkableCell(c.cx, c.cz)) return this.cellHeight(c.cx, c.cz);
    const near = this.nearestWalkable(x, z, Math.ceil(HEIGHT_SNAP_RADIUS / this.cellSize));
    if (!near) return 0;
    const n = this.worldToCell(near.x, near.z);
    return this.cellHeight(n.cx, n.cz);
  }

  private cellHeight(cx: number, cz: number): number {
    const raw = this.heights[cz * this.cells + cx] ?? this.blockedValue;
    return raw === this.blockedValue ? 0 : raw * this.heightScale;
  }
}
