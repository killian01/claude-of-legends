// The violent rupture and landing beats around the grounded Spawn action.
// All motion is sampled from absolute age, including projectile trajectories.
import * as THREE from 'three';
import { VOIDMAUL_SPAWN_TIMING } from '../voidmaul_spawn';

const TAU = Math.PI * 2;
const RIBBON_STEPS = 18;

function random(index: number): number {
  return THREE.MathUtils.euclideanModulo(Math.sin(index * 12.9898 + 4.14) * 43758.5453, 1);
}

function smooth(a: number, b: number, t: number): number {
  const x = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

function pulse(age: number, born: number, attack: number, life: number): number {
  return smooth(born, born + attack, age) * (1 - smooth(born + attack * 2.4, born + life, age));
}

interface Flight {
  born: number;
  life: number;
  angle: number;
  radial: number;
  up: number;
  size: number;
  origin: THREE.Vector2;
}

function flights(count: number, edge: (angle: number) => THREE.Vector2, dust = false): Flight[] {
  return Array.from({ length: count }, (_, i) => {
    const section = i < count / 2 ? 0 : i < (count * 3) / 4 ? 1 : 2;
    const born = [
      VOIDMAUL_SPAWN_TIMING.rupture,
      VOIDMAUL_SPAWN_TIMING.fullEmergence,
      VOIDMAUL_SPAWN_TIMING.stomp,
    ][section]!;
    const angle = i * 2.399963 + random(i + 2) * 0.36;
    return {
      born: born + random(i + 7) * (section === 0 ? 0.2 : 0.1),
      life: dust ? 1.25 + random(i + 21) * 0.5 : 0.85 + random(i + 21) * 0.68,
      angle,
      radial: dust ? 0.3 + random(i + 10) * 0.45 : 0.45 + random(i + 10) * 0.9,
      up: dust ? 0.16 + random(i + 16) * 0.1 : 0.85 + random(i + 16) * 1.45,
      size: dust ? 0.15 + random(i + 19) * 0.14 : 0.013 + random(i + 19) * 0.025,
      origin: edge(angle).multiplyScalar(0.92),
    };
  });
}

function particleCloud(
  count: number,
  dust: boolean,
): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
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
  float scale = length(modelMatrix[0].xyz);
  gl_PointSize = clamp(aSize * scale * uHeight * .5 * projectionMatrix[1][1] / max(.01, -view.z), 0., 180.);
  gl_Position = projectionMatrix * view;
}`,
    fragmentShader: `varying float vFade;
void main() {
  vec2 p = gl_PointCoord - .5;
  float radius = length(p) * 2.;
  float soft = pow(max(0., 1. - radius), ${dust ? '1.5' : '2.4'});
  ${
    dust
      ? `float grain = .75 + .25 * sin(p.x * 31. + sin(p.y * 24.) * 3.);
  gl_FragColor = vec4(vec3(.16, .13, .21), soft * grain * vFade);`
      : `vec3 color = mix(vec3(.13, .25, 1.), vec3(.65, .92, 1.), soft);
  gl_FragColor = vec4(color, soft * vFade);`
  }
}`,
    transparent: true,
    depthWrite: false,
    blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = dust ? 'Voidmaul_RuptureDust' : 'Voidmaul_RuptureSparks';
  points.frustumCulled = false;
  const viewport = new THREE.Vector2();
  points.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(viewport);
    material.uniforms.uHeight!.value = viewport.y;
  };
  return points;
}

function energyRibbon(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const uv = new Float32Array(RIBBON_STEPS * 4);
  const indices: number[] = [];
  for (let i = 0; i < RIBBON_STEPS; i++) {
    uv.set([0, i / (RIBBON_STEPS - 1), 1, i / (RIBBON_STEPS - 1)], i * 4);
    if (i < RIBBON_STEPS - 1) {
      const j = i * 2;
      indices.push(j, j + 1, j + 3, j, j + 3, j + 2);
    }
  }
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(RIBBON_STEPS * 6), 3),
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return geometry;
}

function energyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uAge: { value: 0 }, uFade: { value: 0 } },
    vertexShader: `varying vec2 vFlow;
