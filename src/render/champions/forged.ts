// Forged champion models in the match itself: a runtime registry mapping a
// forged champion id to its generated GLB (served by the asset route) plus
// the display tuning saved from the workshop. The client registers models
// wherever it learns about them (drafts, gallery, match_start); the
// renderer then upgrades the procedural figure exactly like it does for
// roster champions. Fail-soft everywhere: an unknown id, a missing file, or
// a clipless model keeps the figure. Presentation only.

import type * as THREE from 'three';
import { Quaternion, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DisplayPropKind, ForgedDisplay } from '../../sim/forge/display';
import { type ChampionTemplate, measureScene, normalizeProp, toLambert } from './assets';
import {
  type RemovedTravel,
  resolveForgedClips,
  spellClipPicks,
  stripStanceLead,
  stripTravel,
} from './forged_clips';
import { houseDefaultClipFiles } from './house_set';
import type { ChampionClipNames, ChampionVisualDef } from './manifest';
import { orientLongAxisY } from './orient';

// Middle of the roster's height range (manifest heights run 1.6 to 3.6);
// the workshop's height slider overrides it per champion.
export const FORGED_DEFAULT_HEIGHT = 2.4;

// The loaded model, measured once; templates rebuild from it whenever the
// display tuning changes without re-fetching the file.
export interface ForgedSource {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  rawHeight: number;
  minY: number;
  boneNames: string[];
  // The facing fix measured from the run clip's removed travel (below);
  // zero until a traveling run has been stripped.
  travelYaw: number;
}

// Which clip objects already had their travel stripped, and what facing
// fix that first pass measured: stripping is in place, so whoever
// arrives second (the workshop and the match share cached clip-file
// objects) must read the stored measurement instead of measuring a
// clip that is already flat.
const strippedClips = new WeakSet<THREE.AnimationClip>();
const measuredRunYaw = new WeakMap<THREE.AnimationClip, number | null>();

// Strips the run clip's travel exactly once per clip object (rebasing
// it onto the idle stance), and returns the facing fix measured from
// the removed travel: null when the clip barely traveled. Safe to call
// from every template rebuild and from the workshop alike.
export function prepareForgedRun(
  scene: THREE.Object3D,
  run: THREE.AnimationClip,
  idle: THREE.AnimationClip | undefined,
  rawHeight: number,
): number | null {
  if (!strippedClips.has(run)) {
    strippedClips.add(run);
    const removed = stripTravel(run);
    if (idle && idle !== run) stripStanceLead(run, idle, removed);
    measuredRunYaw.set(run, travelYawFix(scene, removed, rawHeight * 0.15));
  }
  return measuredRunYaw.get(run) ?? null;
}

// The whole-model facing fix, measured and never guessed: a generated
// model arrives facing whatever axis its rig liked (a live probe showed
// rest facing world +X), and the run preset travels the way the body
// faces. So the direction stripTravel removed, taken to WORLD space
// through the traveling bone's parents, IS the model's forward; the yaw
// that rotates it onto +Z (the renderer's forward) makes the champion
// face where it moves, idle and run alike. Null when the clip barely
// traveled: nothing trustworthy to measure.
export function travelYawFix(
  scene: THREE.Object3D,
  removed: readonly RemovedTravel[],
  minTravel: number,
): number | null {
  scene.updateMatrixWorld(true);
  let best: { dir: THREE.Vector3; mag: number } | null = null;
  for (const r of removed) {
    const node = scene.getObjectByName(r.name.slice(0, r.name.lastIndexOf('.')));
    if (!node) continue;
    const v = new Vector3(r.drift[0], r.drift[1], r.drift[2]);
    if (node.parent) v.applyQuaternion(node.parent.getWorldQuaternion(new Quaternion()));
    const mag = Math.hypot(v.x, v.z);
    if (!best || mag > best.mag) best = { dir: v, mag };
  }
  if (!best || best.mag < minTravel) return null;
  return -Math.atan2(best.dir.x, best.dir.z);
}

