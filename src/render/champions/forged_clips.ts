// Clip-name resolution for forged champion models. A generated GLB names
// its clips after the provider's presets ("preset:biped:idle",
// "preset:biped:slash"); the mock pipeline's placeholders use the bare
// roles ("idle", "attack"). This maps whatever arrived onto the renderer's
// clip vocabulary by substring, so the visual never depends on one
// provider's spelling. Pure lookup, zero three.js imports, testable from
// plain node.

import type { ChampionClipNames } from './manifest';

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

// The structural slice of THREE.AnimationClip stripTravel touches, typed
// structurally so this module stays three-free and node-testable.
export interface TravelClip {
  tracks: { name: string; values: { length: number; [i: number]: number } }[];
}

// Kills horizontal root travel inside one clip, in place. A run cycle
// baked to move forward fights both the workshop turntable and the
// in-match mover, which owns all translation; the champion must run on
// the spot. Every '.position' track keeps its height curve (the bob) and
// has X and Z pinned to their first frame; a bone whose position never
// moves is untouched by construction. Idempotent.
export function stripTravel(clip: TravelClip): void {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const v = track.values;
    const x0 = v[0] ?? 0;
    const z0 = v[2] ?? 0;
    for (let i = 0; i + 2 < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
}
