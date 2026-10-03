// The renderer's planet mode (ADR 0029, ADR 0031, docs/plan-royale.md
// step 8): everything the Wanderseed needs around a renderer written for
// a plane. The renderer keeps drawing in a flat chart around its camera
// (planet_chart.ts), reading the world through the chart (chart_world.ts)
// and bending what it draws onto the sphere (planet_bend.ts); this stage
// owns that chart and moves it with the camera, turns the planet itself
// under it, draws the sky, the Dusk, the caches and the pads, places the
// camera on the curve, answers the clicks with points of the sphere, and
// shows the whole globe for the drop.
//
// Spaces: "local" is the renderer's scene space (inside its z mirror),
// where a chart point (x, z) sits at (O + x, h, O + z); "world" is
// three's, the mirror of local about z = O. The planet's center is at
// (O, -R, O) in both.

import * as THREE from 'three';
import type { SnapCache, WirePoint } from '../net/royale_wire';
import { segmentDist, type Vec3 } from '../sim/geo';
import { DT, type Vec2 } from '../sim/types';
import type { IWorld } from '../world_api';
import { type ChartView, ChartWindow, ChartWorld } from './chart_world';
import { BEND_UNIFORMS, bendTree } from './planet_bend';
import { bendTurn, PlanetChart, rotateAbout } from './planet_chart';
import { type DropOrbit, diveProgress, orbitPosition } from './planet_drop';
import { capAngle, DUSK_UNIFORMS, FADE_TARGETS } from './planet_dusk';
import { PlanetMarks } from './planet_marks';
import { PlanetMinimap } from './planet_minimap';
import { PlanetSky } from './planet_sky';
import type { PlanetGround } from './planet_terrain';
import { PlanetCuller } from './planet_tiles';
import type { ChartRemap } from './vfx/chart_shift';

// The chart window's side: the renderer frames a square this big, the
// chart's origin at its middle (fog canvas, clamps, the minimap's frame).
export const PLANET_WINDOW = 200;
// How far the focus may drift off the chart's origin before it re-centers.
const RECENTER_M = 1;
// Beyond this far from the focus, along the ground, nothing is drawn.
export const VIEW_REACH_M = 70;
// Champions this near the focus throw shadows, on the full model and on a
// phone's light one: the shadow pass draws every caster's body again.
const UNIT_SHADOW_M = 30;
const UNIT_SHADOW_LIGHT_M = 12;
// Champions this near the focus are seen through the props too.
const FADE_REACH_M = 16;
// The dive from the globe to the champion, seconds.
export const DIVE_S = 1.1;
// A pad's arc, meters at its top.
const PAD_ARC_M = 9;
// Charts kept for beats queued under an earlier one.
const HISTORY = 240;
// The share of the screen's height the sky above the horizon takes in
// the middle of its top edge (the corners show more, the limb curving
// down to them).
export const SKY_SHARE = 0.08;
const FOV_DEG = 50;

// How much of the screen's height, at its middle column, looks past the
// horizon, for a camera `dist` from its focus pitched `pitch` below the
// focus's horizontal, over a sphere of `radius`. In the vertical plane of
// the view, the sphere's center at the origin and the focus on top: the
// camera stands back along the ground and up along the normal, the
// horizon is its tangent to the sphere on the far side, and the screen's
// top is half the field of view above the view's middle.
export function skyShare(pitch: number, dist: number, radius: number): number {
  const back = dist * Math.cos(pitch);
  const up = radius + dist * Math.sin(pitch);
  const toCenter = Math.atan2(up, back);
  const tangent = Math.asin(Math.min(1, radius / Math.hypot(back, up)));
  const horizon = toCenter - tangent;
  const half = ((FOV_DEG / 2) * Math.PI) / 180;
  return (horizon - (pitch - half)) / ((FOV_DEG * Math.PI) / 180);
}

