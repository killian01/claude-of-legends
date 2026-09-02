// The sound palette a forged champion picks from (plan-forge phase 4):
// one cast sound per spell and one basic-attack sound, each a procedural
// identity the client synthesizes (src/game/sfx.ts), so a pick is an id,
// never an asset. Data-as-code, a leaf: the validator bounds the def's
// picks to these ids, the editor lists them, the renderer plays them.
// Without a pick, a spell sounds like its school (derived from what it
// does) and the attack like the model's weapon.

export const CAST_SOUNDS = [
  { id: 'arcane', label: 'Arcane: an airy whoosh with a shimmer' },
  { id: 'steel', label: 'Steel: a metallic schwing' },
  { id: 'fire', label: 'Fire: a crackling roar' },
  { id: 'life', label: 'Life: a warm double chime' },
  { id: 'control', label: 'Control: a heavy low slam' },
  { id: 'wind', label: 'Wind: a fast breathy sweep' },
  { id: 'frost', label: 'Frost: a glassy crystalline ring' },
  { id: 'shadow', label: 'Shadow: a dark hiss drawn inward' },
  { id: 'thunder', label: 'Thunder: a crack and a rumble' },
] as const;

export type CastSoundId = (typeof CAST_SOUNDS)[number]['id'];

export const ATTACK_SOUNDS = [
  { id: 'swing', label: 'Swing: a quick whip of air' },
  { id: 'blade', label: 'Blade: a metallic slash' },
  { id: 'heavy', label: 'Heavy: a deep whoosh and a thud' },
  { id: 'bow', label: 'Bow: a string twang and an arrow hiss' },
  { id: 'bolt', label: 'Bolt: a short arcane zap' },
  { id: 'gunshot', label: 'Gunshot: a rifle report' },
] as const;

export type AttackSoundId = (typeof ATTACK_SOUNDS)[number]['id'];

export function isCastSound(v: unknown): v is CastSoundId {
  return typeof v === 'string' && CAST_SOUNDS.some((s) => s.id === v);
}

export function isAttackSound(v: unknown): v is AttackSoundId {
  return typeof v === 'string' && ATTACK_SOUNDS.some((s) => s.id === v);
}
