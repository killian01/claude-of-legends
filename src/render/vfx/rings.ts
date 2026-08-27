// Pooled ground shockwave rings: a fixed set of unit planes running a small
// band shader (twin smoothsteps around an eased progress edge, modulated by
// angular noise). Materials are cloned once at construction; a spawn only
// rebinds uniforms. A saturated pool steals the oldest ring: a fresh impact
// reads louder than a fading tail.

import * as THREE from 'three';

const POOL = 14;

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
uniform vec3 uColor;
uniform float uProgress;
uniform float uAlpha;
uniform float uWidth;
uniform float uSeed;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 || r < 0.001) discard;
  float ang = atan(p.y, p.x);
  float n = 0.82 + 0.18 * sin(ang * 7.0 + uSeed) * sin(ang * 3.0 - uSeed * 1.7);
  float band = smoothstep(uProgress - uWidth, uProgress, r)
    * (1.0 - smoothstep(uProgress, uProgress + uWidth * 0.6, r));
  float a = band * n * uAlpha;
  if (a < 0.008) discard;
  gl_FragColor = vec4(uColor * a, a);
}
`;

interface RingSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  bornAt: number;
  duration: number;
  peak: number;
  active: boolean;
}

function easeOutQuart(t: number): number {
  const k = 1 - t;
  return 1 - k * k * k * k;
}

export class ShockRings {
  private readonly slots: RingSlot[] = [];
  private readonly geometry = new THREE.PlaneGeometry(2, 2);

  constructor(scene: THREE.Scene) {
    const proto = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uProgress: { value: 0 },
        uAlpha: { value: 0 },
        uWidth: { value: 0.16 },
        uSeed: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < POOL; i++) {
      const mat = proto.clone();
      const mesh = new THREE.Mesh(this.geometry, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.06 + i * 0.0025;
      mesh.renderOrder = 5;
      mesh.visible = false;
      scene.add(mesh);
      this.slots.push({ mesh, mat, bornAt: 0, duration: 1, peak: 1, active: false });
    }
    proto.dispose();
  }

  spawn(
    x: number,
    z: number,
    radius: number,
    color: number,
    durationMs: number,
    opts?: { width?: number; alpha?: number },
  ): void {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) {
      slot = this.slots.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
    }
    slot.active = true;
    slot.bornAt = performance.now();
    slot.duration = durationMs;
    slot.peak = opts?.alpha ?? 1;
    slot.mesh.visible = true;
    slot.mesh.position.x = x;
    slot.mesh.position.z = z;
    slot.mesh.scale.setScalar(Math.max(0.1, radius));
    (slot.mat.uniforms.uColor!.value as THREE.Color).set(color);
    slot.mat.uniforms.uWidth!.value = opts?.width ?? 0.26;
    slot.mat.uniforms.uSeed!.value = Math.random() * 6.28;
  }

  update(now: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      const t = (now - s.bornAt) / s.duration;
      if (t >= 1) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.mat.uniforms.uProgress!.value = 0.08 + 0.9 * easeOutQuart(t);
      s.mat.uniforms.uAlpha!.value = s.peak * (1 - t) ** 1.1;
    }
  }
}