// The play camera's offset from its focus on the planet, in the focus's
// frame (+y the ground's normal, +z toward the bottom of the screen): as
// far as the 5v5's rig at the same zoom, pitched so the sky takes
// SKY_SHARE of the top of the screen whatever the zoom.
export function planetRig(zoom: number, radius: number): { y: number; z: number } {
  const dist = Math.hypot(40, 24) * zoom;
  // The sky's share grows as the pitch flattens: bisect for the pitch.
  let lo = (35 * Math.PI) / 180;
  let hi = (85 * Math.PI) / 180;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (skyShare(mid, dist, radius) > SKY_SHARE) lo = mid;
    else hi = mid;
  }
  const pitch = (lo + hi) / 2;
  return { y: dist * Math.sin(pitch), z: dist * Math.cos(pitch) };
}

function wirePoint(w: WirePoint): Vec3 {
  return { x: w[0], y: w[1], z: w[2] };
}

export class PlanetStage {
  readonly view: ChartView;
  readonly window: ChartWindow;
  readonly world: ChartWorld;
  readonly radius: number;
  // The planet, turned under the chart every frame: model, atmosphere,
  // caches, pads, the drop's dots. Never bent.
  readonly root = new THREE.Group();
  readonly sky: PlanetSky;
  // The minimap's window of the same chart (planet_minimap.ts).
  readonly minimap: PlanetMinimap;
  private readonly marks: PlanetMarks;
  // The model cut into tiles, only those in view drawn (planet_tiles.ts).
  readonly culler: PlanetCuller;
  private readonly half: number;
  private readonly history = new Map<number, PlanetChart>();
  // The drop: the orbit the globe is seen from, and the dive's start.
  private orbit: DropOrbit = { azimuth: 0.35, elevation: 0.5, distance: 270 };
  private dropping = false;
  private diveFrom: { pos: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 } | null = null;
  private diveStartMs = 0;
  // The dive's length; a dev page may slow it down to look at it.
  diveSeconds = DIVE_S;
  private dropEndsAt = Number.NEGATIVE_INFINITY;
  // Unit positions on the sphere at the last two ticks, for the pads'
  // flights.
  private readonly flights = new Map<number, { pad: number; from: Vec3; to: Vec3 }>();
  private readonly lastPos = new Map<number, Vec3>();
  private caches: SnapCache[] = [];
  private readonly drag = { active: false, x: 0, y: 0, moved: 0, id: -1 };
  private readonly cleanups: (() => void)[] = [];
  // The champion whose landing a tap on the globe picks (the renderer's
  // followed unit).
  picker: number | null = null;

  constructor(
    readonly base: IWorld,
    readonly ground: PlanetGround,
    private readonly canvas: HTMLCanvasElement,
    private readonly screenRect: () => { left: number; top: number; width: number; height: number },
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.radius = ground.radius;
    this.half = PLANET_WINDOW / 2;
    const start = this.startPoint();
    this.view = { chart: PlanetChart.around(start, this.radius), epoch: 0 };
    this.history.set(0, this.view.chart);
    this.window = new ChartWindow(this.view, PLANET_WINDOW);
    this.world = new ChartWorld(base, this.window);
    this.root.userData.unbent = true;
    this.root.userData.chartFixed = true;
    this.root.name = 'planet-root';
    this.culler = new PlanetCuller(ground.model, ground.radius);
    this.root.add(ground.model);
    this.root.add(atmosphere(this.radius));
    this.marks = new PlanetMarks(ground, this.radius);
    this.root.add(this.marks.group);
    this.sky = new PlanetSky();
    this.minimap = new PlanetMinimap(base, this.view, ground);
    BEND_UNIFORMS.colBendO.value.set(this.half, 0, this.half);
    BEND_UNIFORMS.colBendR.value = this.radius;
    DUSK_UNIFORMS.colRadius.value = this.radius;
    DUSK_UNIFORMS.colChartO.value.set(this.half, 0, this.half);
    DUSK_UNIFORMS.colFogSize.value = PLANET_WINDOW;
    this.placeRoot();
    this.listenForDrop();
  }

