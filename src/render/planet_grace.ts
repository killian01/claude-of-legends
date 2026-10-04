// The Grace on the Wanderseed (CONTEXT.md: Arrival; src/sim/royale/grace.ts):
// a champion just come down (a drop-in's Arrival, a Respawn return) that
// nothing can touch yet stands in a soft shimmer, a pale veil of light
// around its body and a ring at its feet, pulsing, fading through its last
// half second, gone the moment the Grace ends (its own first attack or
// cast). A Grace first seen raises a puff of dust where the champion
// stands (PlanetMarks plays it). Mounted by PlanetMarks, which hands it the
// snapshot's Graces and how to stand a mark on the ground; drawn where the
// renderer draws the champion when the stage tells it, else eased toward
// where the last snapshot put it.

import * as THREE from 'three';
import type { GraceNote } from '../net/royale_client';
import type { Vec3 } from '../sim/geo';
import { ARRIVAL_GRACE_S } from '../sim/royale/grace';

// At most this many shimmers at once (a few seats come back each second).
export const MAX_GRACES = 12;
// The veil's look: its width and height, meters, its color, its pulse.
const VEIL_R = 1.15;
const VEIL_H = 2.8;
const COLOR = 0xcfefff;
const PULSE_HZ = 1.6;
// The last stretch of a Grace, seconds, through which the shimmer fades.
export const FADE_S = 0.5;
// How fast the drawn point catches up with the snapshot's, per second.
const EASE = 14;

// The shimmer's opacity at `time` (the match's clock) for a Grace running
// out at `until`, `nowMs` the frame's clock for the pulse: a soft pulse
// between 0.25 and 0.45, faded out through the last FADE_S; 0 once over.
export function shimmerOpacity(until: number, time: number, nowMs: number): number {
  const left = until - time;
  if (left <= 0) return 0;
  const pulse = 0.35 + 0.1 * Math.sin((nowMs / 1000) * PULSE_HZ * 2 * Math.PI);
  return pulse * Math.min(1, left / FADE_S);
}

// How young a Grace first seen must be, seconds since it began, to raise
// the dust: a champion just come down, not one walking into sight graced.
export const DUST_WITHIN_S = 0.6;

// The Graces seen for the first time this frame and just begun at `time`,
// by unit id: what raises the dust. `seen` is updated to the frame's.
export function freshGraces(
  seen: Set<number>,
  graces: readonly GraceNote[],
  time: number,
): GraceNote[] {
  const now = new Set(graces.map((g) => g.unitId));
  const fresh = graces.filter(
    (g) => !seen.has(g.unitId) && g.until - time >= ARRIVAL_GRACE_S - DUST_WITHIN_S,
  );
  seen.clear();
  for (const id of now) seen.add(id);
  return fresh;
}

// Whether the own champion has just come down (the stage's landing, its
// thud and shake): its Grace, running out at `until` (null for none), seen
// this frame and not the last, at most DUST_WITHIN_S old at `time`.
export function ownGraceFresh(until: number | null, wasGraced: boolean, time: number): boolean {
  return until !== null && !wasGraced && until - time >= ARRIVAL_GRACE_S - DUST_WITHIN_S;
}

// A veil's light: brightest at the feet, gone at the head.
function veilTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

interface Shimmer {
  veil: THREE.Mesh;
  ring: THREE.Mesh;
  drawn: Vec3 | null;
}

export class PlanetGrace {
  readonly group = new THREE.Group();
  private readonly veilGeo: THREE.CylinderGeometry;
  private readonly ringGeo: THREE.RingGeometry;
  private readonly texture: THREE.Texture;
  private readonly pool: Shimmer[] = [];
  private readonly byUnit = new Map<number, Shimmer>();
  private readonly seen = new Set<number>();
  private lastNow = 0;

  constructor(
    // A mark standing on the ground at p, its up the normal there, lifted
    // and scaled (PlanetMarks.standing).
    private readonly standing: (p: Vec3, lift: number, scale: number) => THREE.Matrix4,
    // A Grace first seen: the dust at its feet.
    private readonly onFresh: (p: Vec3) => void,
  ) {
    this.group.name = 'planet-grace';
    this.texture = veilTexture();
    this.veilGeo = new THREE.CylinderGeometry(VEIL_R, VEIL_R * 0.85, VEIL_H, 20, 1, true);
    this.veilGeo.translate(0, VEIL_H / 2, 0);
    this.ringGeo = new THREE.RingGeometry(VEIL_R * 0.9, VEIL_R * 1.35, 32);
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  private take(): Shimmer {
    const free = this.pool.find((s) => !s.veil.visible);
    if (free) return free;
    const veilMat = new THREE.MeshBasicMaterial({
      color: COLOR,
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const s: Shimmer = {
      veil: new THREE.Mesh(this.veilGeo, veilMat),
      ring: new THREE.Mesh(this.ringGeo, ringMat),
      drawn: null,
    };
    for (const m of [s.veil, s.ring]) {
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
    }
    this.pool.push(s);
    return s;
  }

  private release(s: Shimmer): void {
    s.veil.visible = false;
    s.ring.visible = false;
    s.drawn = null;
  }

  // One frame: `graces` the snapshot's, `time` the match's clock, `nowMs`
  // the frame's; `unitAt` where the renderer draws a champion, when known.
  update(
    graces: readonly GraceNote[],
    time: number,
    nowMs: number,
    unitAt?: (unitId: number) => Vec3 | null,
  ): void {
    const dt = Math.min(0.1, Math.max(0, (nowMs - this.lastNow) / 1000));
    this.lastNow = nowMs;
    for (const g of freshGraces(this.seen, graces, time)) {
      this.onFresh(unitAt?.(g.unitId) ?? { x: g.at[0], y: g.at[1], z: g.at[2] });
    }
    const live = new Set<number>();
    for (const g of graces.slice(0, MAX_GRACES)) {
      const opacity = shimmerOpacity(g.until, time, nowMs);
      if (opacity <= 0) continue;
      live.add(g.unitId);
      let s = this.byUnit.get(g.unitId);
      if (!s) {
        s = this.take();
        this.byUnit.set(g.unitId, s);
      }
      const target = unitAt?.(g.unitId) ?? { x: g.at[0], y: g.at[1], z: g.at[2] };
      if (!s.drawn || unitAt) s.drawn = { ...target };
      else {
        const k = 1 - Math.exp(-EASE * dt);
        s.drawn = {
          x: s.drawn.x + (target.x - s.drawn.x) * k,
          y: s.drawn.y + (target.y - s.drawn.y) * k,
          z: s.drawn.z + (target.z - s.drawn.z) * k,
        };
      }
      s.veil.matrix.copy(this.standing(s.drawn, 0, 1));
      s.ring.matrix.copy(this.standing(s.drawn, 0.1, 1));
      (s.veil.material as THREE.MeshBasicMaterial).opacity = opacity;
      (s.ring.material as THREE.MeshBasicMaterial).opacity = opacity * 1.4;
      s.veil.visible = true;
      s.ring.visible = true;
    }
    for (const [id, s] of [...this.byUnit]) {
      if (live.has(id)) continue;
      this.release(s);
      this.byUnit.delete(id);
    }
  }

  dispose(): void {
    for (const s of this.pool) {
      this.group.remove(s.veil, s.ring);
      (s.veil.material as THREE.Material).dispose();
      (s.ring.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
    this.byUnit.clear();
    this.veilGeo.dispose();
    this.ringGeo.dispose();
    this.texture.dispose();
  }
}
