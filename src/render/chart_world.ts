// The world as the planet's chart shows it (planet_chart.ts): an IWorld
// over the real one whose every position is a point of the flat chart
// around the camera, offset into a square the renderer already knows how
// to draw (its fog canvas, its clamps, its minimap's frame). The renderer
// and the minimap read the Wanderseed through it unchanged, as if it were
// a plane; orders given through it go back to the sphere. Positions are
// converted lazily and kept until the unit moves or the chart re-centers.

import type { GameMap } from '../sim/content/map';
import type { Vec3 } from '../sim/geo';
import type { Projectile } from '../sim/projectiles';
import type { AbilityKey, TeamId, Vec2 } from '../sim/types';
import type { Unit } from '../sim/unit';
import type { Wall } from '../sim/walls';
import type { Zone } from '../sim/zones';
import type { IWorld } from '../world_api';
import type { PlanetChart } from './planet_chart';

// The chart in use, shared by everything that reads through it: the
// stage re-centers it and counts the epochs, so cached conversions know
// when they went stale.
export interface ChartView {
  chart: PlanetChart;
  epoch: number;
}

// A square window of the chart: `size` meters a side, the chart's origin
// at its middle.
export class ChartWindow {
  readonly half: number;

  constructor(
    readonly view: ChartView,
    readonly size: number,
  ) {
    this.half = size / 2;
  }

  // A world point as the window shows it; a point without y (none on the
  // planet) passes through as it is.
  toLocal(p: Vec2): Vec2 {
    if (p.y === undefined) return { x: p.x, z: p.z };
    const q = this.view.chart.toChart(p as Vec3);
    return { x: q.x + this.half, z: q.z + this.half };
  }

  // The sphere point a window point stands for.
  toSphere(x: number, z: number): Vec3 {
    return this.view.chart.fromChart(x - this.half, z - this.half);
  }

  // A tangent direction at a sphere point, as the window draws it.
  dirToLocal(at: Vec2, dir: Vec2): Vec2 {
    if (at.y === undefined || dir.y === undefined) return { x: dir.x, z: dir.z };
    return this.view.chart.dirToChart(at as Vec3, dir as Vec3);
  }
}

interface Cached<T> {
  src: T;
  epoch: number;
  x: number;
  y: number | undefined;
  z: number;
  key: unknown;
  out: T;
}

// A read-only map whose values are converted on the way out, each kept
// while its source neither moved nor changed its keyed part.
class ChartedMap<V> implements ReadonlyMap<number, Readonly<V>> {
  private readonly cache = new Map<number, Cached<Readonly<V>>>();

  constructor(
    private readonly base: () => ReadonlyMap<number, Readonly<V>>,
    private readonly view: ChartView,
    private readonly posOf: (v: Readonly<V>) => Vec2,
    private readonly convert: (v: Readonly<V>) => Readonly<V>,
    private readonly keyOf: (v: Readonly<V>) => unknown = () => null,
  ) {}

  private wrap(id: number, v: Readonly<V>): Readonly<V> {
    const c = this.cache.get(id);
    const key = this.keyOf(v);
    const pos = this.posOf(v);
    if (
      c &&
      c.src === v &&
      c.epoch === this.view.epoch &&
      c.x === pos.x &&
      c.y === pos.y &&
      c.z === pos.z &&
      c.key === key
    ) {
      return c.out;
    }
    const out = this.convert(v);
    this.cache.set(id, {
      src: v,
      epoch: this.view.epoch,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      key,
      out,
    });
    if (this.cache.size > this.base().size * 2 + 64) this.prune();
    return out;
  }

  private prune(): void {
    const live = this.base();
    for (const id of this.cache.keys()) if (!live.has(id)) this.cache.delete(id);
  }

  get size(): number {
    return this.base().size;
  }

  get(id: number): Readonly<V> | undefined {
    const v = this.base().get(id);
    return v === undefined ? undefined : this.wrap(id, v);
  }

  has(id: number): boolean {
    return this.base().has(id);
  }

  keys(): MapIterator<number> {
    return this.base().keys();
  }

  *values(): MapIterator<Readonly<V>> {
    for (const [id, v] of this.base()) yield this.wrap(id, v);
  }

  *entries(): MapIterator<[number, Readonly<V>]> {
    for (const [id, v] of this.base()) yield [id, this.wrap(id, v)];
  }

  [Symbol.iterator](): MapIterator<[number, Readonly<V>]> {
    return this.entries();
  }

  forEach(
    fn: (value: Readonly<V>, key: number, map: ReadonlyMap<number, Readonly<V>>) => void,
  ): void {
    for (const [id, v] of this.entries()) fn(v, id, this);
  }
}

// The chart's square as a map: the size the renderer frames, and nothing
// of the 5v5's furniture (no lanes, towers, river, pits or rings).
function windowMap(base: GameMap, size: number): GameMap {
  return {
    ...base,
    size,
    fountains: [],
    spawns: [],
    sanctums: [],
    towers: [],
    lanes: { top: [], mid: [], bot: [] },
    walls: [],
    brush: [],
    wardenPits: [],
    camps: [],
    rings: [],
  };
}

