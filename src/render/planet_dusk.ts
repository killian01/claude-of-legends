// The planet's ground shading (ADR 0031): the Dusk and the fog of war,
// painted by the ground itself rather than by sheets laid over it. Outside
// the lit cap the ground falls into a cold blue night, a warm rim glows
// along the edge of the light, and the cap the current phase closes to is
// a thin golden line; where the viewer has no sight the ground darkens as
// the fog canvas says (renderer.ts paintFog, through the chart window).
// One patch on every material of the planet's model, all reading one
// shared set of uniforms the stage updates each frame. It shades the
// final, tone-mapped color, as the 5v5's fog sheet darkens what is under
// it: before the tone mapping, a lit ground darkened by half came out of
// the curve barely darker.

import * as THREE from 'three';

export const DUSK_UNIFORMS = {
  // The planet's world matrix inverted: world positions back to sphere
  // coordinates, where the caps are.
  colPlanetInv: { value: new THREE.Matrix4() },
  // The lit cap: its center's unit direction and the cosine of its
  // angular radius; off before the match has a Dusk.
  colDuskOn: { value: 0 },
  colDuskDir: { value: new THREE.Vector3(0, 1, 0) },
  colDuskAngle: { value: Math.PI },
  // The cap the phase closes to.
  colNextOn: { value: 0 },
  colNextDir: { value: new THREE.Vector3(0, 1, 0) },
  colNextAngle: { value: Math.PI },
  colRadius: { value: 80 },
  colTime: { value: 0 },
  // The fog canvas over the chart window: the window's size and the
  // chart's origin in world space (planet_chart.ts, chart_world.ts).
  colFogOn: { value: 0 },
  colFogMap: { value: null as THREE.Texture | null },
  colFogSize: { value: 200 },
  colChartO: { value: new THREE.Vector3(100, 0, 100) },
};

// A cap's angular radius from its chord radius on the sphere.
export function capAngle(chord: number, radius: number): number {
  const k = chord / (2 * radius);
  return k >= 1 ? Math.PI : 2 * Math.asin(Math.max(0, k));
}

const VERTEX_PARS = /* glsl */ `
uniform mat4 colPlanetInv;
varying vec3 vColSphere;
varying vec3 vColWorld;
`;

const VERTEX_BODY = /* glsl */ `
{
  vec4 colW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    colW = instanceMatrix * colW;
  #endif
  colW = modelMatrix * colW;
  vColWorld = colW.xyz;
  vColSphere = ( colPlanetInv * colW ).xyz;
}
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float colDuskOn;
uniform vec3 colDuskDir;
uniform float colDuskAngle;
uniform float colNextOn;
uniform vec3 colNextDir;
uniform float colNextAngle;
uniform float colRadius;
uniform float colTime;
uniform float colFogOn;
uniform sampler2D colFogMap;
uniform float colFogSize;
uniform vec3 colChartO;
varying vec3 vColSphere;
varying vec3 vColWorld;
`;

const FRAGMENT_BODY = /* glsl */ `
{
  vec3 colDir = normalize( vColSphere );
  // The fog of war: the chart point of this fragment, read on the canvas.
  if ( colFogOn > 0.5 ) {
    vec3 d = vColWorld - vec3( colChartO.x, colChartO.y - colRadius, colChartO.z );
    float r = length( d.xz );
    float arc = colRadius * atan( r, d.y );
    vec2 l = r > 1e-4 ? d.xz / r * arc : vec2( 0.0 );
    vec2 uv = vec2( 0.5 + l.x / colFogSize, 0.5 + l.y / colFogSize );
    float fog = texture2D( colFogMap, clamp( uv, 0.0, 1.0 ) ).a;
    gl_FragColor.rgb *= 1.0 - fog;
  }
  if ( colDuskOn > 0.5 ) {
    // Meters past the edge of the light, along the ground.
    float past = ( acos( clamp( dot( colDir, colDuskDir ), -1.0, 1.0 ) ) - colDuskAngle ) * colRadius;
    float night = smoothstep( -0.6, 3.0, past );
    vec3 cold = gl_FragColor.rgb * vec3( 0.2, 0.26, 0.5 ) + vec3( 0.012, 0.02, 0.07 );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, cold, night );
    // The warm rim: brightest just outside the light, a slow breath.
    float rim = exp( -abs( past - 0.5 ) / 0.75 ) * ( 0.85 + 0.15 * sin( colTime * 2.2 ) );
    gl_FragColor.rgb += vec3( 1.0, 0.46, 0.14 ) * rim * 0.75;
    // Embers drifting in the night just past the rim.
    float band = smoothstep( 0.0, 1.5, past ) * ( 1.0 - smoothstep( 1.5, 9.0, past ) );
    gl_FragColor.rgb += vec3( 0.55, 0.2, 0.06 ) * band * 0.18;
  }
  if ( colNextOn > 0.5 ) {
    float edge = abs( acos( clamp( dot( colDir, colNextDir ), -1.0, 1.0 ) ) - colNextAngle ) * colRadius;
    float line = 1.0 - smoothstep( 0.12, 0.32, edge );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 1.0, 0.84, 0.36 ), line * 0.85 );
  }
}
`;

const patched = new WeakSet<THREE.Material>();

// Gives a planet material the Dusk and the fog, once.
export function duskMaterial(material: THREE.Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    for (const [name, uniform] of Object.entries(DUSK_UNIFORMS)) shader.uniforms[name] = uniform;
    if (!shader.vertexShader.includes('#include <project_vertex>')) return;
    if (!shader.fragmentShader.includes('#include <colorspace_fragment>')) return;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERTEX_PARS}\nvoid main() {`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRAGMENT_PARS}\nvoid main() {`)
      .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>\n${FRAGMENT_BODY}`);
  };
  material.customProgramCacheKey = () => 'col-dusk';
  material.needsUpdate = true;
}

// Every material of a model, patched.
export function duskTree(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.noDusk) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      duskMaterial(m);
      out.push(m);
    }
  });
  return out;
}
