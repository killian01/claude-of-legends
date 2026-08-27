// GLB loading for champion visuals: one template per champion (parsed scene,
// normalization transform, clips, Lambert-converted materials), cloned per
// on-screen champion. Loading is async and fail-soft: until a template is
// ready (or if it never loads) the caller keeps the procedural figure, so a
// missing file degrades the look and never the match. Presentation only.

import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { skinOf } from '../../sim/content/skins';
import { CHAMPION_VISUALS, type ChampionVisualDef } from './manifest';
import { buildChampionProp } from './props';

export interface ChampionTemplate {
  def: ChampionVisualDef;
  scene: THREE.Group;
  clips: ReadonlyMap<string, THREE.AnimationClip>;
  // Uniform scale that brings the model to def.height, and the lift that
  // puts its feet on y = 0 after scaling.
  scale: number;
  groundY: number;
}

const templates = new Map<string, ChampionTemplate>();
const pending = new Map<string, Promise<ChampionTemplate | null>>();

// True model bounds in scene space. Box3.setFromObject reads raw geometry
// bounds, and these GLBs are meshopt-quantized: every primitive lives in its
// own integer range, and only the skinning path (bind matrices) carries the
// dequantization. SkinnedMesh.computeBoundingBox applies the bone transform
// per vertex, which lands in the mesh's local space; regular meshes keep the
// plain expand.
function measureScene(scene: THREE.Object3D): THREE.Box3 {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const sub = new THREE.Box3();
  scene.traverse((child) => {
    const skinned = child as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.computeBoundingBox();
      if (skinned.boundingBox) {
        sub.copy(skinned.boundingBox).applyMatrix4(skinned.matrixWorld);
        box.union(sub);
      }
    } else if ((child as THREE.Mesh).isMesh) {
      box.expandByObject(child);
    }
  });
  return box;
}

