// The announcer's lines, data-as-code: every sentence the voice can say,
// keyed by the event that says it. The clips under public/voice/ are
// rendered from this table by scripts/build_voice.mjs, one file per key,
// and announcer.ts plays them by key; the text is also what the speech
// synthesis fallback reads while a clip is missing. Nothing here is built
// at runtime: the voice never names a champion or a player (playtest
// round 3: ten invented names read aloud is noise, and the line runs long
// enough to still be talking over the next fight), so every line is fixed
// and is recorded once.

export const VOICE_LINES = {
  first_blood: 'First blood',
  self_slain: 'You have been slain',
  self_kill: 'You have slain an enemy',
  double_kill: 'Double kill',
  triple_kill: 'Triple kill',
  rampage: 'Rampage',
  enemy_slain: 'An enemy has been slain',
  ally_slain: 'An ally has been slain',
  minions_spawned: 'Minions have spawned',
  tower_fallen: 'A tower has fallen',
  warden_awoken: 'The Warden has awoken',
  boon_ours: 'Your team has claimed the Boon',
  boon_theirs: 'The enemy has claimed the Boon',
  victory: 'Victory',
  defeat: 'Defeat',
} as const;

export type VoiceLineId = keyof typeof VOICE_LINES;

export const VOICE_LINE_IDS = Object.keys(VOICE_LINES) as readonly VoiceLineId[];

// Where a rendered clip is served from (public/voice/, tracked with git-lfs).
export function voiceClipUrl(id: VoiceLineId): string {
  return `/voice/${id}.mp3`;
}
