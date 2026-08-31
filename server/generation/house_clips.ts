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

const sns = (name: string, label: string): HouseClip => ({
  id: `house:sns_${name}`,
  label,
  file: `models/mannequin/clips/house_sns_${name}.glb`,
});

// The sword-and-shield set (playtest round 9d: the provider library has
// exactly one one-handed sword strike, so the missing strikes come from
// Mixamo). Cast stays provider-only for now.
export const HOUSE_CLIP_CHOICES: Readonly<Record<ClipRole, readonly HouseClip[]>> = {
  idle: [sns('idle', 'Sword and shield stance'), sns('block_idle', 'Shield guard stance')],
  run: [sns('run', 'Sword and shield run'), sns('run_02', 'Sword and shield charge')],
  attack: [
    sns('attack_01', 'Shield-arm slash'),
    sns('attack_02', 'Sword strike 2'),
    sns('attack_03', 'Sword strike 3'),
    sns('attack_04', 'Sword strike 4'),
  ],
  cast: [],
  death: [sns('death', 'Sword and shield death')],
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
