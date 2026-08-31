// Forged champion models in the match itself: a runtime registry mapping a
// forged champion id to its generated GLB (served by the asset route) plus
// the display tuning saved from the workshop. The client registers models
// wherever it learns about them (drafts, gallery, match_start); the
// renderer then upgrades the procedural figure exactly like it does for
// roster champions. Fail-soft everywhere: an unknown id, a missing file, or
// a clipless model keeps the figure. Presentation only.

import type * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DisplayPropKind, ForgedDisplay } from '../../sim/forge/display';
import { type ChampionTemplate, measureScene, normalizeProp, toLambert } from './assets';
import { resolveForgedClips, stripTravel } from './forged_clips';
import type { ChampionClipNames, ChampionVisualDef } from './manifest';

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

function buildDef(entry: ForgedEntry, source: ForgedSource): ChampionVisualDef | null {
  const clips =
    pickedClips(entry.clips, new Set(source.clips.keys())) ??
    resolveForgedClips([...source.clips.keys()]);
  if (!clips) return null;
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
    ...(model && prop
      ? {
          props: [
            { url: model.url, size: model.size, bone: prop.bone, rot: prop.rot, pos: prop.pos },
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
    return;
  }
  entries.set(championId, {
    url: modelUrl,
    display: opts?.display ?? {},
    family: opts?.family ?? null,
    weaponUrl: opts?.weapon ?? null,
    clips: opts?.clips ?? null,
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
    const def = buildDef(entry, source);
    if (!def) return null;
    // The run cycle plays on the spot: the mover owns all translation.
    const run = source.clips.get(def.clips.run);
    if (run) stripTravel(run);
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
      props.set(p.url, normalizeProp(gltf.scene, p.size ?? 1, p.anchor));
    }
    const scale = def.height / source.rawHeight;
    entry.template = {
      def,
      scene: source.scene,
      clips: source.clips,
      scale,
      groundY: -source.minY * scale,
      props,
    };
  }
  return entry.template;
}