  // Where the chart starts: the followed champion once known, else the
  // own drop pick, else the Sanctuary's edge.
  private startPoint(): Vec3 {
    for (const u of this.base.units.values()) {
      if (u.pos.y !== undefined) return u.pos as Vec3;
    }
    const drop = this.base.royaleView?.()?.drop;
    if (drop) return wirePoint(drop);
    return { x: 0.3 * this.radius, y: 0.9 * this.radius, z: 0.3 * this.radius };
  }

  get chart(): PlanetChart {
    return this.view.chart;
  }

  // The ground's height under a point of the renderer's space.
  heightAt(x: number, z: number): number {
    return this.ground.heightAt(this.window.toSphere(x, z));
  }

  // A sphere point in the renderer's space, unbent (the chart's point).
  toLocal(p: Vec2): Vec2 {
    return this.window.toLocal(p);
  }

  toSphere(x: number, z: number): Vec3 {
    return this.window.toSphere(x, z);
  }

  // Re-centers the chart on the renderer's focus once it drifted a meter:
  // the carry from the old chart's points to the new one's, for the
  // renderer to move everything it already placed; null when it stays.
  recenterOn(x: number, z: number, force = false): ChartRemap | null {
    const dx = x - this.half;
    const dz = z - this.half;
    if (!force && dx * dx + dz * dz <= RECENTER_M * RECENTER_M) return null;
    const old = this.view.chart;
    const next = old.recentered(old.fromChart(dx, dz));
    this.view.chart = next;
    this.view.epoch++;
    this.history.set(this.view.epoch, next);
    this.history.delete(this.view.epoch - HISTORY);
    this.placeRoot();
    return this.remapBetween(old, next);
  }

  // Re-centers straight onto a sphere point (the landing after the drop).
  recenterAt(p: Vec3): ChartRemap {
    const old = this.view.chart;
    const next = old.recentered(p);
    this.view.chart = next;
    this.view.epoch++;
    this.history.set(this.view.epoch, next);
    this.history.delete(this.view.epoch - HISTORY);
    this.placeRoot();
    return this.remapBetween(old, next);
  }

  private remapBetween(from: PlanetChart, to: PlanetChart): ChartRemap {
    const o = this.half;
    return (x, z) => {
      const q = to.toChart(from.fromChart(x - o, z - o));
      return { x: q.x + o, z: q.z + o };
    };
  }

  // The carry from an earlier epoch's chart to now (a beat queued then).
  carryFrom(epoch: number): ChartRemap | null {
    const from = this.history.get(epoch);
    return from ? this.remapBetween(from, this.view.chart) : null;
  }

  get epoch(): number {
    return this.view.epoch;
  }

  // The planet turned so the chart's center is on top and its axes lie
  // along the renderer's: sphere point p at rows . p + (O, -R, O).
  private placeRoot(): void {
    const [e, u, n] = this.view.chart.rows();
    const m = new THREE.Matrix4().set(
      e.x,
      e.y,
      e.z,
      0,
      u.x,
      u.y,
      u.z,
      0,
      n.x,
      n.y,
      n.z,
      0,
      0,
      0,
      0,
      1,
    );
    this.root.quaternion.setFromRotationMatrix(m);
    this.root.position.set(this.half, -this.radius, this.half);
  }

  // The world position a sphere point is shown at, lifted along its normal.
  shownAt(p: Vec3, lift: number): THREE.Vector3 {
    const r = Math.hypot(p.x, p.y, p.z);
    const k = (this.radius + this.ground.heightAt(p) + lift) / r;
    const [e, u, n] = this.view.chart.rows();
    const lx = (e.x * p.x + e.y * p.y + e.z * p.z) * k;
    const ly = (u.x * p.x + u.y * p.y + u.z * p.z) * k;
    const lz = (n.x * p.x + n.y * p.y + n.z * p.z) * k;
    // Local to world: the mirror about z = O.
    return new THREE.Vector3(this.half + lx, ly - this.radius, this.half - lz);
  }