// Rebuilds every material as MeshLambertMaterial: it matches the flat-lit
// map dressing, and the renderer's hit-flash path only drives Lambert
// emissives. Applies the def's recolor/tint/opacity while it walks.
function toLambert(scene: THREE.Group, def: ChampionVisualDef): void {
  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (
      !(mesh as { isMesh?: boolean }).isMesh &&
      !(mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh
    )
      return;
    const convert = (mat: THREE.Material): THREE.Material => {
      const src = mat as THREE.MeshStandardMaterial;
      const out = new THREE.MeshLambertMaterial({
        color: src.color?.clone() ?? new THREE.Color(0xffffff),
        map: src.map ?? null,
        vertexColors: src.vertexColors ?? false,
      });
      out.name = mat.name;
      const recolor = def.recolor?.[mat.name];
      if (recolor !== undefined) out.color.setHex(recolor);
      if (def.tint !== undefined) out.color.multiply(new THREE.Color(def.tint));
      if (def.opacity !== undefined && def.opacity < 1) {
        out.transparent = true;
        out.opacity = def.opacity;
      }
      mat.dispose();
      return out;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
}

// Root-level nodes whose rotation tracks some rigs bake per clip; see the
// manifest's stripRootRotation flag.
const ROOT_TRACK_NODES = new Set([
  'RootNode',
  'Root',
  'Armature',
  'CharacterArmature',
  'EnemyArmature',
]);

function stripRootRotation(clip: THREE.AnimationClip, def: ChampionVisualDef): THREE.AnimationClip {
  if (!def.stripRootRotation) return clip;
  const tracks = clip.tracks.filter((t) => {
    const dot = t.name.lastIndexOf('.');
    const node = t.name.slice(0, dot);
    const prop = t.name.slice(dot + 1);
    return !(prop === 'quaternion' && ROOT_TRACK_NODES.has(node));
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// Loader init needs the live WebGLRenderer (KTX2 support detection), so the
// renderer calls this once from its constructor and every champion GLB
// starts loading immediately.
export function preloadChampionAssets(renderer: THREE.WebGLRenderer): void {
  if (pending.size > 0) return;
  const ktx2 = new KTX2Loader().setTranscoderPath('/vendor/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  for (const [championId, def] of Object.entries(CHAMPION_VISUALS)) {
    const promise = loader
      .loadAsync(def.url)
      .then((gltf) => {
        const scene = gltf.scene;
        const box = measureScene(scene);
        const height = Math.max(0.001, box.max.y - box.min.y);
        const scale = def.height / height;
        toLambert(scene, def);
        const clips = new Map(
          gltf.animations.map((clip) => [clip.name, stripRootRotation(clip, def)]),
        );
        const template: ChampionTemplate = {
          def,
          scene,
          clips,
          scale,
          groundY: -box.min.y * scale,
        };
        templates.set(championId, template);
        return template;
      })
      .catch((err) => {
        console.warn(`champion visual ${championId} failed to load, keeping figure:`, err);
        return null;
      });
    pending.set(championId, promise);
  }
}

// Resolves once the champion's template is loaded; null when there is no def
// for the champion or its asset failed. Safe to call before preload.
export function whenChampionTemplateReady(
  championId: string | null,
): Promise<ChampionTemplate | null> {
  if (!championId) return Promise.resolve(null);
  return pending.get(championId) ?? Promise.resolve(templates.get(championId) ?? null);
}

// GLTFLoader sanitizes node names ("handslot.r" arrives as "handslotr");
// resolve a manifest bone name against both spellings.
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/[^\w-]/g, '')) ?? null;
}

// A signature prop riding a rig bone. The prop lives OUTSIDE the bone
// hierarchy (a unit-scale holder under the visual root) and copies the
// bone's world pose every frame: these rigs bake quantization compensation
// into their bone scales, so a direct child would inherit arbitrary sizing.
// restInv is the inverse of the bone's root-space rest orientation, captured
// once the idle pose has settled; until then only position syncs.
export interface PropAnchor {
  bone: THREE.Object3D;
  holder: THREE.Group;
  restInv: THREE.Quaternion | null;
}

// Snaps every prop anchor to its bone's current world pose, expressed in
// root space. Position always follows; rotation follows as a DELTA from the
// captured rest orientation, so the manifest's authored prop pose is exact
// at rest and the weapon swings with the hand during attack clips (before
// this, a horizontal slice dragged a still-vertical blade through the body).
// captureRest arms the one-time rest capture; portraits stay position-only.
const ANCHOR_POS = new THREE.Vector3();
const ROOT_QUAT_INV = new THREE.Quaternion();
const BONE_QUAT = new THREE.Quaternion();
export function syncPropAnchors(
  root: THREE.Object3D,
  anchors: readonly PropAnchor[],
  captureRest = false,
): void {
  root.getWorldQuaternion(ROOT_QUAT_INV).invert();
  for (const a of anchors) {
    a.bone.getWorldPosition(ANCHOR_POS);
    a.holder.position.copy(root.worldToLocal(ANCHOR_POS));
    a.bone.getWorldQuaternion(BONE_QUAT).premultiply(ROOT_QUAT_INV);
    if (a.restInv === null) {
      if (captureRest) a.restInv = BONE_QUAT.clone().invert();
      continue;
    }
    a.holder.quaternion.copy(BONE_QUAT).multiply(a.restInv);
  }
}

// Clones the template into a ready-to-mount rig: grounded, scaled, skinned
// with per-instance materials (team cape tint, accent glows), props on their
// bone anchors. The returned root carries the clone the mixer should bind to.
export function instantiateChampion(
  championId: string,
  template: ChampionTemplate,
  teamColor: number,
  skin: number,
  options?: { ring?: boolean },
): { root: THREE.Group; rig: THREE.Object3D; anchors: PropAnchor[] } {
  const def = template.def;
  const palette = skinOf(championId, skin);
  const bodyTint = palette.body ?? teamColor;
  const rig = cloneRig(template.scene);
  rig.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    // Geometry is the template's, shared across every clone; materials are
    // per-instance so hit flashes and tints never leak between champions.
    mesh.userData.sharedGeo = true;
    const own = (mat: THREE.Material): THREE.Material => mat.clone();
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    if (def.hide?.includes(mesh.name)) mesh.visible = false;
    const mat = mesh.material as THREE.MeshLambertMaterial;
    if (def.teamMeshes?.includes(mesh.name) && mat.isMeshLambertMaterial) {
      mat.color.setHex(bodyTint);
    }
    if (def.accentGlowMeshes?.includes(mesh.name) && mat.isMeshLambertMaterial) {
      mat.emissive.setHex(palette.accent);
      mat.emissiveIntensity = 0.9;
    }
  });
  rig.scale.setScalar(template.scale);
  rig.position.y = template.groundY + (def.yOffset ?? 0);
  const root = new THREE.Group();
  // The yaw correction wraps the rig instead of touching rig.rotation:
  // several GLB scene roots carry their own authored rotation that a plain
  // assignment would silently overwrite.
  const yawed = new THREE.Group();
  yawed.rotation.y = def.yawOffset ?? 0;
  yawed.add(rig);
  root.add(yawed);
  const anchors: PropAnchor[] = [];
  for (const propDef of def.props ?? []) {
    const bone = findBone(rig, propDef.bone);
    if (!bone) continue;
    const holder = new THREE.Group();
    const prop = buildChampionProp(propDef.kind, palette.accent);
    // The pose is authored in the manifest, relative to the champion's
    // facing; the anchor follows the bone's position, plus its rotation
    // delta once syncPropAnchors has captured the rest orientation.
    if (propDef.rot) prop.rotation.set(propDef.rot[0], propDef.rot[1], propDef.rot[2]);
    if (propDef.pos) prop.position.set(propDef.pos[0], propDef.pos[1], propDef.pos[2]);
    holder.add(prop);
    root.add(holder);
    anchors.push({ bone, holder, restInv: null });
  }
  // Team allegiance survives any skin or model: a colored ring at the feet,
  // sized to the silhouette so a colossus is claimed as loudly as a goblin.
  // Portraits opt out; there is no team to read there.
  if (options?.ring !== false) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.35 * def.height, 0.07, 6, 24),
      new THREE.MeshLambertMaterial({ color: teamColor }),
    );
    ring.position.y = 0.12;
    ring.rotation.x = Math.PI / 2;
    root.add(ring);
  }
  return { root, rig, anchors };
}
