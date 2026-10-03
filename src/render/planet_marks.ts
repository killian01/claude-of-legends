// What the battle royale sets on the Wanderseed's ground (ADR 0031): the
// caches (glowing chests, the golden ones bigger and golden, a Seedfall's
// biggest and white-gold), a cache's opening (it goes at once, its lid
// flips in gold sparks under a short column, or a red ring when an opening
// is broken, render/royale_cues.ts), the launch
// pads (gold discs with a faint arc to where they throw), the beacons of
// the crossroads, and during the drop the landing picks (the own one a
// tall light, everyone else's a dot); and the pillars of light over what
// everyone should find (planet_pillars.ts). All of it lives on the planet, in
// sphere coordinates, turned with it under the chart and never bent: a few
// instanced draws whatever the count.

import * as THREE from 'three';
import type { SnapCache, SnapRoyale } from '../net/royale_wire';
import type { Vec3 } from '../sim/geo';
import { type Pillar, PlanetPillars } from './planet_pillars';
import type { PlanetGround } from './planet_terrain';
import { onRoyaleCue, type RoyaleCue } from './royale_cues';

const MAX_CACHES = 320;
// A burst's life, and its sparks; at most this many bursts at once.
const BURST_MS = 1200;
const LID_MS = 380;
const SPARKS = 24;
const MAX_BURSTS = 4;
const CRACK_MS = 650;

// A cache's look by its kind on the wire (0 plain, 1 golden, 2 a
// Seedfall's): its size, its body and lid, its glow and the glow's lift.
interface CacheLook {
  scale: number;
  body: number;
  lid: number;
  glow: [number, number, number];
  lift: number;
}
const CACHE_LOOKS: readonly CacheLook[] = [
  { scale: 1, body: 0x9a6a3c, lid: 0xd8b060, glow: [0.55, 0.75, 1], lift: 1.0 },
  { scale: 1.45, body: 0xf2c640, lid: 0xfff0a0, glow: [1, 0.78, 0.25], lift: 1.5 },
  { scale: 1.8, body: 0xfff3c8, lid: 0xffffff, glow: [1, 0.95, 0.7], lift: 1.9 },
];

export function cacheLook(kind: number): CacheLook {
  return CACHE_LOOKS[kind] ?? CACHE_LOOKS[0]!;
}

// One cache opening as it plays: the lid flipping, the sparks, the column.
interface Burst {
  startMs: number;
  lid: THREE.Mesh;
  column: THREE.Mesh;
  sparks: THREE.Points;
  velocities: Float32Array;
  base: THREE.Vector3;
  normal: THREE.Vector3;
  // The lid's standing turn, before it swings.
  turn: THREE.Quaternion;
}