interface ForgedEntry {
  url: string;
  display: ForgedDisplay;
  family: string | null;
  // The champion's own generated weapon GLB (asset-route URL), when built.
  weaponUrl: string | null;
  // The creator's exact clip pick per renderer role (the baked names);
  // null on models sealed before per-clip picks existed.
  clips: Record<string, string> | null;
  // Per-role animation-only GLBs (asset-route URLs) riding beside a
  // rigged model; null when the model file carries its clips itself.
  clipFiles: Record<string, string> | null;
  source: Promise<ForgedSource | null>;
  // Cache against the display used to build it; invalidated on re-register
  // with fresh tuning.
  template: ChampionTemplate | null;
}

const entries = new Map<string, ForgedEntry>();

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  // Generated GLBs carry plain textures (no KTX2), so the loader needs no
  // renderer handshake and can exist before the first canvas does.
  if (!loader) loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export function loadForgedSource(url: string): Promise<ForgedSource | null> {
  return gltfLoader()
    .loadAsync(url)
    .then((gltf) => {
      const scene = gltf.scene;
      const box = measureScene(scene);
      const rawHeight = Math.max(0.001, box.max.y - box.min.y);
      toLambert(scene, {});
      const boneNames: string[] = [];
      scene.traverse((child) => {
        if ((child as THREE.Bone).isBone) boneNames.push(child.name);
      });
      return {
        scene,
        clips: new Map(gltf.animations.map((c) => [c.name, c])),
        rawHeight,
        minY: box.min.y,
        boneNames,
        travelYaw: 0,
      };
    })
    .catch((err) => {
      console.warn(`forged model failed to load (${url}), keeping figure:`, err);
      return null;
    });
}

// The hand bone the workshop suggests when the creator picks a weapon:
// right hand first, any hand second. Rig naming varies per provider
// ("R_Hand", "RightHand", "hand.r").
export function guessHandBone(boneNames: readonly string[]): string | null {
  const right = boneNames.find((n) => /r[_.]?hand|righthand|hand[_.]?r\b/i.test(n));
  if (right) return right;
  return boneNames.find((n) => /hand/i.test(n)) ?? null;
}

// Animation-only clip files, fetched once per URL and shared by every
// template rebuild (the files are job-numbered, so a URL's content never
// changes). Returns the clips named as baked; when a picked name is
// missing from its file, the file's first clip stands in under the
// picked name, so a provider spelling surprise degrades to the right
// motion instead of a frozen champion.
const clipFileCache = new Map<string, Promise<THREE.AnimationClip[] | null>>();

export async function loadForgedClipFiles(
  files: Record<string, string>,
  picked: Record<string, string> | null,
): Promise<THREE.AnimationClip[]> {
  const byUrl = new Map<string, string[]>();
  for (const [role, url] of Object.entries(files)) {
    byUrl.set(url, [...(byUrl.get(url) ?? []), role]);
  }
  const out: THREE.AnimationClip[] = [];
  for (const [url, roles] of byUrl) {
    let cached = clipFileCache.get(url);
    if (!cached) {
      cached = gltfLoader()
        .loadAsync(url)
        .then((g) => g.animations)
        .catch((err) => {
          console.warn(`forged clip file failed to load (${url}):`, err);
          return null;
        });
      clipFileCache.set(url, cached);
    }
    const anims = await cached;
    if (!anims || anims.length === 0) continue;
    out.push(...anims);
    for (const role of roles) {
      const want = picked?.[role];
      const first = anims[0];
      if (want === undefined || first === undefined || anims.some((a) => a.name === want)) continue;
      const alias = first.clone();
      alias.name = want;
      out.push(alias);
    }
  }
  return out;
}

// The house weapon library: the roster's own generated 3D weapon models
// (CREDITS.md), the only props a forged champion may wear besides its own
// generated weapon. Base size is for the default height and scales with
// the champion; bounding-box centering (no 'origin' anchor) so the grip
// sliders do the placing on whatever rig this is.
export const FORGED_PROP_MODELS: Readonly<
  Partial<Record<DisplayPropKind, { url: string; size: number }>>
