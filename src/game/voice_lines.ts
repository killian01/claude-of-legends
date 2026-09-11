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
  first_blood: 'First blood!',
  self_slain: 'You have been slain',
  self_kill: 'You have slain an enemy!',
  double_kill: 'Double kill!',
  triple_kill: 'Triple kill!',
  rampage: 'Rampage!',
  enemy_slain: 'An enemy has been slain',
  ally_slain: 'An ally has been slain',
  minions_spawned: 'Minions have spawned',
  tower_fallen: 'A tower has fallen',
  warden_awoken: 'The Warden has awoken!',
  boon_ours: 'Your team has claimed the Boon!',
  boon_theirs: 'The enemy has claimed the Boon',
  pyrefang_risen: 'The Pyrefang has risen!',
  voidmaul_risen: 'The Voidmaul has risen!',
  favor_ours: 'Your team has claimed a favor!',
  favor_theirs: 'The enemy has claimed a favor',
  pyrefang_ascendant_risen: 'The Pyrefang Ascendant has risen!',
  voidmaul_ascendant_risen: 'The Voidmaul Ascendant has risen!',
  wrath_ours: 'Your team holds the Wrath!',
  wrath_theirs: 'The enemy holds the Wrath',
  victory: 'Victory!',
  defeat: 'Defeat',
} as const;

export type VoiceLineId = keyof typeof VOICE_LINES;

export const VOICE_LINE_IDS = Object.keys(VOICE_LINES) as readonly VoiceLineId[];

// Lines written before their clips (docs/plan-rings.md): the browser's
// speech synthesis reads them until scripts/build_voice.mjs renders them
// with the maintainer's key. tests/voice_bank.test.ts tolerates a missing
// clip for these only, and refuses a clip that has landed while its line
// still sits here, so the list is meant to empty.
export const PENDING_VOICE_LINES: readonly VoiceLineId[] = [
  'pyrefang_risen',
  'voidmaul_risen',
  'favor_ours',
  'favor_theirs',
  'pyrefang_ascendant_risen',
  'voidmaul_ascendant_risen',
  'wrath_ours',
  'wrath_theirs',
];

export const RECORDED_VOICE_LINE_IDS: readonly VoiceLineId[] = VOICE_LINE_IDS.filter(
  (id) => !PENDING_VOICE_LINES.includes(id),
);

// Where a rendered clip is served from (public/voice/, tracked with git-lfs).
export function voiceClipUrl(id: VoiceLineId): string {
  return `/voice/${id}.mp3`;
}
