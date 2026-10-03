// What the battle royale sets on the Wanderseed's ground (ADR 0031): the
// caches (glowing chests, the golden ones bigger and golden), the launch
// pads (gold discs with a faint arc to where they throw), the beacons of
// the crossroads, and during the drop the landing picks (the own one a
// tall light, everyone else's a dot). All of it lives on the planet, in
// sphere coordinates, turned with it under the chart and never bent: a few
// instanced draws whatever the count.

import * as THREE from 'three';
import type { SnapCache, SnapRoyale } from '../net/royale_wire';
import type { Vec3 } from '../sim/geo';
import type { PlanetGround } from './planet_terrain';

const MAX_CACHES = 320;
const MAX_PICKS = 64;

const UP = new THREE.Vector3(0, 1, 0);

// A column's light: bright at its foot, gone at its top.
function columnTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

export class PlanetMarks {
  readonly group = new THREE.Group();
  private readonly chests: THREE.InstancedMesh;
  private readonly lids: THREE.InstancedMesh;
  private readonly cacheGlow: THREE.Points;
  private readonly cacheGlowMat: THREE.PointsMaterial;
  private readonly beacons: THREE.InstancedMesh;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly padGlowMat: THREE.MeshBasicMaterial;
  private readonly pickBeam: THREE.Mesh;
  private readonly picks: THREE.Points;
  private readonly pickMat: THREE.PointsMaterial;
  private shownCaches: readonly SnapCache[] | null = null;
  private readonly owned: { dispose(): void }[] = [];