// A broken opening's red ring.
interface Crack {
  startMs: number;
  ring: THREE.Mesh;
}
const MAX_PICKS = 64;

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const SWING = new THREE.Quaternion();

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
  private readonly pillars: PlanetPillars;
  private readonly owned: { dispose(): void }[] = [];
  // Caches that opened before the list said so: hidden at once.
  private readonly hidden = new Set<number>();
  private readonly bursts: Burst[] = [];
  private readonly cracks: Crack[] = [];
  private readonly burstColumnGeo: THREE.CylinderGeometry;
  private readonly burstLidGeo: THREE.BoxGeometry;
  private readonly crackGeo: THREE.RingGeometry;
  private readonly sparkTexture: THREE.Texture;
  private readonly column: THREE.Texture;
  private readonly stopCues: () => void;
  private lastNow = 0;

  constructor(
    private readonly ground: PlanetGround,
    private readonly radius: number,
  ) {
    this.group.name = 'planet-marks';
    this.pillars = new PlanetPillars(ground, radius);
    this.group.add(this.pillars.group);
    this.owned.push(this.pillars);
    const glow = glowTexture();
    this.owned.push(glow);
    this.sparkTexture = glow;
    this.column = columnTexture();
    this.owned.push(this.column);
    this.burstColumnGeo = new THREE.CylinderGeometry(0.7, 0.35, 1, 12, 1, true);
    this.burstColumnGeo.translate(0, 0.5, 0);
    this.burstLidGeo = new THREE.BoxGeometry(1.18, 0.24, 0.8);
    // Hinged at its back edge.
    this.burstLidGeo.translate(0, 0.12, 0.4);
    this.crackGeo = new THREE.RingGeometry(0.8, 1, 40);
    this.crackGeo.rotateX(-Math.PI / 2);
    this.owned.push(this.burstColumnGeo, this.burstLidGeo, this.crackGeo);
    this.stopCues = onRoyaleCue((cue) => this.onCue(cue));

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
    glowGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAX_CACHES * 3), 3),
    );
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
    // The shipped model carries its own pads and beacons (docs/planet.md):
    // only the stand-in needs the discs and columns drawn here.
    discs.count = ground.placeholder ? pads.length : 0;
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
    const beam = new THREE.CylinderGeometry(0.22, 0.12, 9, 10, 1, true);
    beam.translate(0, 4.5, 0);
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
    this.beacons.count = ground.placeholder ? crossroads.length : 0;
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
    picksGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAX_PICKS * 3), 3),
    );
    picksGeo.setDrawRange(0, 0);
    this.pickMat = new THREE.PointsMaterial({
      size: 16,
      sizeAttenuation: false,
      map: glow,
      color: 0xffb85a,
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
    // A cache the list no longer carries needs hiding no more.
    const listed = new Set(caches.map((c) => c[0]));
    for (const id of this.hidden) if (!listed.has(id)) this.hidden.delete(id);
    let n = 0;
    for (const c of caches) {
      if (n >= MAX_CACHES) break;
      const [id, x, y, z, kind] = c;
      if (this.hidden.has(id)) continue;
      const look = cacheLook(kind);
      const p = { x, y, z };
      const m = this.standing(p, 0, look.scale);
      this.chests.setMatrixAt(n, m);
      this.lids.setMatrixAt(n, m);
      this.chests.setColorAt(n, new THREE.Color(look.body));
      this.lids.setColorAt(n, new THREE.Color(look.lid));
      const g = this.point(p, look.lift);
      positions.setXYZ(n, g.x, g.y, g.z);
      colors.setXYZ(n, look.glow[0], look.glow[1], look.glow[2]);
      n++;
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

  // A cue from the HUD (render/royale_cues.ts): a cache opened, or an
  // opening broken.
  private onCue(cue: RoyaleCue): void {
    if (cue.kind === 'cache_open') this.openNow(cue.cacheId);
    else if (cue.kind === 'cache_crack') this.crackAt(cue.cacheId);
  }

  private cacheById(cacheId: number): SnapCache | undefined {
    return this.shownCaches?.find((c) => c[0] === cacheId);
  }

  // A cache opened: it goes at once, before the next list says so, and
  // bursts where it stood.
  openNow(cacheId: number): void {
    const c = this.cacheById(cacheId);
    if (!c || this.hidden.has(cacheId)) return;
    this.hidden.add(cacheId);
    if (this.shownCaches) this.placeCaches(this.shownCaches);
    this.burst({ x: c[1], y: c[2], z: c[3] }, c[4]);
  }

  // The lid flips back, gold sparks fly, a column stands for 1.2 s: twice
  // as tall and gold for a golden cache and a Seedfall's.
  private burst(p: Vec3, kind: number): void {
    while (this.bursts.length >= MAX_BURSTS) this.endBurst(this.bursts.shift()!);
    const look = cacheLook(kind);
    const rich = kind > 0;
    const normal = new THREE.Vector3(p.x, p.y, p.z).normalize();
    const base = this.point(p, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, normal);

    const lidMat = new THREE.MeshLambertMaterial({
      color: look.lid,
      emissive: rich ? 0x806020 : 0x604010,
      transparent: true,
    });
    const lid = new THREE.Mesh(this.burstLidGeo, lidMat);
    lid.position.copy(this.point(p, 0.6 * look.scale));
    lid.quaternion.copy(q);
    lid.scale.setScalar(look.scale);
    this.group.add(lid);

    const columnMat = new THREE.MeshBasicMaterial({
      color: rich ? 0xffd34a : 0xfff0c0,
      map: this.column,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const column = new THREE.Mesh(this.burstColumnGeo, columnMat);
    column.position.copy(base);
    column.quaternion.copy(q);
    column.userData.h = rich ? 12 : 6;
    column.scale.set(look.scale, 0.05, look.scale);
    this.group.add(column);

    const sparkGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(SPARKS * 3);
    const vel = new Float32Array(SPARKS * 3);
    const start = this.point(p, 0.7);
    const a = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const b = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    for (let i = 0; i < SPARKS; i++) {
      pos[i * 3] = start.x;
      pos[i * 3 + 1] = start.y;
      pos[i * 3 + 2] = start.z;
      const ang = Math.random() * Math.PI * 2;
      const out = 1.2 + Math.random() * 2.2;
      const up = 3.5 + Math.random() * 4.5;
      const v = normal
        .clone()
        .multiplyScalar(up)
        .addScaledVector(a, Math.cos(ang) * out)
        .addScaledVector(b, Math.sin(ang) * out);
      vel[i * 3] = v.x;
      vel[i * 3 + 1] = v.y;
      vel[i * 3 + 2] = v.z;
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sparkMat = new THREE.PointsMaterial({
      size: rich ? 0.75 : 0.55,
      map: this.sparkTexture,
      color: 0xffd060,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.frustumCulled = false;
    this.group.add(sparks);

    this.bursts.push({
      startMs: this.lastNow,
      lid,
      column,
      sparks,
      velocities: vel,
      base,
      normal,
      turn: q.clone(),
    });
  }

  private endBurst(b: Burst): void {
    for (const o of [b.lid, b.column, b.sparks]) {
      this.group.remove(o);
      (o.material as THREE.Material).dispose();
    }
    b.sparks.geometry.dispose();
  }

  // A broken opening: a red ring swells and fades at the cache.
  crackAt(cacheId: number): void {
    const c = this.cacheById(cacheId);
    if (!c) return;
    const p = { x: c[1], y: c[2], z: c[3] };
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff3a2a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const ring = new THREE.Mesh(this.crackGeo, mat);
    ring.matrixAutoUpdate = false;
    ring.matrix.copy(this.standing(p, 0.12, 1));
    this.group.add(ring);
    this.cracks.push({ startMs: this.lastNow, ring });
  }

  // The bursts and the cracks, every frame.
  private stepEffects(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      const age = now - b.startMs;
      if (age >= BURST_MS) {
        this.endBurst(b);
        this.bursts.splice(i, 1);
        continue;
      }
      const k = age / BURST_MS;
      // The lid swings back on its hinge, then fades.
      const swing = Math.min(1, age / LID_MS);
      const open = -1.9 * (1 - (1 - swing) * (1 - swing));
      b.lid.quaternion.copy(b.turn).multiply(SWING.setFromAxisAngle(X_AXIS, open));
      (b.lid.material as THREE.MeshLambertMaterial).opacity = 1 - k * k;
      // The column rises fast and fades.
      const rise = Math.min(1, age / 220);
      b.column.scale.y = Math.max(0.05, (b.column.userData.h as number) * rise);
      (b.column.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      // The sparks fly and fall back toward the planet.
      const pos = b.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let j = 0; j < SPARKS; j++) {
        const o = j * 3;
        b.velocities[o] = (b.velocities[o] ?? 0) - b.normal.x * 9 * dt;
        b.velocities[o + 1] = (b.velocities[o + 1] ?? 0) - b.normal.y * 9 * dt;
        b.velocities[o + 2] = (b.velocities[o + 2] ?? 0) - b.normal.z * 9 * dt;
        arr[o] = (arr[o] ?? 0) + (b.velocities[o] ?? 0) * dt;
        arr[o + 1] = (arr[o + 1] ?? 0) + (b.velocities[o + 1] ?? 0) * dt;
        arr[o + 2] = (arr[o + 2] ?? 0) + (b.velocities[o + 2] ?? 0) * dt;
      }
      pos.needsUpdate = true;
      (b.sparks.material as THREE.PointsMaterial).opacity = 1 - k;
    }
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i]!;
      const age = now - c.startMs;
      if (age >= CRACK_MS) {
        this.group.remove(c.ring);
        (c.ring.material as THREE.Material).dispose();
        this.cracks.splice(i, 1);
        continue;
      }
      const k = age / CRACK_MS;
      const r = 0.8 + 1.8 * k;
      const m = c.ring.matrix.clone();
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      m.decompose(pos, q, new THREE.Vector3());
      c.ring.matrix.compose(pos, q, new THREE.Vector3(r, 1, r));
      (c.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
  }

  // The pillars of the frame, from the mode's blocks: each Seedfall not
  // yet opened, counting down to its landing and lit once landed.
  static pillarsOf(royale: SnapRoyale | null): Pillar[] {
    const out: Pillar[] = [];
    if (royale?.st !== 'play') return out;
    for (const s of royale.sf ?? []) {
      out.push({
        kind: 'seedfall',
        at: { x: s[1], y: s[2], z: s[3] },
        until: s[4],
        lit: s[5] === 1,
      });
    }
    return out;
  }

  update(
    now: number,
    caches: readonly SnapCache[],
    royale: SnapRoyale | null,
    dropping: boolean,
    time = 0,
  ): void {
    if (caches !== this.shownCaches) {
      this.shownCaches = caches;
      this.placeCaches(caches);
    }
    this.stepEffects(now);
    const t = now / 1000;
    this.cacheGlowMat.size = 3 + 0.5 * Math.sin(t * 2.4);
    this.cacheGlowMat.opacity = 0.75 + 0.2 * Math.sin(t * 2.4);
    this.beaconMat.opacity = 0.42 + 0.12 * Math.sin(t * 1.3);
    this.padGlowMat.opacity = 0.4 + 0.2 * Math.sin(t * 3.1);
    const own = dropping ? royale?.drop : undefined;
    this.pickBeam.visible = own !== undefined;
    if (own) {
      this.pickBeam.matrix.copy(this.standing({ x: own[0], y: own[1], z: own[2] }, 0, 1));
      this.pickBeam.matrix.decompose(
        this.pickBeam.position,
        this.pickBeam.quaternion,
        this.pickBeam.scale,
      );
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
    this.pickMat.size = 15 + 3 * Math.sin(t * 5);
    this.pillars.setPillars(PlanetMarks.pillarsOf(royale), time, now);
  }

  dispose(): void {
    this.stopCues();
    for (const b of this.bursts) this.endBurst(b);
    this.bursts.length = 0;
    for (const c of this.cracks) (c.ring.material as THREE.Material).dispose();
    this.cracks.length = 0;
    for (const o of this.owned) o.dispose();
  }
}
