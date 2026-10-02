// The ground's navigation behind one seam (ADR 0029): walkable here, the
// nearest walkable point, a line of walk, a path, the ground height, and the
// circles a wall or a standing structure blocks. Every system that runs on
// the planet asks the ground, never a grid. The Star Orchard's grid and A*
// (navgrid.ts, terrain_nav.ts, pathfind.ts) sit behind PlaneGround, called
// with exactly the arguments the sim always passed them, so the 5v5 walks
// as it did; the planet's cube-sphere grid (sphere_nav.ts) sits behind
// SphereGround.

import { onSphere, settle } from './geo';
import type { NavGrid } from './navgrid';
import { findPath } from './pathfind';
import { TerrainNavGrid } from './terrain_nav';
import type { Vec2 } from './types';

export interface Ground {
  isWalkableAt(p: Vec2): boolean;
  // The closest walkable point within maxCells of the grid's cells, the
  // point itself when it already is; null when nothing near is open.
  nearestWalkable(p: Vec2, maxCells?: number): Vec2 | null;
  // The straight walk from a to b (a great circle on the sphere) stays on
  // walkable ground.
  lineOfWalk(a: Vec2, b: Vec2): boolean;
  // Waypoints from `from` to `to`, empty when there is no way.
  findPath(from: Vec2, to: Vec2): Vec2[];
  // The ground's height under a point, presentation only.
  heightAt(p: Vec2): number;
  // One blocker more, or less, on every cell inside the circle; an unblock
  // mirrors an earlier block of the same shape.
  blockCircle(p: Vec2, r: number): void;
  unblockCircle(p: Vec2, r: number): void;
  // The blockers as they stand, for a world checkpoint, and back.
  snapshotBlockers(): Uint8Array;
  restoreBlockers(b: Uint8Array): void;
}

// The plane: the map's NavGrid (or the Star Orchard's terrain grid) and the
// grid's A*.
export class PlaneGround implements Ground {
  constructor(readonly nav: NavGrid) {}

  isWalkableAt(p: Vec2): boolean {
    return this.nav.isWalkableAt(p.x, p.z);
  }

  nearestWalkable(p: Vec2, maxCells?: number): Vec2 | null {
    return this.nav.nearestWalkable(p.x, p.z, maxCells);
  }

  lineOfWalk(a: Vec2, b: Vec2): boolean {
    return this.nav.lineOfWalk(a, b);
  }

  findPath(from: Vec2, to: Vec2): Vec2[] {
    return findPath(this.nav, from, to);
  }

  heightAt(p: Vec2): number {
    return this.nav instanceof TerrainNavGrid ? this.nav.heightAt(p.x, p.z) : 0;
  }

  blockCircle(p: Vec2, r: number): void {
    this.nav.blockCircle(p.x, p.z, r);
  }

  unblockCircle(p: Vec2, r: number): void {
    this.nav.unblockCircle(p.x, p.z, r);
  }

  snapshotBlockers(): Uint8Array {
    return this.nav.snapshotBlockers();
  }

  restoreBlockers(b: Uint8Array): void {
    this.nav.restoreBlockers(b);
  }
}

// A point on the sphere, as the planet's navigation takes and gives it.
export interface SpherePoint {
  x: number;
  y: number;
  z: number;
}

// The planet's navigation as SphereGround reads it: the members of
// sphere_nav.ts's SphereNavGrid, declared here by shape so the seam stands
// on its own.
export interface SphereNav {
  readonly radius: number;
  readonly n: number;
  readonly cellCount: number;
  cellOf(p: SpherePoint): number;
  cellCenter(i: number): SpherePoint;
  isWalkableCell(i: number): boolean;
  isWalkableAt(p: SpherePoint): boolean;
  neighbors(i: number, out: Int32Array): number;
  nearestWalkable(p: SpherePoint, maxRadiusCells?: number): SpherePoint | null;
  lineOfWalk(a: SpherePoint, b: SpherePoint): boolean;
  heightAt(p: SpherePoint): number;
  blockCircle(p: SpherePoint, r: number): void;
  unblockCircle(p: SpherePoint, r: number): void;
  snapshotBlockers(): Uint8Array;
  restoreBlockers(b: Uint8Array): void;
}

// The planet's A* over its grid (sphere_nav.ts, findSpherePath).
export type SpherePathFinder<G extends SphereNav> = (
  grid: G,
  from: SpherePoint,
  to: SpherePoint,
) => SpherePoint[];

// A point that is not a sphere point names no place on the planet (an
// order from a client that sent the plane's two coordinates): nothing there
// is walkable and no path leads to it, rather than a crash.
function asSphere(p: Vec2): SpherePoint | null {
  return onSphere(p) ? p : null;
}

// The sphere: the planet's grid and its A*.
export class SphereGround<G extends SphereNav = SphereNav> implements Ground {
  constructor(
    readonly grid: G,
    private readonly pathFinder: SpherePathFinder<G>,
  ) {}

  isWalkableAt(p: Vec2): boolean {
    const s = asSphere(p);
    return s !== null && this.grid.isWalkableAt(s);
  }

  nearestWalkable(p: Vec2, maxCells?: number): Vec2 | null {
    const s = asSphere(p);
    return s ? this.grid.nearestWalkable(s, maxCells) : null;
  }

  lineOfWalk(a: Vec2, b: Vec2): boolean {
    const sa = asSphere(a);
    const sb = asSphere(b);
    return sa !== null && sb !== null && this.grid.lineOfWalk(sa, sb);
  }

  findPath(from: Vec2, to: Vec2): Vec2[] {
    const sa = asSphere(from);
    const sb = asSphere(to);
    if (!sa || !sb) return [];
    return this.pathFinder(this.grid, sa, sb);
  }

  heightAt(p: Vec2): number {
    const s = asSphere(p);
    return s ? this.grid.heightAt(s) : 0;
  }

  blockCircle(p: Vec2, r: number): void {
    const s = asSphere(p);
    if (s) this.grid.blockCircle(s, r);
  }

  unblockCircle(p: Vec2, r: number): void {
    const s = asSphere(p);
    if (s) this.grid.unblockCircle(s, r);
  }

  snapshotBlockers(): Uint8Array {
    return this.grid.snapshotBlockers();
  }

  restoreBlockers(b: Uint8Array): void {
    this.grid.restoreBlockers(b);
  }
}

// A bare sphere, open everywhere, for tests: every sphere point walkable,
// every path the straight great circle to the goal, nothing ever blocked.
export class OpenSphereGround implements Ground {
  constructor(readonly radius: number) {}

  isWalkableAt(p: Vec2): boolean {
    return onSphere(p);
  }

  nearestWalkable(p: Vec2): Vec2 | null {
    return onSphere(p) ? settle(p, this.radius) : null;
  }

  lineOfWalk(a: Vec2, b: Vec2): boolean {
    return onSphere(a) && onSphere(b);
  }

  findPath(from: Vec2, to: Vec2): Vec2[] {
    if (!onSphere(from) || !onSphere(to)) return [];
    return [settle(to, this.radius)];
  }

  heightAt(): number {
    return 0;
  }

  blockCircle(): void {}

  unblockCircle(): void {}

  snapshotBlockers(): Uint8Array {
    return new Uint8Array(0);
  }

  restoreBlockers(): void {}
}
