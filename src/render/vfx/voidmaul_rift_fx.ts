// Ground rupture for the four-second Spawn clip. Coordinates are source
// metres, Y up; the renderer owns the fixed world anchor and model scale.
import * as THREE from 'three';
import { VOIDMAUL_SPAWN_TIMING } from '../voidmaul_spawn';
import { VoidmaulRiftBurstFx } from './voidmaul_rift_burst_fx';

export const VOIDMAUL_RIFT_DURATION_S = 4.6;
// The rift's draw order: after the ground (0), whose depth its opening
// clears, and before the units (the renderer's unit layer draws at
// VOIDMAUL_HOLE_ORDER + 1), so the Voidmaul is seen in the hole.
export const VOIDMAUL_HOLE_ORDER = 1;
const EDGE_COUNT = 80;
const TAU = Math.PI * 2;
const FOOTPRINT_SCALE = 1.15;

function smooth(a: number, b: number, t: number): number {
  const x = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

function edge(angle: number): THREE.Vector2 {
  const jagged = 1 + 0.055 * Math.sin(angle * 13) + 0.035 * Math.sin(angle * 29 + 0.6);
  return new THREE.Vector2(
    Math.cos(angle) * 0.455 * jagged * FOOTPRINT_SCALE,
    Math.sin(angle) * 0.29 * jagged * FOOTPRINT_SCALE - 0.035,
  );
}

function openingGeometry(): THREE.BufferGeometry {
  const vertices = [0, 0, -0.035];
  const uv = [0.5, 0.5];
  const indices: number[] = [];
  for (let i = 0; i <= EDGE_COUNT; i++) {
    const p = edge((i / EDGE_COUNT) * TAU);
    vertices.push(p.x, 0, p.y);
    uv.push(0.5 + p.x / (1.2 * FOOTPRINT_SCALE), 0.5 + (p.y + 0.035) / (0.82 * FOOTPRINT_SCALE));
    if (i < EDGE_COUNT) indices.push(0, i + 1, i + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function rimGeometry(width: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= EDGE_COUNT; i++) {
    const a = (i / EDGE_COUNT) * TAU;
    const p = edge(a);
    const outward = new THREE.Vector2(p.x, p.y + 0.035).normalize().multiplyScalar(width);
    vertices.push(p.x, 0, p.y, p.x + outward.x, 0, p.y + outward.y);
    const color = new THREE.Color().setRGB(
      0.17 + 0.21 * (0.5 + 0.5 * Math.sin(a * 3)),
      0.44 + 0.37 * (0.5 + 0.5 * Math.cos(a * 2)),
      1,
    );
    colors.push(color.r, color.g, color.b, color.r * 0.12, color.g * 0.12, color.b * 0.12);
    if (i < EDGE_COUNT) {
      const j = i * 2;
      indices.push(j, j + 1, j + 3, j, j + 3, j + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

function glowMaterial(color = 0xffffff): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function strip(points: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const next = points[Math.min(i + 1, points.length - 1)]!;
    const prior = points[Math.max(0, i - 1)]!;
    const direction = next.clone().sub(prior);
    const side = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
    const taper = 1 - i / points.length;
    const offset = side.multiplyScalar(width * taper);
    vertices.push(...p.clone().sub(offset).toArray(), ...p.clone().add(offset).toArray());
    const strength = taper ** 1.6;
    colors.push(
      strength * 0.3,
      strength * 0.64,
      strength,
      strength * 0.3,
      strength * 0.64,
      strength,
    );
    if (i < points.length - 1) {
      const j = i * 2;
      indices.push(j, j + 1, j + 3, j, j + 3, j + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

function shardGeometry(index: number): THREE.BufferGeometry {
  // A fractured slab, rather than identical cubes orbiting a portal.
  const radius = 0.04 + 0.019 * (1 + Math.sin(index * 2.31));
  const thickness = 0.018 + 0.006 * (index % 3);
  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      const r = radius * (1 + 0.23 * Math.sin(k * 7 + index));
      vertices.push(Math.cos(a) * r, layer * thickness, Math.sin(a) * r * 0.72);
      colors.push(...(layer === 0 ? [0.012, 0.027, 0.075] : [0.052, 0.055, 0.067]));
    }
  }
  for (let k = 1; k < 4; k++) indices.push(0, k + 1, k, 5, k + 5, k + 6);
  for (let k = 0; k < 5; k++) {
    const n = (k + 1) % 5;
    indices.push(k, n, n + 5, k, n + 5, k + 5);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const second = indices[i + 1]!;
    indices[i + 1] = indices[i + 2]!;
    indices[i + 2] = second;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function moteTexture(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const distance = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;
      const alpha = Math.max(0, 1 - distance) ** 2;
      data.set([255, 255, 255, Math.round(alpha * 255)], (y * n + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

function stoneGrain(material: THREE.MeshLambertMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vRiftStone;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvRiftStone = position;',
    );
    shader.fragmentShader = `varying vec3 vRiftStone;
float stoneHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float stoneNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(stoneHash(i), stoneHash(i + vec2(1., 0.)), f.x),
    mix(stoneHash(i + vec2(0., 1.)), stoneHash(i + vec2(1.)), f.x), f.y);
}
${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
vec2 grainPoint = (vRiftStone.xz + vRiftStone.y * vec2(.61, .37)) * 190.;
float grain = .65 * stoneNoise(grainPoint) + .35 * stoneNoise(grainPoint * 3.7);
diffuseColor.rgb *= .47 + .78 * grain;`,
    );
  };
  material.customProgramCacheKey = () => 'voidmaul-rift-stone';
}

export class VoidmaulRiftFx {
  readonly root = new THREE.Group();
  private readonly opening = new THREE.Group();
  private readonly bursts = new VoidmaulRiftBurstFx(edge);
  private readonly core: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly rim: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly fineRim: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly cracks: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly wisps: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly shards: {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
    base: THREE.Vector3;
    angle: number;
  }[] = [];
  private readonly motes: THREE.Sprite[] = [];
  private readonly texture = moteTexture();
  private finished = false;
  private disposed = false;

  constructor() {
    this.root.name = 'Voidmaul_GroundRift';
    this.root.renderOrder = VOIDMAUL_HOLE_ORDER;
    this.root.add(this.opening, this.bursts.root);
    const coreMaterial = new THREE.ShaderMaterial({
      uniforms: { uAge: { value: 0 }, uFade: { value: 0 } },
      vertexShader: `varying vec2 vRiftUv;
void main() {
  vRiftUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `uniform float uAge;
uniform float uFade;
varying vec2 vRiftUv;
void main() {
  vec2 p = vRiftUv - .5;
  float radius = length(p);
  float angle = atan(p.y, p.x);
  float veins = pow(max(0., sin(angle * 7. + radius * 43. - uAge * 2.1)), 12.);
  float outer = smoothstep(.10, .47, radius);
  vec3 dark = mix(vec3(.001, .002, .009), vec3(.015, .011, .053), outer);
  dark += vec3(.025, .035, .15) * veins * outer;
  // Fades in and out by an ordered dither: the opening is opaque, a hole.
  vec2 cell = mod(floor(gl_FragCoord.xy), 4.);
  float threshold = (mod(cell.x * 2. + cell.y * 3., 4.) + mod(cell.y * 2. + cell.x, 4.) * 4. + .5) / 16.;
  if (uFade < threshold) discard;
  gl_FragColor = vec4(dark, 1.);
  // The far plane: whatever stood here (the ground) no longer hides what
  // is drawn after it, so the body still below the ground shows through
  // the opening as it climbs. Units draw after the rift (VOIDMAUL_HOLE_ORDER).
  gl_FragDepth = 1.;
}`,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.core = new THREE.Mesh(openingGeometry(), coreMaterial);
    this.core.name = 'Voidmaul_RiftOpening';
    this.core.position.y = 0.00015;
    const rimMaterial = glowMaterial();
    rimMaterial.vertexColors = true;
    this.rim = new THREE.Mesh(rimGeometry(0.037), rimMaterial);
    this.rim.position.y = 0.006;
    this.fineRim = new THREE.Mesh(rimGeometry(0.0045), glowMaterial(0x87e4ff));
    this.fineRim.position.y = 0.008;
    this.opening.add(this.core, this.rim, this.fineRim);

    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * TAU + 0.16 * Math.sin(i * 2.7);
      const start = edge(a);
      const points: THREE.Vector3[] = [];
      const length = 0.25 + 0.22 * (1 + Math.sin(i * 1.73));
      for (let k = 0; k < 5; k++) {
        const d = (k / 4) * length;
        const bend = k === 0 ? 0 : Math.sin(i * 1.4 + k * 2.2) * 0.028;
        points.push(
          new THREE.Vector3(
            start.x + Math.cos(a) * d - Math.sin(a) * bend,
            0.005,
            start.y + Math.sin(a) * d + Math.cos(a) * bend,
          ),
        );
      }
      const material = glowMaterial();
      material.vertexColors = true;
      const crack = new THREE.Mesh(strip(points, 0.0075), material);
      this.root.add(crack);
      this.cracks.push(crack);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const base = edge(a);
      const points: THREE.Vector3[] = [];
      for (let k = 0; k < 7; k++) {
        const t = k / 6;
        const turn = a + t * 1.3;
        points.push(
          new THREE.Vector3(
            base.x + Math.cos(turn) * t * 0.1,
            0.012 + Math.sin((t * Math.PI) / 2) * (0.18 + 0.035 * (i % 3)),
            base.y + Math.sin(turn) * t * 0.1,
          ),
        );
      }
      const material = glowMaterial(0x7971ff);
      material.vertexColors = true;
      const wisp = new THREE.Mesh(strip(points, 0.015), material);
      this.opening.add(wisp);
      this.wisps.push(wisp);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.13 * Math.sin(i * 2.17);
      const p = edge(a);
      const base = new THREE.Vector3(p.x * 1.13, 0.0003, (p.y + 0.035) * 1.13 - 0.035);
      const material = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        vertexColors: true,
        emissive: 0x152050,
        emissiveIntensity: 0.06,
        transparent: true,
      });
      stoneGrain(material);
      const mesh = new THREE.Mesh(shardGeometry(i), material);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.shards.push({ mesh, base, angle: a });
    }
    const moteMaterial = new THREE.SpriteMaterial({
      map: this.texture,
      color: 0x8cbbff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    for (let i = 0; i < 24; i++) {
      const mote = new THREE.Sprite(moteMaterial);
      this.root.add(mote);
      this.motes.push(mote);
    }
    this.root.traverse((node) => {
      node.frustumCulled = false;
    });
    this.update(0);
  }

  get done(): boolean {
    return this.finished;
  }

  // Absolute age keeps late asset loads, replay seeks and low frame rates
  // on the same emergence beats. No effect clocks use performance.now().
  update(ageSeconds: number): void {
    const age = Number.isFinite(ageSeconds) ? Math.max(0, ageSeconds) : VOIDMAUL_RIFT_DURATION_S;
    this.finished = age >= VOIDMAUL_RIFT_DURATION_S;
    this.root.visible = !this.finished && age > 0;
    if (this.finished || this.disposed) return;
    const opened = smooth(0.03, VOIDMAUL_SPAWN_TIMING.foreGrabR, age);
    const closing = 1 - smooth(2.85, 4.2, age);
    const aperture = opened * closing;
    const residual = 1 - smooth(3.95, VOIDMAUL_RIFT_DURATION_S, age);
    const power = smooth(0, 0.28, age) * residual;
    const eruption = Math.exp(-(((age - (VOIDMAUL_SPAWN_TIMING.rupture + 0.12)) / 0.18) ** 2));
    const stomp = Math.exp(-(((age - (VOIDMAUL_SPAWN_TIMING.stomp + 0.035)) / 0.09) ** 2));
    const pulse = 0.82 + 0.18 * Math.sin(age * 11.5) ** 2 + eruption * 0.55 + stomp * 0.6;
    this.opening.scale.set(0.36 + 0.64 * opened, 1, Math.max(0.008, aperture));
    this.core.material.uniforms.uAge!.value = age;
    this.core.material.uniforms.uFade!.value = power * smooth(0.01, 0.08, aperture);
    this.rim.material.opacity = Math.min(1, power * pulse * 0.85);
    this.fineRim.material.opacity = Math.min(1, power * pulse);
    for (let i = 0; i < this.cracks.length; i++) {
      const crack = this.cracks[i]!;
      const spread = smooth(0.02 + i * 0.009, VOIDMAUL_SPAWN_TIMING.rupture, age);
      crack.geometry.setDrawRange(0, Math.ceil(spread * 4) * 6);
      crack.material.opacity = Math.min(1, power * pulse * spread);
    }
    for (let i = 0; i < this.wisps.length; i++) {
      const wisp = this.wisps[i]!;
      wisp.material.opacity = aperture * power * (0.18 + 0.12 * Math.sin(age * 3.5 + i) ** 2);
      wisp.scale.y = 0.65 + 0.35 * Math.sin(age * 2.1 + i) ** 2;
    }
    const lifted = smooth(VOIDMAUL_SPAWN_TIMING.rupture, 0.75, age) * (1 - smooth(2.85, 3.95, age));
    for (let i = 0; i < this.shards.length; i++) {
      const { mesh, base, angle } = this.shards[i]!;
      const oscillation = Math.sin(age * 8 + i * 1.73) * 0.013 * lifted;
      const kick = eruption * (0.1 + 0.065 * Math.sin(i * 1.8) ** 2) + stomp * 0.095;
      mesh.position.copy(base);
      mesh.position.y += lifted * (0.09 + 0.065 * Math.sin(i * 1.8) ** 2) + oscillation + kick;
      mesh.position.x += Math.cos(angle) * lifted * 0.09;
      mesh.position.z += Math.sin(angle) * lifted * 0.09;
      mesh.rotation.set(
        lifted * Math.sin(angle) * 0.7 + kick * 3,
        angle + lifted * Math.sin(age * 3 + i) * 0.2,
        -lifted * Math.cos(angle) * 0.7 - kick * 2,
      );
      mesh.material.opacity = power;
      mesh.material.emissiveIntensity = lifted * (0.12 + eruption * 0.35 + stomp * 0.3);
      mesh.visible = power > 0.001;
    }
    for (let i = 0; i < this.motes.length; i++) {
      const mote = this.motes[i]!;
      const cycle = (age * 0.68 + i * 0.61803398875) % 1;
      const a = i * 2.399963 + age * 0.25;
      const p = edge(a);
      mote.position.set(
        p.x * (0.82 + cycle * 0.2),
        0.02 + cycle * 0.33,
        (p.y + 0.035) * (0.82 + cycle * 0.2) - 0.035,
      );
      mote.scale.setScalar(0.025 * Math.sin(Math.PI * cycle) * aperture * power);
      mote.visible = mote.scale.x > 0.001;
    }
    this.bursts.update(age);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.bursts.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse((node) => {
      const renderable = node as THREE.Mesh;
      if (renderable.geometry) geometries.add(renderable.geometry);
      if (renderable.material) {
        for (const material of Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material])
          materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.texture.dispose();
  }
}
