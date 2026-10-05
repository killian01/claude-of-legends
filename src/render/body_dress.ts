// How the match dresses a unit's body once its mesh is built: the one
// decision the live bodies (the renderer's buildBody, as a unit comes into
// sight) and the fights' warm-up samples (warm_samples.ts) both go
// through, since what it decides picks the shader programs the body draws
// with. Every Lambert material turns toon (toon.ts) unless the terrain
// authored the body, and a champion's body on the planet wears its
// silhouette twins (planet_ghost.ts). A sample dressed otherwise than the
// live body it stands for links programs nothing draws with and leaves the
// live one to link its own mid-fight: the warm-up's samples once kept
// their Lambert materials while every live body wore toon ones.

import * as THREE from 'three';
import type { Unit, UnitKind } from '../sim/unit';
import { toonifyMaterials } from './toon';

// What a sample of the fights' warm-up hands the body builder: no seat,
// no team, nowhere, with the sample's kind and look on top.
const WARM_UNIT = { id: -1, team: -1, pos: { x: 0, z: 0 } };

export function warmUnit(sample: Partial<Unit>): Unit {
  return { ...WARM_UNIT, ...sample } as unknown as Unit;
}

export interface BodyDress {
  // Lambert materials turned toon.
  toon: boolean;
  // The silhouette twins, seen through what hides the body.
  ghosts: boolean;
}

// Where a body is dressed: whether the terrain authored it (a structure
// of the map's own, drawn as exported), and whether the match is the
// planet's.
export interface BodyPlace {
  authored: boolean;
  planet: boolean;
}

export function bodyDress(kind: UnitKind, place: BodyPlace): BodyDress {
  return {
    toon: !place.authored,
    ghosts: place.planet && !place.authored && kind === 'champion',
  };
}

// Dresses `body` the way `dress` says. `ghost` attaches the silhouette
// twins: the renderer's, which holds their one material per body.
export function dressBody(
  body: THREE.Object3D,
  dress: BodyDress,
  ghost: (body: THREE.Object3D) => void,
): void {
  if (dress.toon) toonifyMaterials(body);
  if (dress.ghosts) ghost(body);
}

const SIDES: Readonly<Record<number, string>> = {
  [THREE.FrontSide]: 'front',
  [THREE.BackSide]: 'back',
  [THREE.DoubleSide]: 'double',
};

let plainKey: string | null = null;

// What of a body's materials picks its shader programs, as three keys a
// program (WebGLPrograms): each material's kind, its side, whether it is
// see-through and how it blends, its vertex colors, its maps and ramp,
// flat shading, fog and tone mapping, a custom key, and its mesh's
// skinning and instance colors. One line per distinct setup, sorted: two
// bodies with the same lines link the same programs.
export function programPicks(root: THREE.Object3D): string[] {
  plainKey ??= new THREE.MeshBasicMaterial().customProgramCacheKey();
  const out = new Set<string>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const instanced = mesh as THREE.InstancedMesh;
    const skinned = mesh as THREE.SkinnedMesh;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      const lit = m as THREE.Material & {
        map?: THREE.Texture | null;
        emissiveMap?: THREE.Texture | null;
        gradientMap?: THREE.Texture | null;
        flatShading?: boolean;
        fog?: boolean;
      };
      const key = m.customProgramCacheKey();
      const parts = [
        m.type,
        SIDES[m.side] ?? `side ${m.side}`,
        m.transparent ? 'transparent' : 'opaque',
        m.blending !== THREE.NormalBlending ? `blending ${m.blending}` : '',
        m.vertexColors ? 'vertex colors' : '',
        instanced.isInstancedMesh
          ? instanced.instanceColor
            ? 'instance colors'
            : 'instanced'
          : '',
        skinned.isSkinnedMesh ? 'skinned' : '',
        lit.map ? 'map' : '',
        lit.emissiveMap ? 'emissive map' : '',
        lit.gradientMap ? 'ramp' : '',
        lit.flatShading ? 'flat' : '',
        m.alphaTest > 0 ? 'alpha test' : '',
        lit.fog === false ? 'no fog' : '',
        m.toneMapped ? '' : 'not tone mapped',
        key !== plainKey ? `key ${key}` : '',
      ];
      out.add(parts.filter((p) => p !== '').join(', '));
    }
  });
  return [...out].sort();
}