export class ChartWorld implements IWorld {
  readonly units: ReadonlyMap<number, Readonly<Unit>>;
  readonly projectiles: ReadonlyMap<number, Readonly<Projectile>>;
  readonly zones: ReadonlyMap<number, Readonly<Zone>>;
  readonly walls: ReadonlyMap<number, Readonly<Wall>>;
  private mapCache: { base: GameMap; out: GameMap } | null = null;

  constructor(
    readonly base: IWorld,
    readonly window: ChartWindow,
  ) {
    const w = window;
    this.units = new ChartedMap(
      () => base.units,
      w.view,
      (u) => u.pos,
      (u) => {
        const out = Object.create(u) as Unit;
        out.pos = w.toLocal(u.pos);
        if (u.pendingSpell) out.pendingSpell = { ...u.pendingSpell, aim: w.toLocal(u.pendingSpell.aim) };
        if (u.attackMoveTarget) out.attackMoveTarget = w.toLocal(u.attackMoveTarget);
        if (u.recastArmed) out.recastArmed = { ...u.recastArmed, origin: w.toLocal(u.recastArmed.origin) };
        return out;
      },
      (u) => u.pendingSpell,
    );
    this.projectiles = new ChartedMap(
      () => base.projectiles,
      w.view,
      (p) => p.pos,
      (p) => {
        const out = Object.create(p) as Projectile;
        out.pos = w.toLocal(p.pos);
        out.dir = w.dirToLocal(p.pos, p.dir);
        return out;
      },
    );
    this.zones = new ChartedMap(
      () => base.zones,
      w.view,
      (z) => z.pos,
      (z) => {
        const out = Object.create(z) as Zone;
        out.pos = w.toLocal(z.pos);
        return out;
      },
    );
    this.walls = new ChartedMap(
      () => base.walls,
      w.view,
      (wall) => wall.a,
      (wall) => {
        const out = Object.create(wall) as Wall;
        out.a = w.toLocal(wall.a);
        out.b = w.toLocal(wall.b);
        out.samples = wall.samples.map((s) => w.toLocal(s));
        return out;
      },
      (wall) => wall.b,
    );
  }

  get map(): GameMap {
    const base = this.base.map;
    if (this.mapCache?.base !== base) {
      this.mapCache = { base, out: windowMap(base, this.window.size) };
    }
    return this.mapCache.out;
  }

  get time(): number {
    return this.base.time;
  }

  get winner(): TeamId | null {
    return this.base.winner;
  }

  championDef(championId: string) {
    return this.base.championDef(championId);
  }

  scoreboard() {
    return this.base.scoreboard();
  }

  isVisible(team: TeamId, unitId: number): boolean {
    return this.base.isVisible(team, unitId);
  }

  teamBuff(team: TeamId) {
    return this.base.teamBuff(team);
  }

  objectiveSpawnAt(): number | null {
    return this.base.objectiveSpawnAt();
  }

  wardenPit() {
    return null;
  }

  ringClocks() {
    return [];
  }

  teamFavors(team: TeamId) {
    return this.base.teamFavors(team);
  }

  teamWrath(team: TeamId): number | null {
    return this.base.teamWrath(team);
  }

  predictedPos(unitId: number, now: number) {
    const p = this.base.predictedPos?.(unitId, now) ?? null;
    if (!p) return null;
    const local = this.window.toLocal(p);
    const heading = p.heading ? this.window.dirToLocal(p, p.heading) : null;
    return { x: local.x, z: local.z, heading };
  }

  royale() {
    return this.base.royale?.() ?? null;
  }

  pickDrop(point: Vec3): void {
    this.base.pickDrop?.(point);
  }

  // Orders given in the window's coordinates, sent as sphere points.
  orderMove(unitId: number, x: number, z: number): void {
    const p = this.window.toSphere(x, z);
    this.base.orderMove(unitId, p.x, p.z, p.y);
  }

  orderAttack(unitId: number, targetId: number): void {
    this.base.orderAttack(unitId, targetId);
  }

  orderAttackMove(unitId: number, x: number, z: number): void {
    const p = this.window.toSphere(x, z);
    this.base.orderAttackMove(unitId, p.x, p.z, p.y);
  }

  orderStop(unitId: number): void {
    this.base.orderStop(unitId);
  }

  startRecall(unitId: number): void {
    this.base.startRecall(unitId);
  }

  castAbility(unitId: number, key: AbilityKey, aim: Vec2): boolean {
    return this.base.castAbility(unitId, key, this.window.toSphere(aim.x, aim.z));
  }

  castSigil(unitId: number, slot: number, aim: Vec2): boolean {
    return this.base.castSigil(unitId, slot, this.window.toSphere(aim.x, aim.z));
  }

  buyItem(unitId: number, itemId: string): boolean {
    return this.base.buyItem(unitId, itemId);
  }

  sellItem(unitId: number, slot: number): boolean {
    return this.base.sellItem(unitId, slot);
  }

  levelAbility(unitId: number, key: AbilityKey): boolean {
    return this.base.levelAbility(unitId, key);
  }
}
