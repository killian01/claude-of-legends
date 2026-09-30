// The fire column the Pyrefang rises from, rebuilt from the Codex scene
// (scripts/pyrefang_codex_rise_column.py) the way the tower shot is: layered
// additive geometry stepped from a clock. Every tongue is a ribbon whose
// poses are morph targets cross-faded on the column's beats
// (pyrefang_rise.ts); the flame shader streams tileable veins up each
// tongue under a soft tongue mask and colours them deep red to yellow. A
// lava swirl turns on the floor, a shock ring runs out, sparks leap and
// fall. The group is built in source metres and Blender axes (Z up) and
// turned upright here, so the creature's own scale and facing carry it.
// Presentation only.

import * as THREE from 'three';
import {
  beatWeights,
  COLUMN_BEATS,
  CROWN_BEATS,
  PIT_RADIUS,
  RISE_FX_S,
  type RibbonSpec,
  ribbonVertices,
  ringScale,
  riseFade,
  riseRibbons,
  riseSparks,
  type SparkSpec,
  seeded,
  sparkAt,
  swirlScale,
} from '../pyrefang_rise';

// ------------------------------------------------------------ textures

// Tileable fractal value noise in [0, 1], w x h, row-major.
function valueNoise(
  w: number,
  h: number,
  cellsU: number,
  cellsV: number,
  seed: number,
  octaves = 4,
): Float32Array {
  const rng = seeded(seed);
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  let cu = cellsU;
  let cv = cellsV;
  for (let o = 0; o < octaves; o++) {
    const gw = cu + 1;
    const grid = new Float32Array((cv + 1) * gw);
    for (let j = 0; j <= cv; j++) for (let i = 0; i <= cu; i++) grid[j * gw + i] = rng();
    for (let j = 0; j <= cv; j++) grid[j * gw + cu] = grid[j * gw]!;
    for (let i = 0; i <= cu; i++) grid[cv * gw + i] = grid[i]!;
    for (let y = 0; y < h; y++) {
      const gy = (y / h) * cv;
      const y0 = Math.floor(gy);
      let fy = gy - y0;
      fy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < w; x++) {
        const gx = (x / w) * cu;
        const x0 = Math.floor(gx);
        let fx = gx - x0;
        fx = fx * fx * (3 - 2 * fx);
        const a = grid[y0 * gw + x0]!;
        const b = grid[y0 * gw + x0 + 1]!;
        const c = grid[(y0 + 1) * gw + x0]!;
        const d = grid[(y0 + 1) * gw + x0 + 1]!;
        const top = a + (b - a) * fx;
        const bottom = c + (d - c) * fx;
        out[y * w + x]! += amp * (top + (bottom - top) * fy);
      }
    }
    total += amp;
    amp *= 0.5;
    cu *= 2;
    cv *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i]! /= total;
  return out;
}

function texture(w: number, h: number, rgba: Uint8Array, repeat: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Fire veins along U: long bright filaments that fork and wander over a
// dimmer turbulent body. Grey; the shader colours it.
function veinsTexture(): THREE.DataTexture {
  const w = 512;
  const h = 128;
  const streak = valueNoise(w, h, 3, 12, 7);
  const fine = valueNoise(w, h, 6, 26, 13);
  const body = valueNoise(w, h, 4, 5, 29);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const ridge = 1 - Math.abs(2 * streak[i]! - 1);
    const ridge2 = 1 - Math.abs(2 * fine[i]! - 1);
    const v = Math.min(1, 0.75 * ridge ** 5 + 0.55 * ridge2 ** 7 + 0.35 * body[i]!);
    rgba.set([v * 255, v * 255, v * 255, 255], i * 4);
  }
  return texture(w, h, rgba, true);
}

// The floor: spiral arms of lava round a hot centre, fading out.
function swirlTexture(): THREE.DataTexture {
  const size = 256;
  const grain = valueNoise(size, size, 8, 8, 41);
  const rgba = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 - 1;
      const y = ((j + 0.5) / size) * 2 - 1;
      const r = Math.hypot(x, y);
      const angle = Math.atan2(y, x);
      const arms = (0.5 + 0.5 * Math.cos(5 * angle + 7 * r)) ** 4;
      const hot = Math.exp(-((r / 0.25) ** 2));
      const v = Math.min(
        1,
        (0.65 * arms * (0.6 + 0.6 * grain[j * size + i]!) + 0.9 * hot) * Math.max(0, 1 - r) ** 1.2,
      );
      rgba.set(
        [255, (0.28 + 0.6 * v) * 255, (0.05 + 0.35 * v * v) * 255, v * 255],
        (j * size + i) * 4,
      );
    }
  }
  // Painted like the Codex image: sRGB values.
  const tex = texture(size, size, rgba, false);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dotTexture(): THREE.DataTexture {
  const size = 64;
  const rgba = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size) * 2 - 1;
      const y = ((j + 0.5) / size) * 2 - 1;
      const v = Math.max(0, 1 - Math.hypot(x, y)) ** 1.6;
      rgba.set([255, 255, 255, v * 255], (j * size + i) * 4);
    }
  }
  return texture(size, size, rgba, false);
}

