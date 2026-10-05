// Contact-time rock fracture and the scar left by Voidmaul's ground slam.
// Coordinates are world metres, Y up. The owner supplies the fixed terrain anchor.
import * as THREE from 'three';
import { type VoidmaulStone, voidmaulStones } from '../../sim/combat/voidmaul_stones';
import { VOIDMAUL_SLAM, type VoidmaulAttackKind } from '../../sim/content/voidmaul_slam';
import { VoidmaulCrushPawFx } from './voidmaul_crush_paw_fx';

// The scar and the stones stay a few seconds after the last stone lands,
// then fade: a fight around the ring is not buried under old debris.
export const VOIDMAUL_ATTACK_FX_DURATION_S = 6.5;
const FADE_FROM_S = 4.5;
const TAU = Math.PI * 2;
const DUST_COUNT = 112;
const SPARK_COUNT = 128;
const GRAVITY = 12;

export interface VoidmaulAttackArena {
  centerX: number;
  centerZ: number;
  radius: number;
}

function random(index: number): number {
  return THREE.MathUtils.euclideanModulo(Math.sin(index * 12.9898 + 9.73) * 43758.5453, 1);
}

function smooth(a: number, b: number, value: number): number {
  const x = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

function edge(angle: number): number {
  return 1 + Math.sin(angle * 7 + 0.7) * 0.072 + Math.sin(angle * 19) * 0.036;
}

function groundFan(radius: number, steps = 96): THREE.BufferGeometry {
  const positions = [0, 0, 0];
  const uv = [0, 0];
  const indices: number[] = [];
  const rings = 16;
  for (let ring = 1; ring <= rings; ring++) {
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * TAU;
      const x = Math.cos(angle) * edge(angle) * (ring / rings);
      const z = Math.sin(angle) * edge(angle) * (ring / rings);
      positions.push(x * radius, 0, z * radius);
      uv.push(x, z);
      if (i >= steps) continue;
      const j = 1 + (ring - 1) * (steps + 1) + i;
      if (ring === 1) indices.push(0, j + 1, j);
      else {
        const prior = j - (steps + 1);
        indices.push(prior, prior + 1, j + 1, prior, j + 1, j);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function groundMaterial(fragmentShader: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uAge: { value: 0 }, uFade: { value: 0 } },
    vertexShader: `varying vec2 vGround;
void main() {
  vGround = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
}

function fractureGeometry(radius: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const color: number[] = [];
  for (let branch = 0; branch < 15; branch++) {
    const angle = (branch / 15) * TAU + random(branch + 41) * 0.23;
    const points = Array.from({ length: 6 }, (_, i) => {
      const r = (0.31 + (i / 5) * (0.52 + random(branch + 22) * 0.2)) * radius;
      const a = angle + Math.sin(i * 2.7 + branch) * 0.08;
      return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    });
    const base = positions.length / 3;
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const previous = points[Math.max(0, i - 1)]!;
      const next = points[Math.min(i + 1, points.length - 1)]!;
      const side = new THREE.Vector3(-(next.z - previous.z), 0, next.x - previous.x)
        .normalize()
        .multiplyScalar(radius * 0.013 * (1 - i / 6));
      positions.push(...p.clone().sub(side).toArray(), ...p.clone().add(side).toArray());
      const shade = 0.025 + (i / 6) * 0.065;
      color.push(shade, shade * 0.83, shade * 1.03, shade, shade * 0.83, shade * 1.03);
      if (i < points.length - 1) {
        const j = base + i * 2;
        indices.push(j, j + 1, j + 3, j, j + 3, j + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(indices);
  return geometry;
}

function shardGeometry(variant: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * TAU;
      const r = 0.7 + random(variant * 19 + i + 1) * 0.5;
      const height = layer === 0 ? -0.3 : 0.24 + random(variant * 7 + i + 9) * 0.22;
      positions.push(Math.cos(angle) * r, height, Math.sin(angle) * r * 0.72);
      const shade = layer === 0 ? 0.26 : 0.47 + random(variant * 29 + i + 8) * 0.18;
      colors.push(shade, shade * 0.92, shade * 0.94);
    }
  }
  for (let i = 1; i < 4; i++) indices.push(0, i + 1, i, 5, i + 5, i + 6);
  for (let i = 0; i < 5; i++) {
    const next = (i + 1) % 5;
    indices.push(i, next, next + 5, i, next + 5, i + 5);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const second = indices[i + 1]!;
    indices[i + 1] = indices[i + 2]!;
    indices[i + 2] = second;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

interface StoneFlight {
  born: number;
  direction: THREE.Vector2;
  origin: THREE.Vector2;
  distance: number;
  duration: number;
  speed: number;
  up: number;
  size: number;
  groundY: number;
  originHeight: number;
  landing: number;
  bounce: number;
  // How far it rolls on past its landing.
  roll: number;
  spin: THREE.Vector3;
}

function particleCloud(count: number, dust: boolean) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
  geometry.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(count), 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uHeight: { value: 960 } },
    vertexShader: `uniform float uHeight;
attribute float aSize;
attribute float aFade;
varying float vFade;
void main() {
  vFade = aFade;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uHeight * .5 * projectionMatrix[1][1] / max(.01, -view.z), 0., 220.);
  gl_Position = projectionMatrix * view;
}`,
    fragmentShader: `varying float vFade;
void main() {
  vec2 p = gl_PointCoord - .5;
  float soft = pow(max(0., 1. - length(p) * 2.), ${dust ? '1.7' : '2.3'});
  ${
    dust
      ? `float grain = .76 + .24 * sin(p.x * 29. + sin(p.y * 25.) * 4.);
  gl_FragColor = vec4(vec3(.40, .34, .29), soft * grain * vFade);`
      : 'gl_FragColor = vec4(mix(vec3(.24, .38, .9), vec3(.80, .91, 1.), soft), soft * vFade);'
  }
}`,
    transparent: true,
    depthWrite: false,
    blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = dust ? 'Voidmaul_AttackDust' : 'Voidmaul_AttackSparks';
  points.frustumCulled = false;
  const viewport = new THREE.Vector2();
  points.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(viewport);
    material.uniforms.uHeight!.value = viewport.y;
  };
  return points;
}

export class VoidmaulAttackFx {
  readonly root = new THREE.Group();
  private readonly radius: number;
  private readonly arena: VoidmaulAttackArena;
  private readonly pawSpread: number;
  private readonly pawSpreadForward: number;
  private readonly crushPaws: VoidmaulCrushPawFx | null;
  private readonly crater: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly cracks: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly wave: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly stones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>[] =
    [];
  private readonly flights: StoneFlight[];
  private readonly dust = particleCloud(DUST_COUNT, true);
  private readonly sparks = particleCloud(SPARK_COUNT, false);
  private readonly transform = new THREE.Object3D();
  private readonly supportVertex = new THREE.Vector3();
  private readonly restMatrices: THREE.Matrix4[] = [];
  private groundHeight = (_x: number, _z: number): number => 0;
  private age = 0;
  private disposed = false;

  constructor(
    radius: number,
    arena?: VoidmaulAttackArena,
    readonly kind: VoidmaulAttackKind = 'slam',
    // The sim's stones (combat/voidmaul_stones.ts) in this effect's frame;
    // absent, the same layout laid out here.
    stones?: readonly VoidmaulStone[],
  ) {
    this.radius = Number.isFinite(radius) ? Math.max(0.2, radius) : 1;
    const size =
      radius > (VOIDMAUL_SLAM.radius + VOIDMAUL_SLAM.ascendantRadius) * 0.5
        ? VOIDMAUL_SLAM.ascendantScale
        : 1;
    this.pawSpread = kind === 'crush' ? VOIDMAUL_SLAM.crushPawSpread * size : 0;
    this.pawSpreadForward = kind === 'crush' ? VOIDMAUL_SLAM.crushPawSpreadForward * size : 0;
    this.arena =
      arena &&
      [arena.centerX, arena.centerZ, arena.radius].every(Number.isFinite) &&
      arena.radius > 0
        ? { ...arena }
        : { centerX: 0, centerZ: 0, radius: this.radius * 2.7 };
    this.root.name = 'Voidmaul_AttackFracture';
    this.crater = new THREE.Mesh(
      groundFan(this.radius * 0.64),
      groundMaterial(`uniform float uAge;
uniform float uFade;
varying vec2 vGround;
float noise(vec2 p) { return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float r = length(vGround);
  float angle = atan(vGround.y, vGround.x);
  float jagged = 1. + sin(angle * 7. + .7) * .072 + sin(angle * 19.) * .036;
  float grain = .55 * noise(vGround * 96.) + .45 * noise(vGround * 39.);
  float rim = exp(-pow((r / jagged - .82) * 14., 2.));
  float gouge = pow(max(0., sin(angle * 17. + sin(r * 19.) * .7)), 14.);
  vec3 soil = mix(vec3(.055, .037, .046), vec3(.20, .17, .145), smoothstep(.20, .79, r));
  soil += vec3(.14, .12, .10) * rim * (.35 + .65 * grain);
  soil *= .7 + .4 * grain - gouge * .23;
  float alpha = (1. - smoothstep(.90, 1.03, r / jagged)) * .89 * uFade;
  gl_FragColor = vec4(soil, alpha);
}`),
    );
    this.crater.name = 'Voidmaul_AttackCrater';
    this.crater.position.y = 0.018;
    this.crater.renderOrder = 6;
    this.cracks = new THREE.Mesh(
      fractureGeometry(this.radius),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.cracks.name = 'Voidmaul_AttackGroundCracks';
    this.cracks.position.y = 0.02;
    this.cracks.renderOrder = 7;
    this.wave = new THREE.Mesh(
      groundFan(this.radius * 1.28),
      groundMaterial(`uniform float uAge;
uniform float uFade;
varying vec2 vGround;
void main() {
  float r = length(vGround);
  float angle = atan(vGround.y, vGround.x);
  float reach = mix(.06, 1. / 1.28, clamp(uAge / .64, 0., 1.));
  float jagged = sin(angle * 15.) * .013 + sin(angle * 29.) * .010;
  float band = exp(-pow((r - reach + jagged) * 35., 2.));
  float tear = .22 + .78 * smoothstep(-.6, .6, sin(angle * 21. + sin(angle * 7.) * 2.));
  float flash = exp(-r * r * 15.) * (1. - smoothstep(.025, .19, uAge));
  vec3 color = mix(vec3(.38, .43, .92), vec3(1.25, 1.42, 1.65), max(band, flash));
  gl_FragColor = vec4(color, max(band * tear, flash * .92) * uFade);
}`),
    );
    this.wave.name = 'Voidmaul_AttackShockwave';
    this.wave.position.y = 0.035;
    this.wave.material.blending = THREE.AdditiveBlending;
    this.wave.renderOrder = 8;
    if (kind === 'crush') {
      this.crater.geometry
        .scale(0.43, 1, 0.66)
        .translate(-this.pawSpread, 0, -this.pawSpreadForward);
      this.crater.userData.paw = 'left';
      this.cracks.geometry
        .scale(0.58, 1, 0.58)
        .translate(-this.pawSpread, 0, -this.pawSpreadForward);
      this.crushPaws = new VoidmaulCrushPawFx(
        this.crater,
        this.cracks,
        this.wave,
        this.pawSpread,
        this.pawSpreadForward,
      );
      this.root.add(this.crushPaws.root);
    } else this.crushPaws = null;
    // The very stones the sim lands (combat/voidmaul_stones.ts), in this
    // effect's frame; a stone that lands on a unit hurts it, so each one
    // flies from its origin to exactly its target in its own flight time.
    const thrown =
      stones ??
      voidmaulStones(
        { x: 0, z: 0 },
        this.radius,
        { center: { x: this.arena.centerX, z: this.arena.centerZ }, radius: this.arena.radius },
        kind === 'crush'
          ? [
              { x: -this.pawSpread, z: -this.pawSpreadForward },
              { x: this.pawSpread, z: this.pawSpreadForward },
            ]
          : undefined,
      );
    this.flights = thrown.map((stone, i) => {
      const origin = new THREE.Vector2(stone.origin.x, stone.origin.z);
      const direction = new THREE.Vector2(stone.target.x, stone.target.z).sub(origin);
      const distance = direction.length();
      if (distance > 0) direction.divideScalar(distance);
      const bounce = 0.8 + random(i + 34) * 0.6;
      return {
        born: stone.born,
        direction,
        origin,
        distance,
        duration: stone.flight,
        speed: distance / stone.flight,
        up: GRAVITY * stone.flight * 0.5,
        size: stone.size,
        groundY: stone.size * 0.7,
        originHeight: 0,
        landing: stone.flight,
        bounce,
        roll: stone.size * 0.3,
        spin: new THREE.Vector3(
          random(i + 25) - 0.5,
          random(i + 26) - 0.5,
          random(i + 27) - 0.5,
        ).multiplyScalar(19),
      };
    });
    for (let variant = 0; variant < 4; variant++) {
      const mesh = new THREE.InstancedMesh(
        shardGeometry(variant),
        new THREE.MeshLambertMaterial({
          color: 0x9c928c,
          vertexColors: true,
          flatShading: true,
          transparent: true,
        }),
        Math.ceil(this.flights.length / 4),
      );
      mesh.name = `Voidmaul_AttackRockShards_${variant}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.stones.push(mesh);
      this.root.add(mesh);
    }
    this.root.add(this.crater, this.cracks, this.wave, this.dust, this.sparks);
    this.cacheRestPoses();
    this.update(0);
  }

  // The owner samples world terrain through this effect's fixed yaw/anchor.
  // Heights here are local Y offsets, so a scar follows stairs as well as slopes.
  conformGround(heightAt: (localX: number, localZ: number) => number): void {
    if (this.disposed) return;
    this.groundHeight = (x, z) => {
      const height = heightAt(x, z);
      return Number.isFinite(height) ? height : 0;
    };
    for (const mesh of [
      this.crater,
      this.cracks,
      this.wave,
      ...(this.crushPaws?.groundMeshes ?? []),
    ]) {
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i++) {
        position.setY(i, this.groundHeight(position.getX(i), position.getZ(i)));
      }
      position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    }
    for (const flight of this.flights) {
      flight.originHeight = this.groundHeight(flight.origin.x, flight.origin.y);
      const plannedTravel = flight.duration * flight.speed;
      const plannedHeight = this.groundHeight(
        flight.origin.x + flight.direction.x * plannedTravel,
        flight.origin.y + flight.direction.y * plannedTravel,
      );
      flight.up =
        GRAVITY * flight.duration * 0.5 + (plannedHeight - flight.originHeight) / flight.duration;
      // The arc meets the ground at the target on the sim's landing beat,
      // the moment the stone hurts what stands there.
      flight.landing = flight.duration;
    }
    this.cacheRestPoses();
    this.update(this.age);
  }

  private supportHeight(index: number): number {
    this.transform.updateMatrix();
    const vertices = this.stones[index % 4]!.geometry.getAttribute('position');
    let support = -Infinity;
    for (let i = 0; i < vertices.count; i++) {
      this.supportVertex.fromBufferAttribute(vertices, i).applyMatrix4(this.transform.matrix);
      support = Math.max(
        support,
        this.groundHeight(this.supportVertex.x, this.supportVertex.z) - this.supportVertex.y,
      );
    }
    return support + 0.005;
  }

  private setRockPose(
    index: number,
    flight: StoneFlight,
    spinTime: number,
    x: number,
    z: number,
  ): void {
    this.transform.position.set(x, 0, z);
    this.transform.rotation.set(
      flight.spin.x * spinTime + random(index + 31),
      flight.spin.y * spinTime,
      flight.spin.z * spinTime,
    );
    this.transform.scale.setScalar(flight.size);
  }

  private cacheRestPoses(): void {
    for (let i = 0; i < this.flights.length; i++) {
      const flight = this.flights[i]!;
      const bounceDuration = (2 * flight.bounce) / GRAVITY;
      const travel = flight.distance + flight.roll;
      this.setRockPose(
        i,
        flight,
        flight.landing + bounceDuration * 0.6,
        flight.origin.x + flight.direction.x * travel,
        flight.origin.y + flight.direction.y * travel,
      );
      // Measure the complete rotated shard against terrain beneath each
      // vertex. Its actual lowest corner touches, rather than a guessed pivot.
      this.transform.position.y = this.supportHeight(i);
      this.transform.updateMatrix();
      const matrix = this.restMatrices[i] ?? new THREE.Matrix4();
      matrix.copy(this.transform.matrix);
      this.restMatrices[i] = matrix;
    }
  }

  update(age: number): boolean {
    if (this.disposed) return false;
    const now = Number.isFinite(age) ? Math.max(0, age) : VOIDMAUL_ATTACK_FX_DURATION_S;
    this.age = now;
    const alive = now < VOIDMAUL_ATTACK_FX_DURATION_S;
    this.root.visible = alive;
    if (!alive) return false;
    const scarFade = 1 - smooth(FADE_FROM_S, VOIDMAUL_ATTACK_FX_DURATION_S, now);
    const imprint = smooth(0, 0.08, now) * scarFade;
    this.crater.material.uniforms.uAge!.value = now;
    this.crater.material.uniforms.uFade!.value = imprint;
    this.cracks.material.opacity = imprint * 0.89;
    this.crushPaws?.update(now, imprint);
    this.wave.visible = now < 0.64;
    this.wave.material.uniforms.uAge!.value = now;
    this.wave.material.uniforms.uFade!.value =
      (1 - smooth(0.3, 0.64, now)) * (this.kind === 'crush' ? 1.55 : 1.1);
    for (let i = 0; i < this.flights.length; i++) {
      const flight = this.flights[i]!;
      const t = Math.max(0, now - flight.born);
      const bounced = Math.max(0, t - flight.landing);
      const bounceDuration = (2 * flight.bounce) / GRAVITY;
      const exists = now >= flight.born;
      if (exists && t >= flight.landing + bounceDuration) {
        this.stones[i % 4]!.setMatrixAt(Math.floor(i / 4), this.restMatrices[i]!);
        continue;
      }
      const flying = Math.min(t, flight.landing);
      const rolling = Math.min(bounced, bounceDuration);
      const travel =
        Math.min(flight.distance, flying * flight.speed) +
        flight.roll * (bounceDuration > 0 ? rolling / bounceDuration : 0);
      const x = flight.origin.x + flight.direction.x * travel;
      const z = flight.origin.y + flight.direction.y * travel;
      const spinTime = flying + rolling * 0.6;
      this.setRockPose(i, flight, spinTime, x, z);
      if (!exists) this.transform.scale.setScalar(0);
      else {
        const support = this.supportHeight(i);
        this.transform.position.y =
          t < flight.landing
            ? Math.max(
                support,
                flight.originHeight + flight.groundY + flight.up * t - 0.5 * GRAVITY * t * t,
              )
            : support + flight.bounce * rolling - 0.5 * GRAVITY * rolling * rolling;
      }
      this.transform.updateMatrix();
      this.stones[i % 4]!.setMatrixAt(Math.floor(i / 4), this.transform.matrix);
    }
    for (const mesh of this.stones) {
      mesh.material.opacity = scarFade;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.updateParticles(this.dust, now, true);
    this.updateParticles(this.sparks, now, false);
    return true;
  }

  private updateParticles(
    cloud: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>,
    age: number,
    dust: boolean,
  ): void {
    cloud.visible = age < (dust ? 3.4 : 1.3);
    if (!cloud.visible) return;
    const position = cloud.geometry.getAttribute('position') as THREE.BufferAttribute;
    const size = cloud.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const fade = cloud.geometry.getAttribute('aFade') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const born = random(i + 117) * (dust ? 0.22 : 0.05);
      const t = Math.max(0, age - born);
      const life = dust ? 2.1 + random(i + 102) * 1.0 : 0.55 + random(i + 102) * 0.65;
      const angle = i * 2.399963 + random(i + 104) * 0.6;
      const progress = Math.min(1, t / (life * (dust ? 0.86 : 0.75)));
      const targetRadius = this.arena.radius * (0.4 + random(i + 109) * 0.55);
      const originX = (i % 2 === 0 ? -1 : 1) * this.pawSpread;
      const originZ = (i % 2 === 0 ? -1 : 1) * this.pawSpreadForward;
      const x =
        originX * (1 - progress) + (this.arena.centerX + Math.cos(angle) * targetRadius) * progress;
      const z =
        originZ * (1 - progress) + (this.arena.centerZ + Math.sin(angle) * targetRadius) * progress;
      const height = dust
        ? this.radius * (0.03 + t * (0.2 + random(i + 106) * 0.25))
        : Math.max(0.035, this.radius * (t * (1.3 + random(i + 106)) - t * t * 1.55));
      position.setXYZ(i, x, Math.max(height, this.groundHeight(x, z) + 0.03), z);
      size.setX(i, this.radius * (dust ? 0.25 + t * 0.36 : 0.025 + random(i + 107) * 0.03));
      fade.setX(i, age < born ? 0 : (1 - smooth(life * 0.18, life, t)) * (dust ? 0.6 : 1.0));
    }
    position.needsUpdate = true;
    size.needsUpdate = true;
    fade.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.stones) mesh.dispose();
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    this.root.removeFromParent();
    this.root.clear();
  }
}
