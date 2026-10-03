// The columns of light that stand on the Wanderseed for what everyone
// should find (CONTEXT.md: Seedfall, Rising, Wrath, Lodestar): a registry
// of instanced column kinds, one draw per kind, that the features add to.
// A Beacon is the crossroads' own light (planet_marks.ts), not one of these.
// Mounted by PlanetMarks, which hands it the pillars of the frame. The
// Seedfall's kind stands here (the loud moments): a pale gold column sixty
// meters tall over where the seed falls, a ring on the ground closing as
// the landing nears, and the column brighter once it has landed. The
// Rising, the Wrath and the Lodestar add their kinds in tranche 2.

import * as THREE from 'three';
import type { Vec3 } from '../sim/geo';
import type { PlanetGround } from './planet_terrain';

export type PillarKind = 'seedfall' | 'rising' | 'wrath' | 'lodestar';

// One column this frame: its kind, where it stands, and when what it
// marks happens (a landing, a rise), for a countdown ring; `lit` once it
// has happened.
export interface Pillar {
  kind: PillarKind;
  at: Vec3;
  until?: number;
  lit?: boolean;
}

// How a kind looks: its color, height and width, and the countdown's
// length in seconds (the ring is widest that long before).
interface KindLook {
  color: number;
  height: number;
  width: number;
  countdown: number;
}

const LOOKS: Partial<Record<PillarKind, KindLook>> = {
  seedfall: { color: 0xffcf6a, height: 60, width: 1.2, countdown: 20 },
};

// At most this many columns of a kind (five Seedfalls a match).
const MAX_PER_KIND = 8;
// The countdown ring's radius at its widest, meters.
const RING_M = 7;

const UP = new THREE.Vector3(0, 1, 0);

// A column's light: bright at its foot, gone at its top.
function columnTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

interface KindDraw {
  look: KindLook;
  columns: THREE.InstancedMesh;
  columnMat: THREE.MeshBasicMaterial;
  rings: THREE.InstancedMesh;
  ringMat: THREE.MeshBasicMaterial;
}

export class PlanetPillars {
  readonly group = new THREE.Group();
  private shown: readonly Pillar[] = [];
  private readonly kinds = new Map<PillarKind, KindDraw>();
  private readonly owned: { dispose(): void }[] = [];

  constructor(
    readonly ground: PlanetGround,
    readonly radius: number,
  ) {
    this.group.name = 'planet-pillars';
    const texture = columnTexture();
    this.owned.push(texture);
    for (const [kind, look] of Object.entries(LOOKS) as [PillarKind, KindLook][]) {
      const beam = new THREE.CylinderGeometry(
        look.width,
        look.width * 0.6,
        look.height,
        14,
        1,
        true,
      );
      beam.translate(0, look.height / 2, 0);
      const columnMat = new THREE.MeshBasicMaterial({
        color: look.color,
        map: texture,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        fog: false,
      });
      const columns = new THREE.InstancedMesh(beam, columnMat, MAX_PER_KIND);
      const ring = new THREE.RingGeometry(0.86, 1, 48);
      ring.rotateX(-Math.PI / 2);
      ring.translate(0, 0.15, 0);
      const ringMat = new THREE.MeshBasicMaterial({
        color: look.color,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      // Two rings a column: the closing one and the still one it closes on.
      const rings = new THREE.InstancedMesh(ring, ringMat, MAX_PER_KIND * 2);
      for (const m of [columns, rings]) {
        m.count = 0;
        m.frustumCulled = false;
        this.group.add(m);
      }
      this.kinds.set(kind, { look, columns, columnMat, rings, ringMat });
      this.owned.push(beam, columnMat, ring, ringMat);
    }
  }

  // A sphere point on the ground, lifted along its normal.
  private point(p: Vec3, lift: number): THREE.Vector3 {
    const r = Math.hypot(p.x, p.y, p.z) || 1;
    const k = (this.radius + this.ground.heightAt(p) + lift) / r;
    return new THREE.Vector3(p.x * k, p.y * k, p.z * k);
  }

  private standing(p: Vec3, scale: THREE.Vector3): THREE.Matrix4 {
    const n = new THREE.Vector3(p.x, p.y, p.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, n);
    return new THREE.Matrix4().compose(this.point(p, 0), q, scale);
  }

  // The columns to stand this frame, `time` the match's clock for the
  // countdown rings and `nowMs` the wall's for their shimmer.
  setPillars(pillars: readonly Pillar[], time = 0, nowMs = 0): void {
    this.shown = pillars;
    const t = nowMs / 1000;
    for (const [kind, draw] of this.kinds) {
      const mine = pillars.filter((p) => p.kind === kind).slice(0, MAX_PER_KIND);
      let rings = 0;
      for (const [i, p] of mine.entries()) {
        // Lit, the column swells and burns brighter; called, it breathes.
        const swell = p.lit ? 1.4 : 1 + 0.06 * Math.sin(t * 3 + i);
        draw.columns.setMatrixAt(i, this.standing(p.at, new THREE.Vector3(swell, 1, swell)));
        if (p.until !== undefined && !p.lit) {
          const left = Math.max(0, Math.min(1, (p.until - time) / draw.look.countdown));
          const r = RING_M * (0.12 + 0.88 * left);
          draw.rings.setMatrixAt(rings++, this.standing(p.at, new THREE.Vector3(r, 1, r)));
          const outer = RING_M * 0.12;
          draw.rings.setMatrixAt(rings++, this.standing(p.at, new THREE.Vector3(outer, 1, outer)));
        }
      }
      draw.columns.count = mine.length;
      draw.rings.count = rings;
      draw.columns.instanceMatrix.needsUpdate = true;
      draw.rings.instanceMatrix.needsUpdate = true;
      const lit = mine.some((p) => p.lit);
      draw.columnMat.opacity = (lit ? 0.42 : 0.28) + 0.06 * Math.sin(t * 2.2);
      draw.ringMat.opacity = 0.6 + 0.3 * Math.sin(t * 6);
    }
  }

  // How many columns stand now.
  get count(): number {
    return this.shown.length;
  }

  dispose(): void {
    this.shown = [];
    for (const o of this.owned) o.dispose();
  }
}