  // The world position a point of the renderer's space is shown at: the
  // bend, in world space about the chart's origin.
  bentWorld(x: number, y: number, z: number): THREE.Vector3 {
    const o = this.half;
    const lx = x - o;
    const lz = o - z;
    const r = Math.hypot(lx, lz);
    if (r < 1e-9) return new THREE.Vector3(x, y, o);
    const R = this.radius;
    const phi = r / R;
    const s = ((R + y) * Math.sin(phi)) / r;
    const half = Math.sin(phi / 2);
    return new THREE.Vector3(o + lx * s, y * Math.cos(phi) - 2 * R * half * half, o + lz * s);
  }

  // The planet's center in world space.
  get center(): THREE.Vector3 {
    return new THREE.Vector3(this.half, -this.radius, this.half);
  }

  // Whether a world point is hidden behind the planet from the camera:
  // the segment to it passes inside the ground's sphere.
  occluded(point: THREE.Vector3, eye = this.camera.position): boolean {
    const c = this.center;
    const d = point.clone().sub(eye);
    const len2 = d.lengthSq();
    if (len2 < 1e-9) return false;
    const t = Math.max(0, Math.min(1, c.clone().sub(eye).dot(d) / len2));
    if (t >= 0.999) return false;
    const closest = eye.clone().addScaledVector(d, t);
    return closest.distanceTo(c) < this.radius - 0.6;
  }

  // Whether something at a point of the renderer's space, `lift` above
  // its ground, is in view: near enough along the ground and in front of
  // the horizon.
  sees(x: number, z: number, lift: number): boolean {
    const dx = x - this.half;
    const dz = z - this.half;
    if (dx * dx + dz * dz > VIEW_REACH_M * VIEW_REACH_M) return false;
    // Read off the world, not the last frame: a tick may come first.
    if (this.base.royaleView?.()?.st === 'drop') return false;
    return !this.occluded(this.bentWorld(x, this.heightAt(x, z) + lift, z));
  }

  // The turn that keeps a unit's overhead row facing the camera on the
  // curve: the angle, about the unit's up, that lays its x along the
  // camera's right once bent there.
  overheadYaw(x: number, z: number): number {
    const m = this.camera.matrixWorld.elements;
    const right = { x: m[0]!, y: m[1]!, z: m[2]! };
    const lx = x - this.half;
    const lz = this.half - z;
    const r = Math.hypot(lx, lz);
    const v =
      r < 1e-9 ? right : rotateAbout(right, { x: lz / r, y: 0, z: -lx / r }, -r / this.radius);
    // In the scene's mirrored space, three's rotation.y lays +x at
    // (cos a, 0, -sin a): the world's z is the scene's -z.
    return Math.atan2(v.z, v.x);
  }

  // A ray from the camera against the planet: the sphere point under a
  // screen point, its height refined a few times like the plane's.
  groundPointAt(ray: THREE.Ray): Vec3 | null {
    if (this.dropping) return null;
    return this.rayOnSphere(ray);
  }

  private rayOnSphere(ray: THREE.Ray): Vec3 | null {
    const c = this.center;
    let h = 0;
    let hit: THREE.Vector3 | null = null;
    for (let i = 0; i < 5; i++) {
      const sphere = new THREE.Sphere(c, this.radius + h);
      const at = ray.intersectSphere(sphere, new THREE.Vector3());
      if (!at) return hit ? this.sphereOf(hit) : null;
      hit = at;
      h = this.ground.heightAt(this.sphereOf(at));
    }
    return hit ? this.sphereOf(hit) : null;
  }