void main() {
  vFlow = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `uniform float uAge;
uniform float uFade;
varying vec2 vFlow;
void main() {
  float side = pow(max(0., sin(vFlow.x * 3.14159265)), 1.4);
  float tip = pow(max(0., 1. - vFlow.y), .65);
  float flow = .65 + .35 * sin(vFlow.y * 28. - uAge * 21. + sin(vFlow.x * 13.) * 2.);
  float vein = pow(max(0., sin(vFlow.y * 58. - uAge * 35. + vFlow.x * 9.)), 7.);
  float core = pow(max(0., sin(vFlow.x * 3.14159265)), 7.);
  vec3 color = mix(vec3(.12, .20, .90), vec3(.42, .15, .92), vFlow.y);
  color += vec3(.48, .74, .95) * vein + vec3(.60, .88, 1.15) * core;
  gl_FragColor = vec4(color, side * tip * flow * uFade);
}`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function shockwave(color: number): THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.RingGeometry(0.92, 1, 96);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    const angle = Math.atan2(positions.getY(i), positions.getX(i));
    const tear = 1 + Math.sin(angle * 13) * 0.035 + Math.sin(angle * 29 + 0.3) * 0.018;
    positions.setXY(i, positions.getX(i) * tear, positions.getY(i) * tear);
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAge: { value: 0 },
      uFade: { value: 0 },
      uColor: { value: new THREE.Color(color).multiplyScalar(1.7) },
    },
    vertexShader: `varying vec2 vWave;
void main() {
  vWave = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `uniform float uAge;