  constructor(
    private readonly ground: PlanetGround,
    private readonly radius: number,
  ) {
    this.group.name = 'planet-marks';
    const glow = glowTexture();
    this.owned.push(glow);

    // Caches: a chest body and its lid, instanced; a glow per cache.
    const body = new THREE.BoxGeometry(1.1, 0.62, 0.72);
    body.translate(0, 0.31, 0);
    const lid = new THREE.BoxGeometry(1.18, 0.24, 0.8);
    lid.translate(0, 0.72, 0);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a1a08 });
    const lidMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x604010 });
    this.chests = new THREE.InstancedMesh(body, bodyMat, MAX_CACHES);
    this.lids = new THREE.InstancedMesh(lid, lidMat, MAX_CACHES);
    for (const m of [this.chests, this.lids]) {
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CACHES * 3), 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_CACHES * 3), 3));
    glowGeo.setDrawRange(0, 0);
    this.cacheGlowMat = new THREE.PointsMaterial({
      size: 3.2,
      map: glow,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.cacheGlow = new THREE.Points(glowGeo, this.cacheGlowMat);
    this.cacheGlow.frustumCulled = false;
    this.group.add(this.cacheGlow);
    this.owned.push(body, lid, bodyMat, lidMat, glowGeo, this.cacheGlowMat);

    // Pads: a gold disc, a soft ring of light, the arc of the throw.
    const pads = ground.layout.pads;
    const disc = new THREE.CylinderGeometry(1.45, 1.6, 0.18, 28);
    disc.translate(0, 0.09, 0);
    const discMat = new THREE.MeshLambertMaterial({ color: 0xe8c062, emissive: 0x8a5a10 });
    const discs = new THREE.InstancedMesh(disc, discMat, Math.max(1, pads.length));
    const ring = new THREE.RingGeometry(1.6, 2.6, 36);
    ring.rotateX(-Math.PI / 2);
    ring.translate(0, 0.08, 0);
    this.padGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffc84a,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const rings = new THREE.InstancedMesh(ring, this.padGlowMat, Math.max(1, pads.length * 2));
    const arcPoints: number[] = [];
    const arcColors: number[] = [];
    let ringCount = 0;
    for (const [i, pad] of pads.entries()) {
      discs.setMatrixAt(i, this.standing(pad.at, 0.02, 1));
      rings.setMatrixAt(ringCount++, this.standing(pad.at, 0.02, 1));
      rings.setMatrixAt(ringCount++, this.standing(pad.to, 0.04, 0.7));
      const steps = 40;
      let prev: THREE.Vector3 | null = null;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p = this.slerp(pad.at, pad.to, t);
        const lift = 4 * 9 * t * (1 - t) + 0.3;
        const w = this.point(p, lift);
        if (prev) {
          arcPoints.push(prev.x, prev.y, prev.z, w.x, w.y, w.z);
          // Bright at the pad, fading toward the landing.
          const a0 = 0.9 - 0.7 * ((s - 1) / steps);
          const a1 = 0.9 - 0.7 * t;
          arcColors.push(1 * a0, 0.78 * a0, 0.32 * a0, 1 * a1, 0.78 * a1, 0.32 * a1);
        }
        prev = w;
      }
    }
    discs.count = pads.length;
    rings.count = ringCount;
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcPoints, 3));
    arcGeo.setAttribute('color', new THREE.Float32BufferAttribute(arcColors, 3));
    const arcMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const arcs = new THREE.LineSegments(arcGeo, arcMat);
    for (const o of [discs, rings, arcs]) {
      o.frustumCulled = false;
      this.group.add(o);
    }
    discs.receiveShadow = true;
    this.owned.push(disc, discMat, ring, this.padGlowMat, arcGeo, arcMat);

    // The crossroads' beacons: tall faint columns of light.
    const beam = new THREE.CylinderGeometry(0.5, 0.28, 20, 12, 1, true);
    beam.translate(0, 10, 0);
    const column = columnTexture();
    this.owned.push(column);
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffd889,
      map: column,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const crossroads = ground.layout.crossroads;
    this.beacons = new THREE.InstancedMesh(beam, this.beaconMat, Math.max(1, crossroads.length));
    for (const [i, c] of crossroads.entries()) this.beacons.setMatrixAt(i, this.standing(c, 0, 1));
    this.beacons.count = crossroads.length;
    this.beacons.frustumCulled = false;
    this.group.add(this.beacons);
    this.owned.push(beam, this.beaconMat);

    // The drop: the own pick a tall bright light, the others' dots.
    const pickGeo = new THREE.CylinderGeometry(0.9, 0.9, 60, 16, 1, true);
    pickGeo.translate(0, 30, 0);
    const pickBeamMat = new THREE.MeshBasicMaterial({
      color: 0x9fe8ff,
      map: column,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.pickBeam = new THREE.Mesh(pickGeo, pickBeamMat);
    this.pickBeam.visible = false;
    this.group.add(this.pickBeam);
    const picksGeo = new THREE.BufferGeometry();
    picksGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PICKS * 3), 3));
    picksGeo.setDrawRange(0, 0);
    this.pickMat = new THREE.PointsMaterial({
      size: 7,
      map: glow,
      color: 0xffe6b0,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.picks = new THREE.Points(picksGeo, this.pickMat);
    this.picks.frustumCulled = false;
    this.group.add(this.picks);
    this.owned.push(pickGeo, pickBeamMat, picksGeo, this.pickMat);
  }

  // A sphere point on the ground, lifted along its normal.
  private point(p: Vec3, lift: number): THREE.Vector3 {
    const r = Math.hypot(p.x, p.y, p.z);
    const k = (this.radius + this.ground.heightAt(p) + lift) / r;
    return new THREE.Vector3(p.x * k, p.y * k, p.z * k);
  }

  // A mark standing on the ground at p, its up the normal there.
  private standing(p: Vec3, lift: number, scale: number): THREE.Matrix4 {
    const n = new THREE.Vector3(p.x, p.y, p.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, n);
    return new THREE.Matrix4().compose(
      this.point(p, lift),
      q,
      new THREE.Vector3(scale, scale, scale),
    );
  }

  private slerp(a: Vec3, b: Vec3, t: number): Vec3 {
    const va = new THREE.Vector3(a.x, a.y, a.z).normalize();
    const vb = new THREE.Vector3(b.x, b.y, b.z).normalize();
    const angle = va.angleTo(vb);
    if (angle < 1e-6) return a;
    const s = Math.sin(angle);
    const out = va
      .multiplyScalar(Math.sin((1 - t) * angle) / s)
      .add(vb.multiplyScalar(Math.sin(t * angle) / s))
      .multiplyScalar(this.radius);
    return { x: out.x, y: out.y, z: out.z };
  }

  private placeCaches(caches: readonly SnapCache[]): void {
    const colors = this.cacheGlow.geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = this.cacheGlow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const wood = new THREE.Color(0x9a6a3c);
    const gold = new THREE.Color(0xf2c640);
    const trim = new THREE.Color(0xd8b060);
    const n = Math.min(MAX_CACHES, caches.length);
    for (let i = 0; i < n; i++) {
      const [, x, y, z, golden] = caches[i]!;
      const p = { x, y, z };
      const s = golden ? 1.45 : 1;
      const m = this.standing(p, 0, s);
      this.chests.setMatrixAt(i, m);
      this.lids.setMatrixAt(i, m);
      this.chests.setColorAt(i, golden ? gold : wood);
      this.lids.setColorAt(i, golden ? new THREE.Color(0xfff0a0) : trim);
      const g = this.point(p, golden ? 1.5 : 1.0);
      positions.setXYZ(i, g.x, g.y, g.z);
      if (golden) colors.setXYZ(i, 1, 0.78, 0.25);
      else colors.setXYZ(i, 0.55, 0.75, 1);
    }
    this.chests.count = n;
    this.lids.count = n;
    this.chests.instanceMatrix.needsUpdate = true;
    this.lids.instanceMatrix.needsUpdate = true;
    if (this.chests.instanceColor) this.chests.instanceColor.needsUpdate = true;
    if (this.lids.instanceColor) this.lids.instanceColor.needsUpdate = true;
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    this.cacheGlow.geometry.setDrawRange(0, n);
  }

  update(now: number, caches: readonly SnapCache[], royale: SnapRoyale | null, dropping: boolean): void {
    if (caches !== this.shownCaches) {
      this.shownCaches = caches;
      this.placeCaches(caches);
    }
    const t = now / 1000;
    this.cacheGlowMat.size = 3 + 0.5 * Math.sin(t * 2.4);
    this.cacheGlowMat.opacity = 0.75 + 0.2 * Math.sin(t * 2.4);
    this.beaconMat.opacity = 0.42 + 0.12 * Math.sin(t * 1.3);
    this.padGlowMat.opacity = 0.4 + 0.2 * Math.sin(t * 3.1);
    const own = dropping ? royale?.drop : undefined;
    this.pickBeam.visible = own !== undefined;
    if (own) {
      this.pickBeam.matrix.copy(this.standing({ x: own[0], y: own[1], z: own[2] }, 0, 1));
      this.pickBeam.matrix.decompose(this.pickBeam.position, this.pickBeam.quaternion, this.pickBeam.scale);
    }
    const others = dropping ? (royale?.picks ?? []) : [];
    const positions = this.picks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(MAX_PICKS, others.length);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = others[i]!;
      const g = this.point({ x, y, z }, 1.2);
      positions.setXYZ(i, g.x, g.y, g.z);
    }
    positions.needsUpdate = true;
    this.picks.geometry.setDrawRange(0, n);
    this.pickMat.size = 6.5 + 1.2 * Math.sin(t * 5);
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
  }
}
