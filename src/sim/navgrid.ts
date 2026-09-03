// Walkability grid, 1 unit per cell, derived deterministically from the map's
// wall shapes. Used by both collision and pathfinding so they can never
// disagree about what is walkable. Cells hold a blocker COUNT, not a flag:
// static geometry contributes one blocker, and static units (towers,
// Sanctums) add and remove theirs at spawn and death, so overlapping
// footprints unblock correctly.

import type { WallShape } from './content/map';
import type { Vec2 } from './types';

export class NavGrid {
  readonly cells: number;
  private readonly blockers: Uint8Array;

  constructor(size: number, walls: readonly WallShape[], borderMargin: number) {
    this.cells = Math.round(size);
    this.blockers = new Uint8Array(this.cells * this.cells);
    for (let cz = 0; cz < this.cells; cz++) {
      for (let cx = 0; cx < this.cells; cx++) {
        const x = cx + 0.5;
        const z = cz + 0.5;
        let b =
          x < borderMargin ||
          z < borderMargin ||
          x > size - borderMargin ||
          z > size - borderMargin;
        if (!b) {
          for (const w of walls) {
            const dx = x - w.x;
            const dz = z - w.z;
            if (dx * dx + dz * dz <= w.r * w.r) {
              b = true;
              break;
            }
          }
        }
        if (b) this.blockers[cz * this.cells + cx] = 1;
      }
    }
  }

  isWalkableCell(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.cells || cz >= this.cells) return false;
    return this.blockers[cz * this.cells + cx] === 0;
  }

  // The blocker counts as they stand, copied, for a world checkpoint
  // (src/sim/snapshot.ts); restoring writes them back in place.
  snapshotBlockers(): Uint8Array {
    return new Uint8Array(this.blockers);
  }

  restoreBlockers(blockers: Uint8Array): void {
    this.blockers.set(blockers);
  }

  // Adds one blocker to every cell whose center lies within the circle.
  blockCircle(x: number, z: number, r: number): void {
    this.forEachCellInCircle(x, z, r, (i) => {
      if (this.blockers[i]! < 255) this.blockers[i]!++;
    });
  }

  // Removes one blocker from every cell whose center lies within the circle.
  // Must mirror a prior blockCircle with the same shape.
  unblockCircle(x: number, z: number, r: number): void {
    this.forEachCellInCircle(x, z, r, (i) => {
      if (this.blockers[i]! > 0) this.blockers[i]!--;
    });
  }

  private forEachCellInCircle(x: number, z: number, r: number, fn: (idx: number) => void): void {
    const minX = Math.max(0, Math.floor(x - r));
    const maxX = Math.min(this.cells - 1, Math.ceil(x + r));
    const minZ = Math.max(0, Math.floor(z - r));
    const maxZ = Math.min(this.cells - 1, Math.ceil(z + r));
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const dx = cx + 0.5 - x;
        const dz = cz + 0.5 - z;
        if (dx * dx + dz * dz <= r * r) fn(cz * this.cells + cx);
      }
    }
  }

  worldToCell(x: number, z: number): { cx: number; cz: number } {
    return { cx: Math.floor(x), cz: Math.floor(z) };
  }

  isWalkableAt(x: number, z: number): boolean {
    const c = this.worldToCell(x, z);
    return this.isWalkableCell(c.cx, c.cz);
  }

  // Closest walkable point to (x, z), searching outward ring by ring.
  // Deterministic scan order. Null only if everything within maxRadius is blocked.
  nearestWalkable(x: number, z: number, maxRadius = 25): Vec2 | null {
    const c = this.worldToCell(x, z);
    if (this.isWalkableCell(c.cx, c.cz)) return { x, z };
    for (let r = 1; r <= maxRadius; r++) {
      let best: Vec2 | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = c.cx + dx;
          const cz = c.cz + dz;
          if (!this.isWalkableCell(cx, cz)) continue;
          const px = cx + 0.5;
          const pz = cz + 0.5;
          const d = (px - x) * (px - x) + (pz - z) * (pz - z);
          if (d < bestD) {
            bestD = d;
            best = { x: px, z: pz };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // True when the straight segment from a to b stays on walkable ground,
  // sampled every 0.4 units. Shared by path smoothing and movement.
  lineOfWalk(a: Vec2, b: Vec2): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isWalkableAt(a.x + dx * t, a.z + dz * t)) return false;
    }
    return true;
  }
}