uniform float uFade;
uniform vec3 uColor;
varying vec2 vWave;
void main() {
  vec2 p = vWave - .5;
  float radius = length(p) * 2.;
  float angle = atan(p.y, p.x);
  float torn = .24 + .76 * smoothstep(-.65, .45,
    sin(angle * 19. + sin(angle * 5.) * 2. + uAge * 1.3));
  float soft = exp(-pow((radius - .96) * 43., 2.));
  gl_FragColor = vec4(uColor, soft * torn * uFade);
}`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  return new THREE.Mesh(geometry, material);
}

export class VoidmaulRiftBurstFx {
  readonly root = new THREE.Group();
  private readonly jets: {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    angle: number;
    base: THREE.Vector2;
    index: number;
  }[] = [];
  private readonly waves: {
    mesh: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
    born: number;
    life: number;
    reach: number;
  }[] = [];
  private readonly stones: THREE.InstancedMesh<
    THREE.IcosahedronGeometry,
    THREE.MeshLambertMaterial
  >;
  private readonly stoneFlights: Flight[];
  private readonly sparks = particleCloud(96, false);
  private readonly sparkFlights: Flight[];
  private readonly dust = particleCloud(36, true);
  private readonly dustFlights: Flight[];
  private readonly transform = new THREE.Object3D();
  private disposed = false;

  constructor(edge: (angle: number) => THREE.Vector2) {
    this.root.name = 'Voidmaul_RiftBursts';
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * TAU + random(i + 41) * 0.14;
      const mesh = new THREE.Mesh(energyRibbon(), energyMaterial());
      mesh.name = `Voidmaul_EruptionArc_${i}`;
      mesh.frustumCulled = false;
      this.jets.push({ mesh, angle, base: edge(angle), index: i });
      this.root.add(mesh);
    }
    for (const [born, life, reach, color] of [
      [VOIDMAUL_SPAWN_TIMING.rupture, 0.9, 2.15, 0x7971ff],
      [VOIDMAUL_SPAWN_TIMING.fullEmergence, 0.74, 1.65, 0x639fff],
      [VOIDMAUL_SPAWN_TIMING.stomp, 1.0, 2.65, 0x9fbbff],
    ]) {
      const mesh = shockwave(color!);
      mesh.name = 'Voidmaul_RuptureShockwave';
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.009;
      this.waves.push({ mesh, born: born!, life: life!, reach: reach! });
      this.root.add(mesh);
    }
    this.stoneFlights = flights(72, edge);
    this.sparkFlights = flights(96, edge);
    this.dustFlights = flights(36, edge, true);
    this.stones = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({
        color: 0x44404f,
        emissive: 0x152455,
        emissiveIntensity: 0.2,
        transparent: true,
      }),
      this.stoneFlights.length,
    );
    this.stones.name = 'Voidmaul_ThrownStones';
    this.stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stones.frustumCulled = false;
    this.root.add(this.stones, this.sparks, this.dust);
    this.update(0);
  }

  update(age: number): void {
    if (this.disposed) return;
    for (const { mesh, angle, base, index } of this.jets) {
      const main = pulse(age, VOIDMAUL_SPAWN_TIMING.rupture + index * 0.01, 0.09, 1.12);
      const landing = pulse(age, VOIDMAUL_SPAWN_TIMING.fullEmergence + index * 0.004, 0.05, 0.4);
      const stomp = pulse(age, VOIDMAUL_SPAWN_TIMING.stomp + index * 0.007, 0.045, 0.6);
      const strength = Math.max(main, landing * 0.42, stomp * 0.66);
      const height = main * (0.82 + random(index + 5) * 0.4) + landing * 0.23 + stomp * 0.42;
      mesh.visible = strength > 0.002;
      mesh.material.uniforms.uAge!.value = age + index * 0.173;
      mesh.material.uniforms.uFade!.value = strength * (Math.sin(angle) > 0 ? 0.62 : 0.88);
      const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let j = 0; j < RIBBON_STEPS; j++) {
        const u = j / (RIBBON_STEPS - 1);
        const turn = angle + u * 1.3 + 0.16 * Math.sin(age * 7 + index) * u;
        const spread = u ** 1.4 * (0.29 + main * 0.14);
        const x = base.x + Math.cos(turn) * spread;
        const z = base.y + Math.sin(turn) * spread;
        const y = 0.01 + height * Math.sin((u * Math.PI) / 2);
        const edgeTear = 1 + 0.28 * Math.sin(u * 19 + index) * Math.sin(u * Math.PI);
        const halfWidth = (0.038 + strength * 0.046) * (1 - u * 0.87) * edgeTear;
        positions.setXYZ(j * 2, x - Math.sin(turn) * halfWidth, y, z + Math.cos(turn) * halfWidth);
        positions.setXYZ(
          j * 2 + 1,
          x + Math.sin(turn) * halfWidth,
          y,
          z - Math.cos(turn) * halfWidth,
        );
      }
      positions.needsUpdate = true;
    }
    for (const { mesh, born, life, reach } of this.waves) {
      const elapsed = age - born;
      const progress = elapsed / life;
      mesh.visible = elapsed > 0 && elapsed < life;
      mesh.scale.setScalar(0.48 + Math.max(0, progress) ** 0.72 * reach);
      mesh.material.uniforms.uAge!.value = age;
      mesh.material.uniforms.uFade!.value =
        pulse(age, born, 0.035, life) * (1 - Math.max(0, progress)) * 0.88;
    }
    for (let i = 0; i < this.stoneFlights.length; i++) {
      const p = this.stoneFlights[i]!;
      const t = age - p.born;
      const active = t > 0 && t < p.life;
      const fade = active ? 1 - smooth(p.life * 0.7, p.life, t) : 0;
      const distance = (p.radial * (1 - Math.exp(-t * 0.65))) / 0.65;
      this.transform.position.set(
        p.origin.x + Math.cos(p.angle) * distance,
        Math.max(p.size * 1.4, p.up * t - 1.75 * t * t),
        p.origin.y + Math.sin(p.angle) * distance,
      );
      this.transform.rotation.set(t * (2 + random(i + 27) * 5), p.angle + t * 3, t * 4);
      this.transform.scale.set(p.size * fade, p.size * 0.74 * fade, p.size * 1.22 * fade);
      this.transform.updateMatrix();
      this.stones.setMatrixAt(i, this.transform.matrix);
    }
    this.stones.instanceMatrix.needsUpdate = true;
    this.updateCloud(this.sparks, this.sparkFlights, age, false);
    this.updateCloud(this.dust, this.dustFlights, age, true);
  }

  private updateCloud(
    cloud: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>,
    specs: Flight[],
    age: number,
    dust: boolean,
  ): void {
    const positions = cloud.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sizes = cloud.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const fades = cloud.geometry.getAttribute('aFade') as THREE.BufferAttribute;
    for (let i = 0; i < specs.length; i++) {
      const p = specs[i]!;
      const t = age - p.born;
      const active = t > 0 && t < p.life;
      const progress = THREE.MathUtils.clamp(t / p.life, 0, 1);
      const d = Math.max(0, t) * p.radial;
      positions.setXYZ(
        i,
        p.origin.x + Math.cos(p.angle) * d,
        dust ? 0.045 + p.up * Math.max(0, t) * 0.42 : Math.max(0.02, p.up * t - 0.85 * t * t),
        p.origin.y + Math.sin(p.angle) * d,
      );
      sizes.setX(i, active ? p.size * (dust ? 1 + progress * 2 : 1 - progress * 0.5) : 0);
      fades.setX(i, active ? Math.sin(progress * Math.PI) * (dust ? 0.32 : 1) : 0);
    }
    positions.needsUpdate = sizes.needsUpdate = fades.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.stones.dispose();
    this.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          material.dispose();
      }
    });
  }
}