> = {
  maul: { url: '/models/champions/korrath_maul.glb', size: 1.95 },
  shield: { url: '/models/champions/korrath_shield.glb', size: 1.55 },
  rifle: { url: '/models/champions/vesk_rifle.glb', size: 2.6 },
};

// Resolves a saved prop kind to the GLB it wears: a house weapon from the
// table, or the champion's own generated weapon file. Null hides it.
export function forgedPropModel(
  kind: DisplayPropKind,
  height: number,
  weaponUrl: string | null,
): { url: string; size: number } | null {
  if (kind === 'generated') {
    return weaponUrl ? { url: weaponUrl, size: 1.7 * (height / FORGED_DEFAULT_HEIGHT) } : null;
  }
  const house = FORGED_PROP_MODELS[kind];
  return house ? { url: house.url, size: house.size * (height / FORGED_DEFAULT_HEIGHT) } : null;
}

// The creator picked every clip by name: play EXACTLY those when the file
// carries them, and only fall back to name matching for models sealed
// before per-clip picks existed (or a mapping the file cannot honor).
function pickedClips(
  picked: Record<string, string> | null,
  available: ReadonlySet<string>,
): ChampionClipNames | null {
  if (!picked) return null;
  const has = (n: string | undefined): n is string => n !== undefined && available.has(n);
  const { idle, run, attack, cast, death } = picked;
  if (!has(idle) || !has(run) || !has(attack) || !has(cast) || !has(death)) return null;
  return { idle, run, attack, cast, windup: cast, death };
}

function buildDef(entry: ForgedEntry, clipNames: ReadonlySet<string>): ChampionVisualDef | null {
  const clips = pickedClips(entry.clips, clipNames) ?? resolveForgedClips([...clipNames]);
  if (!clips) return null;
  const spellClips = spellClipPicks(entry.clips, clipNames);
  const d = entry.display;
  const height = d.height ?? FORGED_DEFAULT_HEIGHT;
  // Only the creator's saved prop shows: no silent default weapon
  // (playtest: the family fallback read as clutter, not as a gift).
  const prop = d.prop;
  const model =
    prop && prop.kind !== 'none' && prop.bone !== ''
      ? forgedPropModel(prop.kind, height, entry.weaponUrl)
      : null;
  return {
    url: entry.url,
    height,
    barY: height + 0.7,
    ...(d.yOffset !== undefined ? { yOffset: d.yOffset } : {}),
    ...(d.yawOffset !== undefined ? { yawOffset: d.yawOffset } : {}),
    clips,
    ...(spellClips ? { spellClips } : {}),
    ...(model && prop
      ? {
          props: [
            {
              url: model.url,
              // The workshop's uniform size multiplier folds into the
              // normalized span so the muzzle tip (size/2) stays true.
              size: model.size * (prop.scale ?? 1),
              bone: prop.bone,
              rot: prop.rot,
              pos: prop.pos,
            },
          ],
        }
      : {}),
  };
}

// Announces a forged champion's model to the renderer. Idempotent; calling
// again with fresh display tuning rebuilds the next template. The url is
// the full asset-route path (the caller owns the prefix).
export function registerForgedModel(
  championId: string,
  modelUrl: string,
  opts?: {
    display?: ForgedDisplay | null;
    family?: string | null;
    weapon?: string | null;
    clips?: Record<string, string> | null;
    clipFiles?: Record<string, string> | null;
  },
): void {
  const existing = entries.get(championId);
  if (existing && existing.url === modelUrl) {
    if (opts?.display !== undefined) {
      existing.display = opts.display ?? {};
      existing.template = null;
    }
    if (opts?.family !== undefined) existing.family = opts.family;
    if (opts?.weapon !== undefined && existing.weaponUrl !== (opts.weapon ?? null)) {
      existing.weaponUrl = opts.weapon ?? null;
      existing.template = null;
    }
    if (opts?.clips !== undefined) {
      existing.clips = opts.clips ?? null;
      existing.template = null;
    }
    if (opts?.clipFiles !== undefined) {
      const next = opts.clipFiles ?? null;
      if (JSON.stringify(existing.clipFiles) !== JSON.stringify(next)) {
        existing.clipFiles = next;
        existing.template = null;
      }
    }
    return;
  }
  entries.set(championId, {
    url: modelUrl,
    display: opts?.display ?? {},
    family: opts?.family ?? null,
    weaponUrl: opts?.weapon ?? null,
    clips: opts?.clips ?? null,
    clipFiles: opts?.clipFiles ?? null,
    source: loadForgedSource(modelUrl),
    template: null,
  });
}

