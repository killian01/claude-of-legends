// Clip-name resolution for forged champion models. A generated GLB names
// its clips after the provider's presets ("preset:biped:idle",
// "preset:biped:slash"); the mock pipeline's placeholders use the bare
// roles ("idle", "attack"). This maps whatever arrived onto the renderer's
// clip vocabulary by substring, so the visual never depends on one
// provider's spelling. Pure lookup, zero three.js imports, testable from
// plain node.

import type { ChampionClipNames, SpellClipNames } from './manifest';

// Substring candidates per role, tried in order; matching is
// case-insensitive over the full clip name.
const ROLE_MATCHES: Readonly<Record<keyof ChampionClipNames, readonly string[]>> = {
  idle: ['idle', 'breathe'],
  run: ['run', 'walk', 'sprint'],
  attack: ['slash', 'attack', 'punch', 'shoot', 'stab'],
  cast: ['cast', 'spell'],
  windup: ['cast', 'spell', 'idle'],
  death: ['defeat', 'death', 'die', 'down'],
  hit: ['hit', 'impact'],
};

// Resolves the renderer's clip vocabulary against the clip names a forged
// GLB actually carries. Every required role falls back to the idle clip
// (a still champion beats a bind pose); null only when there are no clips
// at all.
export function resolveForgedClips(names: readonly string[]): ChampionClipNames | null {
  if (names.length === 0) return null;
  const lower = names.map((n) => n.toLowerCase());
  const find = (role: keyof ChampionClipNames): string | undefined => {
    for (const needle of ROLE_MATCHES[role]) {
      const at = lower.findIndex((n) => n.includes(needle));
      if (at >= 0) return names[at];
    }
    return undefined;
  };
  const idle = find('idle') ?? names[0];
  if (idle === undefined) return null;
  const hit = find('hit');
  return {
    idle,
    run: find('run') ?? idle,
    attack: find('attack') ?? idle,
    cast: find('cast') ?? idle,
    windup: find('windup') ?? idle,
    death: find('death') ?? idle,
    ...(hit !== undefined ? { hit } : {}),
  };
}

// The creator's per-spell cast picks, read from the same picked-clips map
// the roles ride ('castQ'..'castR'). Only picks the loaded files actually
// carry survive; a missing one falls back to the shared cast at play time.
export function spellClipPicks(
  picked: Record<string, string> | null,
  available: ReadonlySet<string>,
): SpellClipNames | undefined {
  if (!picked) return undefined;
  const out: Partial<Record<'Q' | 'W' | 'E' | 'R', string>> = {};
  for (const key of ['Q', 'W', 'E', 'R'] as const) {
    const name = picked[`cast${key}`];
    if (name !== undefined && available.has(name)) out[key] = name;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// The structural slice of THREE.AnimationClip stripTravel touches, typed
// structurally so this module stays three-free and node-testable.
interface NumberArray {
  length: number;
  [i: number]: number;
}
export interface TravelClip {
  tracks: { name: string; times: NumberArray; values: NumberArray }[];
}

// One removed drift: the bone-local straight line a '.position' track
// traveled over the clip, handed back so the caller can recover the run
// direction (the whole-model facing fix derives from it).
export interface RemovedTravel {
  name: string;
  drift: [number, number, number];
}

// Kills root travel inside one clip, in place, and returns what it
// removed. A run cycle baked to move fights both the workshop turntable
// and the in-match mover, which owns all translation; the champion must
// run on the spot. Rigs disagree on which LOCAL bone axis is the world's
// forward (exports often rotate the armature a quarter turn), so no axis
// is special here: every '.position' track loses its net drift, the
// straight line from its first to its last key, on all three axes. The
// bob and sway survive on whatever axis they live, because an
// oscillation that returns to its start has no drift. Handles plain vec3
// keys (stride 3) and glTF cubic-spline keys (stride 9, packed
// in-tangent, value, out-tangent). Idempotent on the clip; the returned
// drifts describe THIS pass only, so capture them on the first call.
export function stripTravel(clip: TravelClip): RemovedTravel[] {
  const removed: RemovedTravel[] = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const keys = track.times.length;
    if (keys < 2) continue;
    const v = track.values;
    const stride = Math.round(v.length / keys);
    if (stride !== 3 && stride !== 9) continue;
    const valueAt = stride === 9 ? 3 : 0;
    const t0 = track.times[0] ?? 0;
    const span = (track.times[keys - 1] ?? 0) - t0;
    if (span <= 0) continue;
    const drift: [number, number, number] = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
      const first = v[valueAt + axis] ?? 0;
      const last = v[(keys - 1) * stride + valueAt + axis] ?? 0;
      const moved = last - first;
      drift[axis] = moved;
      const speed = moved / span;
      if (speed === 0) continue;
      for (let k = 0; k < keys; k += 1) {
        const at = k * stride + valueAt + axis;
        v[at] = (v[at] ?? 0) - speed * ((track.times[k] ?? 0) - t0);
        if (stride === 9) {
          // Tangents are slopes, so the removed constant speed leaves
          // them too.
          const key = k * stride + axis;
          v[key] = (v[key] ?? 0) - speed;
          v[key + 6] = (v[key + 6] ?? 0) - speed;
        }
      }
    }
    if (drift[0] !== 0 || drift[1] !== 0 || drift[2] !== 0) {
      removed.push({ name: track.name, drift });
    }
  }
  return removed;
}

// Rebases a detrended run onto the stance clip (idle). The provider's run
// preset is trimmed mid-stride: its first key already sits a large step
// along the travel line (a live probe measured 56 percent of the model's
// height), and stripTravel anchors the detrended loop on that first key,
// so the whole cycle plays displaced in the run direction and the
// champion overhangs its own circle. For each removed drift, the first
// key's offset from the stance clip's first key is projected onto the
// drift direction and subtracted from every key: the trim artifact goes,
// while legitimate stance differences (a run crouch, a sideways lean)
// survive on the perpendicular axes. Constant shifts leave cubic-spline
// tangents untouched. Idempotent: after one pass the projection is zero.
export function stripStanceLead(
  clip: TravelClip,
  stance: TravelClip,
  removed: readonly RemovedTravel[],
): void {
  for (const r of removed) {
    const mag = Math.hypot(r.drift[0], r.drift[1], r.drift[2]);
    if (mag === 0) continue;
    const unit = [r.drift[0] / mag, r.drift[1] / mag, r.drift[2] / mag];
    const track = clip.tracks.find((t) => t.name === r.name);
    const base = stance.tracks.find((t) => t.name === r.name);
    if (!track || !base || track === base) continue;
    const keys = track.times.length;
    if (keys < 1 || base.times.length < 1) continue;
    const stride = Math.round(track.values.length / keys);
    if (stride !== 3 && stride !== 9) continue;
    const valueAt = stride === 9 ? 3 : 0;
    const baseStride = Math.round(base.values.length / base.times.length);
    if (baseStride !== 3 && baseStride !== 9) continue;
    const baseAt = baseStride === 9 ? 3 : 0;
    let lead = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const first = track.values[valueAt + axis] ?? 0;
      const stanceFirst = base.values[baseAt + axis] ?? 0;
      lead += (first - stanceFirst) * (unit[axis] ?? 0);
    }
    if (lead === 0) continue;
    for (let k = 0; k < keys; k += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const at = k * stride + valueAt + axis;
        track.values[at] = (track.values[at] ?? 0) - lead * (unit[axis] ?? 0);
      }
    }
  }
}
