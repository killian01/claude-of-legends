// The tower's reach drawn on the ground (src/render/tower_reach.ts decides
// which towers and how strongly): a ring where the fire starts and a soft
// band just inside it, draped over the terrain so a slope never swallows
// it, in the tower's own amber, brightening toward its ivory core on each
// shot at the viewer's champion. One pair of meshes per tower, built the
// first time it shows and kept hidden after. Presentation only.

import * as THREE from 'three';
import type { GroundHeight } from '../terrain';
import { type ReachSelf, type ReachTower, reachRings } from '../tower_reach';
import { CORE, GOLD } from '../tower_shot';
import { basicMat } from './shapes';

const SEGMENTS = 128;
const LIFT = 0.13;
const RING_WIDTH = 0.26;
const BAND_WIDTH = 1.6;
const RING_OPACITY = 0.6;
const BAND_OPACITY = 0.12;
const FLASH_RING_OPACITY = 0.35;
const FLASH_BAND_OPACITY = 0.2;

interface Drawn {
  radius: number;
  group: THREE.Group;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  band: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

// A flat annulus around (cx, cz) whose every vertex sits on the ground.
function drapedBand(
  cx: number,
  cz: number,
  rIn: number,
  rOut: number,
  heightAt: GroundHeight,
): THREE.BufferGeometry {
  const pos = new Float32Array((SEGMENTS + 1) * 2 * 3);
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (let j = 0; j < 2; j++) {
      const r = j === 0 ? rIn : rOut;
      const x = cx + c * r;
      const z = cz + s * r;
      const k = (i * 2 + j) * 3;
      pos[k] = x;
      pos[k + 1] = heightAt(x, z) + LIFT;
      pos[k + 2] = z;
    }
    if (i < SEGMENTS) {
      const b = i * 2;
      index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  return geo;
}

export class TowerReachFx {
  private readonly drawn = new Map<number, Drawn>();
  private readonly shotAt = new Map<number, number>();
  private readonly gold = new THREE.Color(GOLD);
  private readonly core = new THREE.Color(CORE);

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly heightAt: GroundHeight,
  ) {}

  // A tower just fired at the viewer's own champion.
  noteShot(towerId: number, nowMs: number): void {
    this.shotAt.set(towerId, nowMs);
  }

  update(
    self: ReachSelf | null,
    at: { x: number; z: number } | null,
    units: Iterable<ReachTower>,
    nowMs: number,
  ): void {
    const rings = reachRings(self, at, units, this.shotAt, nowMs);
    const shown = new Set<number>();
    for (const r of rings) {
      shown.add(r.towerId);
      const d = this.drawnFor(r.towerId, r.x, r.z, r.radius);
      d.group.visible = true;
      d.ring.material.opacity = r.strength * RING_OPACITY + r.flash * FLASH_RING_OPACITY;
      d.band.material.opacity = r.strength * BAND_OPACITY + r.flash * FLASH_BAND_OPACITY;
      d.ring.material.color.copy(this.gold).lerp(this.core, r.flash);
    }
    for (const [id, d] of this.drawn) if (!shown.has(id)) d.group.visible = false;
  }

  private drawnFor(towerId: number, x: number, z: number, radius: number): Drawn {
    const had = this.drawn.get(towerId);
    if (had && Math.abs(had.radius - radius) < 0.01) return had;
    if (had) this.drop(towerId, had);
    const ring = new THREE.Mesh(
      drapedBand(x, z, radius - RING_WIDTH, radius, this.heightAt),
      basicMat(GOLD, RING_OPACITY),
    );
    const band = new THREE.Mesh(
      drapedBand(x, z, radius - RING_WIDTH - BAND_WIDTH, radius - RING_WIDTH, this.heightAt),
      basicMat(GOLD, BAND_OPACITY),
    );
    ring.renderOrder = 1;
    const group = new THREE.Group();
    group.add(band, ring);
    this.scene.add(group);
    const d: Drawn = { radius, group, ring, band };
    this.drawn.set(towerId, d);
    return d;
  }

  private drop(towerId: number, d: Drawn): void {
    this.scene.remove(d.group);
    for (const m of [d.ring, d.band]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.drawn.delete(towerId);
  }

  dispose(): void {
    for (const [id, d] of [...this.drawn]) this.drop(id, d);
    this.shotAt.clear();
  }
}
