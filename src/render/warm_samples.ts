// One of everything a fight can put on the planet, built off screen so its
// shader programs link before it first appears (program_warmup.ts links
// what the stage holds at its start; program_keeper.ts keeps every program
// once linked). Without it, the first cast of each spell, the first Rising
// and the first champion of each kind seen link their programs in the
// frame they appear: a stall of a second or more on a phone, mid-fight.
// The samples go into a scene of their own with a VFX system of its own,
// are compiled against the planet's scene (its lights, its fog) and then
// released: nothing of them is ever drawn.

import * as THREE from 'three';
import type { CampKind } from '../sim/content/camps';
import type { CreatureId } from '../sim/content/rings';
import type { SchoolColors, SpellVisual } from './vfx/catalog';
import type { VfxSystem } from './vfx/system';

// A sample's colors: what the color is does not change the program.
const SAMPLE_COLORS: SchoolColors = { main: 0x9a6cf0, glow: 0xcdb2ff };
const RADIUS = 3;
// The ages a zone is ticked at: its opening, its middle and its fade, each
// of which can set its materials apart (a layer turned see-through), so
// each is compiled.
const ZONE_AGES_MS = [0, 600, 2400] as const;

// Runs one hook, a failure kept to itself: a sample that cannot be built
// only leaves its programs to link when the real thing first shows.
function tryHook(run: () => void): void {
  try {
    run();
  } catch {
    // The warm-up is a nicety; the match goes on without it.
  }
}

// Builds every piece of one spell's art: its projectile, its zone (a foe's
// and a friend's, ticked through its life), its shield and every burst it
// fires into `fx`. `add` puts a built object in the samples' scene;
// `settle` compiles what stands, after each age of a zone.
export function sampleSpellArt(
  vis: SpellVisual,
  fx: VfxSystem,
  add: (object: THREE.Object3D) => void,
  settle: () => void = () => undefined,
): void {
  const c = SAMPLE_COLORS;
  tryHook(() => {
    if (!vis.projectile) return;
    const holder = vis.projectile(0.5, c);
    add(holder);
    vis.projectileTick?.(fx, 0, 0, 16, c, 0, holder);
  });
  for (const hostile of [true, false]) {
    tryHook(() => {
      if (!vis.zone) return;
      const holder = vis.zone(RADIUS, c, hostile);
      add(holder);
      for (const age of ZONE_AGES_MS) {
        vis.zoneTick?.(fx, holder, 0, 0, RADIUS, age, c, 16);
        settle();
      }
    });
  }
  tryHook(() => {
    if (!vis.shield) return;
    const holder = vis.shield();
    add(holder);
    vis.shieldTick?.(holder, 300, 1500);
  });
  tryHook(() => vis.impact?.(fx, 0, 0, c));
  tryHook(() => vis.castFx?.(fx, 0, 0, 0, 1, c, 0, 0));
  tryHook(() => vis.detonate?.(fx, 0, 0, RADIUS, c));
  tryHook(() => vis.windupTick?.(fx, 0, 0, 0.5, c, 16));
  tryHook(() => vis.release?.(fx, 0, 0, 2, 2, c));
  tryHook(() => vis.shieldEnd?.(fx, 0, 0));
}

// The bodies a planet match can show besides its champions, as the
// renderer's unit builder reads them: each Rising and its Ascendant, the
// Warden, and each camp.
export interface WarmBody {
  kind: 'creature' | 'warden' | 'camp';
  creatureId?: CreatureId;
  ascendant?: boolean;
  campKind?: CampKind;
}

export const WARM_BODIES: readonly WarmBody[] = [
  { kind: 'creature', creatureId: 'pyrefang' },
  { kind: 'creature', creatureId: 'pyrefang', ascendant: true },
  { kind: 'creature', creatureId: 'voidmaul' },
  { kind: 'creature', creatureId: 'voidmaul', ascendant: true },
  { kind: 'warden' },
  { kind: 'camp', campKind: 'spinecrest' },
  { kind: 'camp', campKind: 'brackenlings' },
  { kind: 'camp', campKind: 'barkmaw' },
];