// Sync lookup for the renderer's spawn path: the health-bar height, known
// as soon as the champion is registered (before the model finishes
// loading). Null for anything that is not a registered forged champion.
export function forgedBarY(championId: string | null): number | null {
  if (!championId) return null;
  const entry = entries.get(championId);
  if (!entry) return null;
  return (entry.display.height ?? FORGED_DEFAULT_HEIGHT) + 0.7;
}

// Resolves the champion's template once its model is loaded; templates are
// rebuilt lazily after a display change. Null when unregistered or failed.
export async function forgedChampionTemplate(
  championId: string | null,
): Promise<ChampionTemplate | null> {
  if (!championId) return null;
  const entry = entries.get(championId);
  if (!entry) return null;
  const source = await entry.source;
  if (!source) return null;
  if (!entry.template) {
    // The playable clip set: the model's own animations plus the
    // per-role clip files when the champion bakes per clip (the rigged
    // body itself carries none).
    const clips = new Map(source.clips);
    if (entry.clipFiles) {
      for (const clip of await loadForgedClipFiles(entry.clipFiles, entry.clips)) {
        clips.set(clip.name, clip);
      }
    }
    // A rigged champion that has baked nothing borrows the house set
    // (house_set.ts): it costs nothing, it ships with the client, and a
    // model that is paid for should be seen playing before its creator
    // has chosen five animations. Its own bake replaces this whole.
    if (clips.size === 0) {
      for (const clip of await loadForgedClipFiles(houseDefaultClipFiles(entry.family), null)) {
        clips.set(clip.name, clip);
      }
    }
    const def = buildDef(entry, new Set(clips.keys()));
    if (!def) return null;
    // The run cycle plays on the spot (the mover owns all translation),
    // and the direction it traveled reveals the model's true forward:
    // the whole model turns so that direction lands on the renderer's
    // +Z, on top of whatever facing the creator tuned.
    const run = clips.get(def.clips.run);
    if (run) {
      const fix = prepareForgedRun(source.scene, run, clips.get(def.clips.idle), source.rawHeight);
      if (fix !== null) source.travelYaw = fix;
    }
    if (source.travelYaw !== 0) def.yawOffset = (def.yawOffset ?? 0) + source.travelYaw;
    // The weapon GLB (house library or the champion's own) loads
    // alongside; a failure leaves the hand empty, never blocks the model.
    const props = new Map<string, THREE.Group>();
    for (const p of def.props ?? []) {
      if (p.url === undefined) continue;
      const gltf = await gltfLoader()
        .loadAsync(p.url)
        .catch(() => null);
      if (!gltf) continue;
      toLambert(gltf.scene, {});
      // Long axis up before the wrap, so the match reads the same axes
      // the creator tuned against in the workshop (orient.ts).
      const oriented = orientLongAxisY(gltf.scene) as THREE.Group;
      props.set(p.url, normalizeProp(oriented, p.size ?? 1, p.anchor));
    }
    const scale = def.height / source.rawHeight;
    entry.template = {
      def,
      scene: source.scene,
      clips,
      scale,
      groundY: -source.minY * scale,
      props,
    };
  }
  return entry.template;
}
