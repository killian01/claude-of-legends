// One pooled point cloud for every spell particle in the scene: a single
// THREE.Points with an interleaved buffer, a fixed capacity, and one draw
// call. Spawns write into a CPU-side slot array; update integrates, packs
// the live prefix, and uploads only that range (the woc house idiom).

import * as THREE from 'three';
import { SPRITE, spriteAtlas } from './sprites';

const CAP = 2048;
// pos(3) color(3) size(1) alpha(1) rot(1) sprite(1)
const STRIDE = 10;

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  // Seconds.
  life: number;
  size0: number;
  size1?: number;
  color0: number;
  color1?: number;
  alpha0?: number;
  alpha1?: number;
  sprite?: number;
  rot?: number;
  rotVel?: number;
  // Units per second squared, pulls vy down.
  gravity?: number;
  // Fraction of velocity shed per second.
  drag?: number;
}

interface Slot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size0: number;
  size1: number;
  r0: number;
  g0: number;
  b0: number;
  r1: number;
  g1: number;
  b1: number;
  alpha0: number;
  alpha1: number;
  sprite: number;
  rot: number;
  rotVel: number;
  gravity: number;
  drag: number;
}

const VERT = `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aRot;
attribute float aSprite;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
varying float vSprite;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / -mv.z, 0.0, 110.0);
  vColor = aColor;
  vAlpha = aAlpha;
  vRot = aRot;
  vSprite = aSprite;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
varying float vSprite;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float c = cos(vRot);
  float s = sin(vRot);
  pc = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y);
  if (abs(pc.x) > 0.5 || abs(pc.y) > 0.5) discard;
  vec2 cell = vec2(mod(vSprite, 2.0), 1.0 - floor(vSprite / 2.0));
  vec4 tex = texture2D(uMap, (pc + 0.5 + cell) * 0.5);
  float a = tex.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * tex.rgb * a, a);
}
`;

const tmpColor = new THREE.Color();

export class ParticleCloud {
  readonly points: THREE.Points;
  private readonly slots: Slot[] = [];
  private count = 0;
  private readonly data = new Float32Array(CAP * STRIDE);
  private readonly buffer: THREE.InterleavedBuffer;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < CAP; i++) {
      this.slots.push({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 1,
        size0: 1,
        size1: 1,
        r0: 1,
        g0: 1,
        b0: 1,
        r1: 1,
        g1: 1,
        b1: 1,
        alpha0: 1,
        alpha1: 0,
        sprite: SPRITE.glow,
        rot: 0,
        rotVel: 0,
        gravity: 0,
        drag: 0,
      });
    }
    this.buffer = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    this.geometry.setAttribute('aColor', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    this.geometry.setAttribute('aSize', new THREE.InterleavedBufferAttribute(this.buffer, 1, 6));
    this.geometry.setAttribute('aAlpha', new THREE.InterleavedBufferAttribute(this.buffer, 1, 7));
    this.geometry.setAttribute('aRot', new THREE.InterleavedBufferAttribute(this.buffer, 1, 8));
    this.geometry.setAttribute('aSprite', new THREE.InterleavedBufferAttribute(this.buffer, 1, 9));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: spriteAtlas() },
        uScale: { value: 600 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  // Perspective point scaling: pixels tall a size-1 particle is at depth 1.
  setViewport(heightPx: number, fovRadians: number): void {
    this.material.uniforms.uScale!.value = heightPx / (2 * Math.tan(fovRadians / 2));
  }

  spawn(p: ParticleSpawn): void {
    if (this.count >= CAP) return;
    const s = this.slots[this.count++]!;
    s.x = p.x;
    s.y = p.y;
    s.z = p.z;
    s.vx = p.vx ?? 0;
    s.vy = p.vy ?? 0;
    s.vz = p.vz ?? 0;
    s.age = 0;
    s.life = Math.max(0.01, p.life);
    s.size0 = p.size0;
    s.size1 = p.size1 ?? p.size0;
    tmpColor.set(p.color0);
    s.r0 = tmpColor.r;
    s.g0 = tmpColor.g;
    s.b0 = tmpColor.b;
    tmpColor.set(p.color1 ?? p.color0);
    s.r1 = tmpColor.r;
    s.g1 = tmpColor.g;
    s.b1 = tmpColor.b;
    s.alpha0 = p.alpha0 ?? 1;
    s.alpha1 = p.alpha1 ?? 0;
    s.sprite = p.sprite ?? SPRITE.glow;
    s.rot = p.rot ?? 0;
    s.rotVel = p.rotVel ?? 0;
    s.gravity = p.gravity ?? 0;
    s.drag = p.drag ?? 0;
  }

  update(dtS: number): void {
    let i = 0;
    while (i < this.count) {
      const s = this.slots[i]!;
      s.age += dtS;
      if (s.age >= s.life) {
        // Swap-remove: order does not matter inside one additive cloud.
        this.count--;
        const last = this.slots[this.count]!;
        this.slots[this.count] = s;
        this.slots[i] = last;
        continue;
      }
      s.vy -= s.gravity * dtS;
      if (s.drag > 0) {
        const k = Math.max(0, 1 - s.drag * dtS);
        s.vx *= k;
        s.vy *= k;
        s.vz *= k;
      }
      s.x += s.vx * dtS;
      s.y += s.vy * dtS;
      s.z += s.vz * dtS;
      s.rot += s.rotVel * dtS;
      const t = s.age / s.life;
      const o = i * STRIDE;
      const d = this.data;
      d[o] = s.x;
      d[o + 1] = s.y;
      d[o + 2] = s.z;
      d[o + 3] = s.r0 + (s.r1 - s.r0) * t;
      d[o + 4] = s.g0 + (s.g1 - s.g0) * t;
      d[o + 5] = s.b0 + (s.b1 - s.b0) * t;
      d[o + 6] = s.size0 + (s.size1 - s.size0) * t;
      d[o + 7] = s.alpha0 + (s.alpha1 - s.alpha0) * t;
      d[o + 8] = s.rot;
      d[o + 9] = s.sprite;
      i++;
    }
    this.geometry.setDrawRange(0, this.count);
    if (this.count > 0) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, this.count * STRIDE);
      this.buffer.needsUpdate = true;
    }
  }
}
