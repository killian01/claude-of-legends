// Pooled physical debris: one InstancedMesh of low-poly chunks thrown by
// impacts. Chunks arc under gravity, bounce once, then rest and sink. Used
// for rock bursts, thorn eruptions, and meteor shrapnel (tinted per spawn).

import * as THREE from 'three';

const CAP = 64;
const GRAVITY = 26;

interface Chunk {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotX: number;
  rotY: number;
  rvX: number;
  rvY: number;
  size: number;
  age: number;
  life: number;
  bounced: boolean;
}

const mtx = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const tmpColor = new THREE.Color();

export class DebrisField {
  private readonly mesh: THREE.InstancedMesh;
  private readonly chunks: Chunk[] = [];
  private count = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    for (let i = 0; i < CAP; i++) {
      this.chunks.push({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rotX: 0,
        rotY: 0,
        rvX: 0,
        rvY: 0,
        size: 0.2,
        age: 0,
        life: 1,
        bounced: false,
      });
    }
  }

  burst(
    x: number,
    z: number,
    color: number,
    count: number,
    opts?: { speed?: number; up?: number; size?: number; life?: number },
  ): void {
    const speed = opts?.speed ?? 7;
    const up = opts?.up ?? 9;
    const size = opts?.size ?? 0.22;
    const life = opts?.life ?? 1.4;
    tmpColor.set(color);
    for (let i = 0; i < count; i++) {
      if (this.count >= CAP) break;
      const idx = this.count++;
      const c = this.chunks[idx]!;
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      c.x = x;
      c.y = 0.3;
      c.z = z;
      c.vx = Math.cos(a) * v;
      c.vz = Math.sin(a) * v;
      c.vy = up * (0.5 + Math.random() * 0.5);
      c.rotX = Math.random() * Math.PI;
      c.rotY = Math.random() * Math.PI;
      c.rvX = (Math.random() * 2 - 1) * 9;
      c.rvY = (Math.random() * 2 - 1) * 9;
      c.size = size * (0.6 + Math.random() * 0.8);
      c.age = 0;
      c.life = life * (0.7 + Math.random() * 0.5);
      c.bounced = false;
      this.mesh.setColorAt(idx, tmpColor);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dtS: number): void {
    let i = 0;
    while (i < this.count) {
      const c = this.chunks[i]!;
      c.age += dtS;
      if (c.age >= c.life) {
        this.count--;
        const last = this.chunks[this.count]!;
        this.chunks[this.count] = c;
        this.chunks[i] = last;
        // Colors ride the instance slot: re-copy the swapped-in chunk's
        // color down into the freed index.
        if (this.mesh.instanceColor) {
          this.mesh.getColorAt(this.count, tmpColor);
          this.mesh.setColorAt(i, tmpColor);
          this.mesh.instanceColor.needsUpdate = true;
        }
        continue;
      }
      c.vy -= GRAVITY * dtS;
      c.x += c.vx * dtS;
      c.y += c.vy * dtS;
      c.z += c.vz * dtS;
      c.rotX += c.rvX * dtS;
      c.rotY += c.rvY * dtS;
      if (c.y < c.size * 0.5) {
        if (!c.bounced && c.vy < 0) {
          c.bounced = true;
          c.vy = -c.vy * 0.3;
          c.vx *= 0.55;
          c.vz *= 0.55;
          c.rvX *= 0.4;
          c.rvY *= 0.4;
        } else {
          c.y = c.size * 0.5;
          c.vx = 0;
          c.vz = 0;
          c.vy = 0;
        }
      }
      i++;
    }
    for (let idx = 0; idx < this.count; idx++) {
      const c = this.chunks[idx]!;
      const t = c.age / c.life;
      const shrink = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      euler.set(c.rotX, c.rotY, 0);
      quat.setFromEuler(euler);
      pos.set(c.x, c.y, c.z);
      scl.setScalar(Math.max(0.001, c.size * shrink));
      mtx.compose(pos, quat, scl);
      this.mesh.setMatrixAt(idx, mtx);
    }
    this.mesh.count = this.count;
    if (this.count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
