// The planet's vertex bend (planet_chart.ts): on the Wanderseed the
// renderer keeps drawing in a flat chart, and every material of what it
// draws there is patched so its vertex shader carries the world position
// onto the sphere before the view takes it. Built-in materials have their
// projection chunks swapped (meshes, skinned and instanced included,
// points, lines, the shadow pass's depth material); sprites bend their
// center; a hand-written shader has its `modelViewMatrix * vec4(...)`
// rewritten. The patch is idempotent and chains whatever patch the
// material already carried.
//
// Every patched material reads one shared set of uniforms, the switch
// among them: the planet's renderer turns the bend on for its own draw
// and off again after it, so a material that also shows anywhere else (a
// portrait, the next 5v5 on the same page) draws there unbent.

import * as THREE from 'three';

// The shared uniforms: the chart's origin in world space, the sphere's
// radius, and the switch.
export const BEND_UNIFORMS = {
  colBendO: { value: new THREE.Vector3(0, 0, 0) },
  colBendR: { value: 80 },
  colBendOn: { value: 0 },
};

// The bend in GLSL, the twin of planet_chart.ts's bend and bendTurn, in
// world space about the chart's origin: the world is the scene's mirror of
// the chart, and the bend, a turn about the vertical, commutes with it.
export const BEND_GLSL = /* glsl */ `
uniform vec3 colBendO;
uniform float colBendR;
uniform float colBendOn;
vec3 colBend(vec3 w) {
  if (colBendOn < 0.5) return w;
  vec2 l = w.xz - colBendO.xz;
  float r = length(l);
  if (r < 1e-4) return w;
  float h = w.y - colBendO.y;
  float phi = r / colBendR;
  float s = (colBendR + h) * sin(phi) / r;
  float sh = sin(0.5 * phi);
  float y = h * cos(phi) - 2.0 * colBendR * sh * sh;
  return vec3(colBendO.x + l.x * s, colBendO.y + y, colBendO.z + l.y * s);
}
vec3 colBendDir(vec3 v, vec3 w) {
  if (colBendOn < 0.5) return v;
  vec2 l = w.xz - colBendO.xz;
  float r = length(l);
  if (r < 1e-4) return v;
  vec3 k = vec3(l.y / r, 0.0, -l.x / r);
  float phi = r / colBendR;
  float c = cos(phi);
  return v * c + cross(k, v) * sin(phi) + k * dot(k, v) * (1.0 - c);
}
vec4 colBendMV(vec4 p) {
  vec4 w = modelMatrix * p;
  w.xyz = colBend(w.xyz);
  return viewMatrix * w;
}
vec3 colBendOrigin() {
  vec4 o = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    o = instanceMatrix * o;
  #endif
  return (modelMatrix * o).xyz;
}
vec3 colBendView(vec3 n) {
  vec3 w = (vec4(n, 0.0) * viewMatrix).xyz;
  return (viewMatrix * vec4(colBendDir(w, colBendOrigin()), 0.0)).xyz;
}
`;

const PROJECT_BENT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelMatrix * mvPosition;
mvPosition.xyz = colBend( mvPosition.xyz );
mvPosition = viewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

const WORLDPOS_BENT = /* glsl */ `
#include <worldpos_vertex>
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  worldPosition.xyz = colBend( worldPosition.xyz );
#endif
`;

// The end of the parenthesized expression opening at `open`, or -1.
function closingParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// A hand-written shader's `modelViewMatrix * vec4(...)`, each one, through
// the bend.
function bendCustomProducts(src: string): string {
  const re = /modelViewMatrix\s*\*\s*vec4\s*\(/g;
  let out = '';
  let from = 0;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(src, open);
    if (close < 0) break;
    out += `${src.slice(from, m.index)}colBendMV(vec4${src.slice(open, close + 1)})`;
    from = close + 1;
    re.lastIndex = from;
  }
  return out + src.slice(from);
}

// A vertex shader's source with the bend in it: the definitions before
// main, the projection through the bend, the normals turned with it. Pure
// text, so the patch is testable without a GPU.
export function bendVertexShader(src: string): string {
  if (src.includes('colBend(')) return src;
  const main = src.indexOf('void main()');
  if (main < 0) return src;
  let body = src.slice(main);
  if (body.includes('#include <project_vertex>')) {
    body = body.replace('#include <project_vertex>', PROJECT_BENT);
  }
  if (body.includes('#include <worldpos_vertex>')) {
    body = body.replace('#include <worldpos_vertex>', WORLDPOS_BENT);
  }
  if (body.includes('#include <defaultnormal_vertex>')) {
    body = body.replace(
      '#include <defaultnormal_vertex>',
      '#include <defaultnormal_vertex>\ntransformedNormal = colBendView( transformedNormal );',
    );
  }
  // The sprite: its center through the bend, the quad laid in view space
  // around it as before.
  body = body.replace(
    /vec4\s+mvPosition\s*=\s*modelViewMatrix\s*\[\s*3\s*\]\s*;/,
    'vec4 mvPosition = colBendMV( vec4( 0.0, 0.0, 0.0, 1.0 ) );',
  );
  body = bendCustomProducts(body);
  return `${src.slice(0, main)}${BEND_GLSL}\n${body}`;
}

const bent = new WeakSet<THREE.Material>();

// Whether a material carries the bend.
export function isBent(material: THREE.Material): boolean {
  return bent.has(material);
}

// Patches one material, once: its own patch first, then the bend; the
// program cache keyed apart from the unbent twin.
export function bendMaterial(material: THREE.Material): void {
  if (bent.has(material)) return;
  bent.add(material);
  const before = material.onBeforeCompile;
  // A material keyed by its own rule keeps it; the default key is the
  // patch's own source, which is read now, before the bend replaces it.
  const own =
    material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey
      ? material.customProgramCacheKey
      : null;
  const beforeSource = before.toString();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.colBendO = BEND_UNIFORMS.colBendO;
    shader.uniforms.colBendR = BEND_UNIFORMS.colBendR;
    shader.uniforms.colBendOn = BEND_UNIFORMS.colBendOn;
    shader.vertexShader = bendVertexShader(shader.vertexShader);
  };
  material.customProgramCacheKey = () => `col-bend|${own ? own.call(material) : beforeSource}`;
  material.needsUpdate = true;
}

let depthMaterial: THREE.MeshDepthMaterial | null = null;

// The shadow pass's depth material, bent like the bodies that cast.
export function bentDepthMaterial(): THREE.MeshDepthMaterial {
  if (depthMaterial) return depthMaterial;
  depthMaterial = new THREE.MeshDepthMaterial();
  bendMaterial(depthMaterial);
  return depthMaterial;
}

// Bends everything under root that draws, skipping any subtree flagged
// userData.unbent (the planet, the sky): materials patched, frustum culling
// off (three culls by the unbent bounds, which would drop a body on the
// curve near the horizon), shadows cast through the bent depth material.
// Cheap to run every frame: what is done is skipped.
export function bendTree(root: THREE.Object3D): void {
  if (root.userData.unbent) return;
  const o = root as THREE.Mesh & { isSprite?: boolean; isPoints?: boolean; isLine?: boolean };
  if (o.isMesh || o.isSprite || o.isPoints || o.isLine) {
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m && !bent.has(m)) bendMaterial(m);
    o.frustumCulled = false;
    if (o.castShadow && o.isMesh && o.customDepthMaterial === undefined) {
      o.customDepthMaterial = bentDepthMaterial();
    }
  }
  for (const child of root.children) bendTree(child);
}