// Runs the steps one at a time, waiting on `next` between them, so no
// single frame pays for the whole warm-up; stops early once `stop` says so
// (the match went).
export async function runSteps(
  steps: readonly (() => void)[],
  next: () => Promise<void>,
  stop: () => boolean,
): Promise<number> {
  let ran = 0;
  for (const step of steps) {
    if (stop()) break;
    tryHook(step);
    ran++;
    await next();
  }
  return ran;
}

// What the warm-up needs of the renderer: the planet's compile (bent, then
// linked against the planet's scene, then kept), its unit and champion
// builders, the art to sample, a VFX system for the samples' scene, the
// effect files to wait for, the pause between steps, and whether the
// match is gone.
export interface FightWarmHost {
  compile(scene: THREE.Scene): void;
  body(body: WarmBody): THREE.Object3D | null;
  champion(id: string): { root: THREE.Object3D; dispose(): void } | null;
  championIds: readonly string[];
  catalog: readonly SpellVisual[];
  makeFx(scene: THREE.Scene): VfxSystem;
  preload(): Promise<unknown>;
  next(): Promise<void>;
  gone(): boolean;
}

// The ages a sample's bursts are compiled at again, once their delayed
// beats have fired and their timed pieces have moved on.
const LATER_MS = 450;

// Builds, compiles and releases every sample, one spell, one body or one
// champion a step. Returns how many steps ran.
export async function warmFights(host: FightWarmHost): Promise<number> {
  await host.preload();
  if (host.gone()) return 0;
  const scene = new THREE.Scene();
  const fx = host.makeFx(scene);
  // The samples' own lights would count as more lights than the planet
  // has: hidden, the programs see the planet's.
  for (const light of fx.pooledLights()) light.visible = false;
  const steps: (() => void)[] = [];
  // A step builds its samples through `add`, and hands `after` whatever
  // must be let go once they are released.
  type Build = (add: (o: THREE.Object3D) => void, after: (release: () => void) => void) => void;
  const step = (build: Build): void => {
    steps.push(() => {
      const built: THREE.Object3D[] = [];
      const releases: (() => void)[] = [];
      try {
        build(
          (o) => {
            built.push(o);
            scene.add(o);
          },
          (release) => releases.push(release),
        );
        host.compile(scene);
        fx.update(performance.now() + LATER_MS, 16, new THREE.Vector3(0, -1, 0));
        host.compile(scene);
      } finally {
        fx.timed.dispose();
        for (const o of built) {
          scene.remove(o);
          releaseMaterials(o);
        }
        for (const release of releases) release();
      }
    });
  };
  for (const vis of host.catalog) {
    step((add) => sampleSpellArt(vis, fx, add, () => host.compile(scene)));
  }
  for (const body of WARM_BODIES) {
    step((add) => {
      const built = host.body(body);
      if (built) add(built);
    });
  }
  for (const id of host.championIds) {
    step((add, after) => {
      const cv = host.champion(id);
      if (!cv) return;
      add(cv.root);
      after(() => cv.dispose());
    });
  }
  return runSteps(steps, host.next, host.gone);
}

// Disposes the materials under a sample; its geometry and textures may be
// shared with what the match draws (templates, atlases) and were never
// sent to the GPU by a compile, so they are left to the collector.
function releaseMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const material of Array.isArray(m) ? m : [m]) material.dispose();
  });
}

// The pictures the materials under `root` read, each once: the warm-up
// sends them to the GPU with their programs, so the first champion or
// Rising of a kind seen does not upload its pictures in that frame.
export function texturesOf(root: THREE.Object3D): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const material of Array.isArray(m) ? m : [m]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) out.add(value);
      }
    }
  });
  return [...out];
}