  // The sphere point under a world position, on the sim's sphere.
  sphereOf(w: THREE.Vector3): Vec3 {
    const lx = w.x - this.half;
    const ly = w.y + this.radius;
    const lz = this.half - w.z;
    const [e, u, n] = this.view.chart.rows();
    const x = e.x * lx + u.x * ly + n.x * lz;
    const y = e.y * lx + u.y * ly + n.y * lz;
    const z = e.z * lx + u.z * ly + n.z * lz;
    const d = Math.hypot(x, y, z);
    return { x: (x / d) * this.radius, y: (y / d) * this.radius, z: (z / d) * this.radius };
  }

  // Screen pixels of a sphere point lifted above its ground; null behind
  // the camera, behind the planet, or past the view's reach.
  projectSphere(p: Vec3, lift: number): { x: number; y: number } | null {
    const w = this.shownAt(p, lift);
    if (!this.dropping) {
      const q = this.window.toLocal(p);
      const dx = q.x - this.half;
      const dz = q.z - this.half;
      if (dx * dx + dz * dz > VIEW_REACH_M * VIEW_REACH_M) return null;
    }
    if (this.occluded(w)) return null;
    const v = w.project(this.camera);
    if (v.z > 1) return null;
    const rect = this.screenRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  // The play camera: the rig's offset turned onto the ground's tilt at
  // the focus, looking at it with the ground's normal for up.
  placeCamera(focus: THREE.Vector3, zoom: number): void {
    const target = this.bentWorld(focus.x, focus.y, focus.z);
    const lx = focus.x - this.half;
    const lz = this.half - focus.z;
    const rig = planetRig(zoom, this.radius);
    const o = bendTurn({ x: 0, y: rig.y, z: rig.z }, lx, lz, this.radius);
    const up = bendTurn({ x: 0, y: 1, z: 0 }, lx, lz, this.radius);
    const pos = new THREE.Vector3(target.x + o.x, target.y + o.y, target.z + o.z);
    const upV = new THREE.Vector3(up.x, up.y, up.z);
    if (this.diveFrom) {
      const k = diveProgress((performance.now() - this.diveStartMs) / 1000 / this.diveSeconds);
      if (k >= 1) this.diveFrom = null;
      else {
        const c = this.center;
        const a = this.diveFrom.pos.clone().sub(c);
        const b = pos.clone().sub(c);
        const dir = a.clone().normalize().lerp(b.clone().normalize(), k).normalize();
        pos.copy(c).addScaledVector(dir, a.length() + (b.length() - a.length()) * k);
        target.lerpVectors(this.diveFrom.target, target, k);
        upV.lerpVectors(this.diveFrom.up, upV, k).normalize();
      }
    }
    this.camera.position.copy(pos);
    this.camera.up.copy(upV);
    this.camera.lookAt(target);
  }

  // The camera this frame: the globe's orbit through the drop, the play
  // rig (the dive blended in) after it.
  placeView(focus: THREE.Vector3, zoom: number, dtMs: number): void {
    if (this.dropping) this.placeOrbitCamera(dtMs);
    else this.placeCamera(focus, zoom);
    this.camera.updateMatrixWorld(true);
  }

  // The key light: over the chart's origin through the play, as the 5v5
  // has it; through the drop, over the camera's shoulder so the side of
  // the globe being looked at is lit.
  sunFollow(sun: THREE.DirectionalLight | null): void {
    if (!sun) return;
    const o = this.half;
    if (!this.dropping && !this.diveFrom) {
      sun.position.set(o + 70, 120, o + 45);
      sun.target.position.set(o, 0, o);
      return;
    }
    const c = this.center;
    const m = this.camera.matrixWorld.elements;
    const toCam = this.camera.position.clone().sub(c).normalize();
    const dir = toCam
      .addScaledVector(new THREE.Vector3(m[0], m[1], m[2]), 0.55)
      .addScaledVector(new THREE.Vector3(m[4], m[5], m[6]), 0.45)
      .normalize();
    const w = c.clone().addScaledVector(dir, 200);
    // World to the scene's mirrored space.
    sun.position.set(w.x, w.y, 2 * o - w.z);
    sun.target.position.set(c.x, c.y, 2 * o - c.z);
  }

  // The drop's camera: the whole globe from its orbit, turning slowly
  // while nobody drags it.
  private placeOrbitCamera(dtMs: number): void {
    if (!this.drag.active) this.orbit.azimuth += dtMs * 0.00006;
    const c = this.center;
    const at = orbitPosition(c, this.orbit);
    this.camera.position.set(at.x, at.y, at.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(c);
  }

  // True while the drop holds the camera (the renderer skips its own).
  get droppingNow(): boolean {
    return this.dropping;
  }

  // Per frame, before the draw: the stage, the planet under the chart,
  // the Dusk, the fog, the sky, the caches, the drop's dots and camera.
  update(now: number, dtMs: number, fog: THREE.Texture, follow: Vec2 | null): void {
    const royale = this.base.royaleView?.() ?? null;
    const stage = royale?.st ?? null;
    if (royale?.caches) this.caches = royale.caches;
    if (royale) this.dropEndsAt = royale.de;
    const wasDropping = this.dropping;
    this.dropping = stage === 'drop';
    if (this.dropping && !wasDropping) this.diveFrom = null;
    if (!this.dropping && wasDropping) this.beginDive(follow);
    void dtMs;

    this.root.updateMatrixWorld(true);
    DUSK_UNIFORMS.colPlanetInv.value.copy(this.root.matrixWorld).invert();
    DUSK_UNIFORMS.colTime.value = now / 1000;
    DUSK_UNIFORMS.colFogMap.value = fog;
    // No fog of war over the globe, nor through the dive down from it.
    DUSK_UNIFORMS.colFogOn.value = this.dropping || this.diveFrom ? 0 : 1;
    const dusk = royale?.dusk;
    if (dusk) {
      const c = wirePoint(dusk.c);
      const d = Math.hypot(c.x, c.y, c.z) || 1;
      DUSK_UNIFORMS.colDuskOn.value = 1;
      DUSK_UNIFORMS.colDuskDir.value.set(c.x / d, c.y / d, c.z / d);
      DUSK_UNIFORMS.colDuskAngle.value = capAngle(dusk.r, this.radius);
      if (dusk.nc && dusk.nr !== undefined) {
        const n = wirePoint(dusk.nc);
        const nd = Math.hypot(n.x, n.y, n.z) || 1;
        DUSK_UNIFORMS.colNextOn.value = 1;
        DUSK_UNIFORMS.colNextDir.value.set(n.x / nd, n.y / nd, n.z / nd);
        DUSK_UNIFORMS.colNextAngle.value = capAngle(dusk.nr, this.radius);
      } else DUSK_UNIFORMS.colNextOn.value = 0;
    } else {
      DUSK_UNIFORMS.colDuskOn.value = 0;
      DUSK_UNIFORMS.colNextOn.value = 0;
    }
    this.marks.update(now, this.caches, royale, this.dropping);
    this.minimap.paint(now, royale?.dusk ?? null, this.caches);
  }

  // The drop ended: the chart lands on the champion and the camera dives
  // from where the globe was seen, the globe turned with the chart so
  // nothing jumps.
  private beginDive(follow: Vec2 | null): void {
    const from = {
      pos: this.camera.position.clone(),
      target: this.center,
      up: this.camera.up.clone(),
    };
    if (follow && follow.y !== undefined) {
      const before = this.view.chart;
      const remap = this.recenterAt(follow as Vec3);
      this.pendingRemap = remap;
      const turn = chartTurn(before, this.view.chart);
      const c = this.center;
      from.pos.sub(c).applyMatrix3(turn).add(c);
      from.up.applyMatrix3(turn);
    }
    this.diveFrom = from;
    this.diveStartMs = performance.now();
  }

  // A carry the stage made itself (the landing), for the renderer to
  // apply to what it placed; taken once.
  private pendingRemap: ChartRemap | null = null;
  takeRemap(): ChartRemap | null {
    const r = this.pendingRemap;
    this.pendingRemap = null;
    return r;
  }

  // The champions the props thin out for (planet_dusk.ts): the followed
  // one first, then the nearest others within FADE_REACH_M of the focus,
  // as points of the renderer's space at their feet; their chests in
  // world space go to the shader.
  setFadeTargets(
    champions: readonly { id: number; x: number; y: number; z: number }[],
    followId: number | null,
  ): void {
    const reach2 = FADE_REACH_M * FADE_REACH_M;
    const o = this.half;
    const near = champions
      .map((c) => ({ c, d2: (c.x - o) ** 2 + (c.z - o) ** 2 }))
      .filter(({ c, d2 }) => c.id === followId || d2 <= reach2)
      .sort((a, b) => (a.c.id === followId ? -1 : b.c.id === followId ? 1 : a.d2 - b.d2))
      .slice(0, FADE_TARGETS);
    const at = DUSK_UNIFORMS.colFadeAt.value;
    for (const [i, { c }] of near.entries()) {
      at[i]!.copy(this.bentWorld(c.x, c.y + 1.2, c.z));
    }
    DUSK_UNIFORMS.colFadeN.value = near.length;
  }

  // Whether a champion at this point of the renderer's space throws a
  // shadow: only near the focus, nearer on a phone.
  castsShadow(x: number, z: number): boolean {
    const reach = this.ground.light ? UNIT_SHADOW_LIGHT_M : UNIT_SHADOW_M;
    const dx = x - this.half;
    const dz = z - this.half;
    return dx * dx + dz * dz <= reach * reach;
  }

  // How far above its ground a unit is drawn: thrown by a pad along its
  // arc, or falling the last stretch of the drop.
  liftOf(unitId: number, x: number, z: number): number {
    let lift = 0;
    const flight = this.flights.get(unitId);
    if (flight) {
      const p = this.window.toSphere(x, z);
      const total = Math.hypot(
        flight.to.x - flight.from.x,
        flight.to.y - flight.from.y,
        flight.to.z - flight.from.z,
      );
      const t = Math.max(
        0,
        Math.min(
          1,
          Math.hypot(p.x - flight.from.x, p.y - flight.from.y, p.z - flight.from.z) / total,
        ),
      );
      lift += 4 * PAD_ARC_M * t * (1 - t);
    }
    const since = this.base.time - this.dropEndsAt;
    if (since >= 0 && since < 1) lift += (1 - since) * (1 - since) * 28;
    return lift;
  }

  // Per tick: who is in a pad's flight (fast, on its great circle).
  onTick(): void {
    const pads = this.ground.layout.pads;
    for (const u of this.base.units.values()) {
      if (u.kind !== 'champion' || u.pos.y === undefined) continue;
      const p = u.pos as Vec3;
      const last = this.lastPos.get(u.id);
      this.lastPos.set(u.id, { x: p.x, y: p.y, z: p.z });
      if (!last) continue;
      const speed = Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) / DT;
      const flying = this.flights.get(u.id);
      if (speed < 12) {
        if (flying) this.flights.delete(u.id);
        continue;
      }
      if (flying) continue;
      for (const [i, pad] of pads.entries()) {
        const near = segmentDist(p, pad.at, pad.to);
        if (near.d < 2.5 && near.t < 0.6) {
          this.flights.set(u.id, { pad: i, from: pad.at, to: pad.to });
          break;
        }
      }
    }
    for (const id of this.lastPos.keys()) {
      if (!this.base.units.has(id)) {
        this.lastPos.delete(id);
        this.flights.delete(id);
      }
    }
  }

  // Bends what the renderer draws in its scene (planet_bend.ts), every
  // frame: new bodies and effects are patched before their first draw.
  bendScene(scene: THREE.Object3D): void {
    for (const child of scene.children) bendTree(child);
  }

  // The drop's pointer: a drag turns the globe, a tap picks the landing.
  private listenForDrop(): void {
    const el = this.canvas;
    const down = (e: PointerEvent): void => {
      if (!this.dropping) return;
      this.drag.active = true;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.drag.moved = 0;
      this.drag.id = e.pointerId;
    };
    const move = (e: PointerEvent): void => {
      if (!this.drag.active || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.orbit.azimuth -= dx * 0.006;
      this.orbit.elevation = Math.max(-1.35, Math.min(1.35, this.orbit.elevation + dy * 0.006));
    };
    const up = (e: PointerEvent): void => {
      if (!this.drag.active || e.pointerId !== this.drag.id) return;
      this.drag.active = false;
      if (!this.dropping || this.drag.moved > 8) return;
      const rect = this.screenRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const p = this.rayOnSphere(ray.ray);
      if (p && this.picker !== null) this.base.pickDrop?.(this.picker, p);
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.cleanups.push(() => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    });
  }

  // Before the draw: the bend on, the pooled lights shown where their
  // chart point is bent to. After it: everything back.
  beginDraw(lights: readonly THREE.PointLight[]): () => void {
    this.sky.follow(this.camera, 2 * this.half);
    // The chart may have moved since update(): the planet's matrix as it
    // is drawn, for the ground's shading and for the tiles in view.
    this.root.updateMatrixWorld(true);
    DUSK_UNIFORMS.colPlanetInv.value.copy(this.root.matrixWorld).invert();
    this.culler.update(this.camera, this.root.matrixWorld, this.view.chart.up);
    DUSK_UNIFORMS.colFadeEye.value.copy(this.camera.position);
    if (this.dropping || this.diveFrom) DUSK_UNIFORMS.colFadeN.value = 0;
    BEND_UNIFORMS.colBendO.value.set(this.half, 0, this.half);
    BEND_UNIFORMS.colBendR.value = this.radius;
    BEND_UNIFORMS.colBendOn.value = 1;
    const saved = lights.map((l) => l.position.clone());
    for (const l of lights) {
      // Scene space to world (the mirror), bent, and back.
      const w = this.bentWorld(l.position.x, l.position.y, l.position.z);
      l.position.set(w.x, w.y, 2 * this.half - w.z);
    }
    return () => {
      BEND_UNIFORMS.colBendOn.value = 0;
      for (const [i, l] of lights.entries()) l.position.copy(saved[i]!);
    };
  }

  dispose(): void {
    for (const off of this.cleanups) off();
    this.cleanups.length = 0;
    this.sky.dispose();
    this.marks.dispose();
  }
}

// The world-space turn the planet takes when the chart moves from one
// center to another: sphere point p shows at mirror(rows . p) about the
// planet's center, so the turn is mirror . rowsB . rowsA^T . mirror.
export function chartTurn(a: PlanetChart, b: PlanetChart): THREE.Matrix3 {
  const ra = a.rows();
  const rb = b.rows();
  const A = new THREE.Matrix3().set(
    ra[0].x,
    ra[0].y,
    ra[0].z,
    ra[1].x,
    ra[1].y,
    ra[1].z,
    ra[2].x,
    ra[2].y,
    ra[2].z,
  );
  const B = new THREE.Matrix3().set(
    rb[0].x,
    rb[0].y,
    rb[0].z,
    rb[1].x,
    rb[1].y,
    rb[1].z,
    rb[2].x,
    rb[2].y,
    rb[2].z,
  );
  const mirror = new THREE.Matrix3().set(1, 0, 0, 0, 1, 0, 0, 0, -1);
  return mirror.clone().multiply(B).multiply(A.transpose()).multiply(mirror);
}

// The thin glowing shell around the planet: its limb against space.
function atmosphere(radius: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float a = pow(f, 3.0) * 0.85;
        gl_FragColor = vec4(vec3(0.45, 0.68, 1.0) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.045, 64, 40), material);
  shell.name = 'atmosphere';
  shell.userData.noDusk = true;
  shell.renderOrder = 2;
  return shell;
}