let shared: { veins: THREE.Texture; swirl: THREE.Texture; dot: THREE.Texture } | undefined;
function textures(): { veins: THREE.Texture; swirl: THREE.Texture; dot: THREE.Texture } {
  shared ??= { veins: veinsTexture(), swirl: swirlTexture(), dot: dotTexture() };
  return shared;
}

// ------------------------------------------------------------ materials

// The flame shader: the veins streamed along U under a tongue mask (soft
// edges across V, a bright root, a tapering tip), through the Codex ramp.
// Built on MeshBasicMaterial so morph targets come for free.
export interface FireUniforms {
  uScroll: { value: number };
  uFade: { value: number };
}

function fireMaterial(
  veins: THREE.Texture,
  strength: number,
): THREE.MeshBasicMaterial & {
  userData: { fire: FireUniforms };
} {
  const mat = new THREE.MeshBasicMaterial({
    map: veins,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fire: FireUniforms = { uScroll: { value: 0 }, uFade: { value: 1 } };
  mat.userData.fire = fire;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uScroll = fire.uScroll;
    shader.uniforms.uFade = fire.uFade;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uScroll;
uniform float uFade;
vec3 fireRamp(float x) {
  vec3 c = mix(vec3(.15, .0, .0), vec3(.55, .02, .0), smoothstep(.0, .2, x));
  c = mix(c, vec3(.95, .16, .01), smoothstep(.2, .45, x));
  c = mix(c, vec3(1., .40, .03), smoothstep(.45, .7, x));
  c = mix(c, vec3(1., .64, .14), smoothstep(.7, .88, x));
  return mix(c, vec3(1., .82, .45), smoothstep(.88, 1., x));
}
void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  float along = vMapUv.x;
  float across = vMapUv.y;
  float edge = pow(max(sin(across * 3.14159265), 0.0), .9);
  float root = min(along * 14.0, 1.0);
  float taper = pow(max(1.0 - along, 0.0), .8);
  float veins = texture2D(map, vec2(along - uScroll, across)).r;
  float raw = edge * root * taper * (veins * 1.3 + .05);
  float intensity = pow(raw, 1.5);
  diffuseColor = vec4(fireRamp(intensity) * ${strength.toFixed(3)}, min(intensity * 2.2, 1.0) * uFade);
}`,
      );
  };
  // One program per strength: the strength is baked in the source.
  mat.customProgramCacheKey = () => `pyrefang-fire-${strength}`;
  return mat as THREE.MeshBasicMaterial & { userData: { fire: FireUniforms } };
}

function glowMaterial(map: THREE.Texture, color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------ geometry

function ribbonGeometry(spec: RibbonSpec): THREE.BufferGeometry {
  const n = spec.poses[0]!.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(ribbonVertices(spec.poses[0]!), 3));
  const uv = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) uv.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = 2 * i;
    index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  geo.setIndex(index);
  geo.morphAttributes.position = spec.poses
    .slice(1)
    .map((pose) => new THREE.BufferAttribute(ribbonVertices(pose), 3));
  geo.morphTargetsRelative = false;
  // The tongues sweep far beyond their rest pose; never cull them.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.6), 2);
  return geo;
}

function diskGeometry(radius: number, inner = 0): THREE.BufferGeometry {
  return inner > 0
    ? new THREE.RingGeometry(inner, radius, 64, 1)
    : new THREE.CircleGeometry(radius, 64);
}

// ------------------------------------------------------------ the effect

export class PyrefangRiseFx {
  // Upright holder: add it under the creature's root; its local unit is
  // the source metre.
  readonly root = new THREE.Group();
  private readonly axes = new THREE.Group();
  private readonly ribbons: { mesh: THREE.Mesh; spec: RibbonSpec }[] = [];
  private readonly sparks: { sprite: THREE.Sprite; spec: SparkSpec }[] = [];
  private readonly swirl: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly mats: {
    swirl: THREE.MeshBasicMaterial;
    ring: THREE.MeshBasicMaterial;
    spark: THREE.SpriteMaterial;
    crown: ReturnType<typeof fireMaterial>;
    column: ReturnType<typeof fireMaterial>;
    core: ReturnType<typeof fireMaterial>;
  };
  private finished = false;

  // centre: where the column stands, Blender X/Y in source metres.
  // spread: how much wider (across) and taller (up) than authored the
  // fire burns, so the crown can ring the platform's pit.
  constructor(
    centre: readonly [number, number],
    spread: { across: number; up: number } = { across: 1, up: 1 },
  ) {
    const tex = textures();
    this.axes.rotation.x = -Math.PI / 2;
    this.axes.position.set(centre[0], 0, -centre[1]);
    this.axes.scale.set(spread.across, spread.across, spread.up);
    this.root.add(this.axes);
    this.mats = {
      swirl: glowMaterial(tex.swirl, 0xffa060),
      ring: glowMaterial(tex.dot, 0xff8c29),
      spark: new THREE.SpriteMaterial({
        map: tex.dot,
        color: 0xffa040,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      crown: fireMaterial(tex.veins, 1.2),
      column: fireMaterial(tex.veins, 1.1),
      core: fireMaterial(tex.veins, 1.6),
    };
    this.swirl = new THREE.Mesh(diskGeometry(PIT_RADIUS), this.mats.swirl);
    this.swirl.position.z = 0.004;
    this.ring = new THREE.Mesh(diskGeometry(1, 0.9), this.mats.ring);
    this.ring.position.z = 0.006;
    this.axes.add(this.swirl, this.ring);
    for (const spec of riseRibbons()) {
      const mat =
        spec.kind === 'crown'
          ? this.mats.crown
          : spec.kind === 'core'
            ? this.mats.core
            : this.mats.column;
      const mesh = new THREE.Mesh(ribbonGeometry(spec), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.axes.add(mesh);
      this.ribbons.push({ mesh, spec });
    }
    for (const spec of riseSparks()) {
      const sprite = new THREE.Sprite(this.mats.spark);
      // The dot texture is shared by every rise.
      sprite.userData.sharedMap = true;
      sprite.visible = false;
      this.axes.add(sprite);
      this.sparks.push({ sprite, spec });
    }
    this.update(0);
  }

  get done(): boolean {
    return this.finished;
  }

  // Steps the effect to `t` seconds after the rise.
  update(t: number): void {
    if (t >= RISE_FX_S) {
      this.finished = true;
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const s = swirlScale(t);
    this.swirl.scale.set(s, s, 1);
    this.swirl.rotation.z = -2.4 * t;
    this.mats.swirl.opacity = riseFade.swirl(t);
    const r = ringScale(t);
    this.ring.scale.set(r, r, 1);
    this.mats.ring.opacity = riseFade.ring(t);
    this.mats.crown.userData.fire.uScroll.value = 2.2 * t;
    this.mats.crown.userData.fire.uFade.value = riseFade.crown(t);
    this.mats.column.userData.fire.uScroll.value = 2.6 * t;
    this.mats.column.userData.fire.uFade.value = riseFade.column(t);
    this.mats.core.userData.fire.uScroll.value = 0.4 + 3.6 * t;
    this.mats.core.userData.fire.uFade.value = riseFade.core(t);
    const crown = beatWeights(t, CROWN_BEATS, 3);
    const column = beatWeights(t, COLUMN_BEATS, 6);
    for (const { mesh, spec } of this.ribbons) {
      const w = spec.kind === 'crown' ? crown : column;
      const influences = mesh.morphTargetInfluences;
      if (influences) for (let k = 1; k < w.length; k++) influences[k - 1] = w[k]!;
      mesh.rotation.z = spec.spin * t;
      // A tongue folded into the floor draws nothing worth its cost.
      mesh.visible = w[0]! < 0.999;
    }
    this.mats.spark.opacity = riseFade.spark(t);
    for (const { sprite, spec } of this.sparks) {
      const p = sparkAt(spec, t);
      sprite.visible = p.size > 0.001;
      sprite.position.set(p.x, p.y, p.z);
      sprite.scale.setScalar(0.035 * p.size);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const { mesh } of this.ribbons) mesh.geometry.dispose();
    this.swirl.geometry.dispose();
    this.ring.geometry.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
