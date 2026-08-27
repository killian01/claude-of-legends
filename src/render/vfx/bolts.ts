// Pooled jagged energy bolts: midpoint-displaced polylines extruded into
// thin camera-facing ribbons, regenerated every few frames so they flicker
// like live current. Geometry buffers are allocated once per slot and
// rewritten in place.

import * as THREE from 'three';

const POOL = 6;
// Midpoint passes: 3 passes on a 2-point seed gives 9 points.
const PASSES = 3;
const MAX_POINTS = 2 ** PASSES + 1;
const FLICKER_MS = 55;

interface BoltSlot {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  geo: THREE.BufferGeometry;
  pos: THREE.BufferAttribute;
  from: THREE.Vector3;
  to: THREE.Vector3;
  width: number;
  jag: number;
  bornAt: number;
  duration: number;
  nextFlickAt: number;
  peak: number;
  active: boolean;
}

const dir = new THREE.Vector3();
const side = new THREE.Vector3();
const tmp = new THREE.Vector3();
const pts: THREE.Vector3[] = [];
for (let i = 0; i < MAX_POINTS; i++) pts.push(new THREE.Vector3());

export class LightningBolts {
  private readonly slots: BoltSlot[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pos);
      const index: number[] = [];
      for (let p = 0; p < MAX_POINTS - 1; p++) {
        const a = p * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geo.setIndex(index);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      mat.toneMapped = false;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.slots.push({
        mesh,
        mat,
        geo,
        pos,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        width: 0.1,
        jag: 0.2,
        bornAt: 0,
        duration: 1,
        nextFlickAt: 0,
        peak: 0.9,
        active: false,
      });
    }
  }

  spawn(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: number,
    durationMs: number,
    width = 0.12,
    jag = 0.2,
  ): void {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) slot = this.slots.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
    slot.active = true;
    slot.from.copy(from);
    slot.to.copy(to);
    slot.width = width;
    slot.jag = jag;
    slot.bornAt = performance.now();
    slot.duration = durationMs;
    slot.nextFlickAt = 0;
    slot.mesh.visible = true;
    slot.mat.color.set(color);
  }

  private rebuild(s: BoltSlot, camDir: THREE.Vector3): void {
    dir.subVectors(s.to, s.from);
    const len = dir.length();
    if (len < 0.01) return;
    dir.divideScalar(len);
    // Displacement axis: perpendicular to both the bolt and the view, so
    // the jitter always shows its width to the camera.
    side.crossVectors(dir, camDir);
    if (side.lengthSq() < 0.001) side.set(0, 1, 0);
    side.normalize();

    pts[0]!.copy(s.from);
    pts[1]!.copy(s.to);
    let count = 2;
    let amp = len * s.jag;
    for (let pass = 0; pass < PASSES; pass++) {
      for (let i = count - 1; i > 0; i--) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        tmp
          .addVectors(a, b)
          .multiplyScalar(0.5)
          .addScaledVector(side, (Math.random() * 2 - 1) * amp);
        // Shift the tail up to make room for the midpoint.
        for (let j = count; j > i; j--) pts[j]!.copy(pts[j - 1]!);
        pts[i]!.copy(tmp);
        count++;
      }
      amp *= 0.5;
    }

    const arr = s.pos.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const p = pts[i]!;
      // Taper toward both ends.
      const k = Math.sin((i / (count - 1)) * Math.PI) * 0.7 + 0.3;
      const w = s.width * k;
      arr[i * 6] = p.x + side.x * w;
      arr[i * 6 + 1] = p.y + side.y * w;
      arr[i * 6 + 2] = p.z + side.z * w;
      arr[i * 6 + 3] = p.x - side.x * w;
      arr[i * 6 + 4] = p.y - side.y * w;
      arr[i * 6 + 5] = p.z - side.z * w;
    }
    s.pos.needsUpdate = true;
    s.geo.setDrawRange(0, (count - 1) * 6);
  }

  update(now: number, camDir: THREE.Vector3): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      const t = (now - s.bornAt) / s.duration;
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      if (now >= s.nextFlickAt) {
        s.nextFlickAt = now + FLICKER_MS;
        this.rebuild(s, camDir);
      }
      s.mat.opacity = s.peak * (1 - t) ** 1.3 * (0.75 + Math.random() * 0.25);
    }
  }
}
