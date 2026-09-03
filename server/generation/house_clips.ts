// The house animation library: clips the repo ships itself, retargeted
// once onto the Tripo v1.0 skeleton (scripts/retarget_mixamo.py) and
// served as app assets. Because every Tripo biped rig shares the same
// bone names, one house clip plays on any forged champion by name
// binding: applying one COPIES the shared file into the champion's
// assets, calls no provider, and costs nothing. Sourced from Adobe
// Mixamo under its game-embedding license (the pre-launch legal pass
// covers it alongside the provider UGC authorization).

import type { ClipChoice, ClipRole, GenerationProvider } from './provider';

export interface HouseClip extends ClipChoice {
  // Path relative to the served static root (the client's public dir).
  file: string;
}

const clip = (name: string, label: string): HouseClip => ({
  id: `house:${name}`,
  label,
  file: `models/mannequin/clips/house_${name}.glb`,
});

// Three weapon-family sets: sword and shield (playtest round 9d: the
// provider library has exactly one one-handed sword strike), great
// sword, and magic, which finally gives the cast role house choices.
// Every clip is baked facing the rig's rest forward and performs on the
// spot; the run is the one traveling clip (the client measures and
// strips its travel). scripts/bake_house_clips.mjs is the bake record.
export const HOUSE_CLIP_CHOICES: Readonly<Record<ClipRole, readonly HouseClip[]>> = {
  idle: [
    clip('sns_idle', 'Sword and shield stance'),
    clip('sns_block_idle', 'Shield guard stance'),
    clip('gs_idle', 'Great sword stance'),
    clip('gs_guard', 'Great sword guard'),
    clip('magic_idle', 'Mage stance'),
    clip('magic_guard', 'Mage guard stance'),
  ],
  run: [
    clip('sns_run', 'Sword and shield run'),
    clip('gs_run', 'Great sword run'),
    clip('magic_run', 'Mage run'),
  ],
  attack: [
    clip('sns_attack_01', 'Sword combo'),
    clip('sns_attack_02', 'Spinning slash'),
    clip('sns_attack_03', 'Turning slash'),
    clip('sns_attack_04', 'Shield-arm slash'),
    clip('gs_attack_01', 'Great sword slash'),
    clip('gs_attack_02', 'Great sword strike'),
    clip('gs_attack_03', 'Great sword combo'),
    clip('gs_attack_04', 'Great sword sweep'),
    clip('magic_attack_01', 'Magic bolt'),
    clip('magic_attack_02', 'Magic bolt 2'),
    clip('magic_attack_03', 'Magic bolt 3'),
  ],
  cast: [
    clip('magic_cast_01', 'One-hand cast'),
    clip('magic_cast_02', 'Two-hand cast'),
    clip('magic_cast_03', 'Focused blast'),
    clip('magic_cast_04', 'Area cast'),
    clip('gs_cast_01', 'Quick spell'),
    clip('gs_cast_02', 'Power up'),
    clip('gs_cast_03', 'Long ritual'),
  ],
  death: [
    clip('sns_death', 'Sword and shield death'),
    clip('gs_death_01', 'Great sword death'),
    clip('gs_death_02', 'Great sword death 2'),
    clip('magic_death_01', 'Mage death'),
    clip('magic_death_02', 'Mage death 2'),
  ],
};

export function isHouseClip(id: string): boolean {
  return id.startsWith('house:');
}

// The shared file behind a house id; null for anything else.
export function houseClipFile(id: string): string | null {
  for (const list of Object.values(HOUSE_CLIP_CHOICES)) {
    for (const c of list) if (c.id === id) return c.file;
  }
  return null;
}

// What the player actually picks from: the provider's catalog plus the
// house library, per role. Validation and the animations route both
// read THIS, so a house pick is as legitimate as a preset.
export function catalogRoles(
  provider: GenerationProvider,
): Record<ClipRole, readonly ClipChoice[]> {
  const tripo = provider.clipChoices();
  const out = {} as Record<ClipRole, readonly ClipChoice[]>;
  for (const role of Object.keys(tripo) as ClipRole[]) {
    out[role] = [
      ...tripo[role],
      ...HOUSE_CLIP_CHOICES[role].map(({ id, label }) => ({ id, label })),
    ];
  }
  return out;
}
