// The announcer voice: recorded lines (voice_bank.ts, rendered from the
// table in voice_lines.ts by scripts/build_voice.mjs) played over the
// shared audio bus, with the browser's speech synthesis reading the same
// text while a clip has not decoded or could not (announcer_speech.ts).
// announcer_policy.ts decides what gets said; the music ducks while a
// line plays. Presentation only.

import { type AnnouncerState, announcerVerdict } from './announcer_policy';
import { cancelSpeech, speakLine, speechBusy } from './announcer_speech';
import { duckMusic } from './music';
import { audioBus, playSfx } from './sfx';
import { playVoiceClip, type VoicePlayback } from './voice_bank';
import { VOICE_LINES, type VoiceLineId } from './voice_lines';

let announcerEnabled = true;
const state: AnnouncerState = { lastId: null, lastAt: 0, busy: false };
let playing: VoicePlayback | null = null;
// When the playing clip runs out by the clock: a clip scheduled on a
// context the browser has not resumed yet never fires onended, and must
// not hold the voice busy forever.
let playingUntil = 0;

function silence(): void {
  playing?.stop();
  playing = null;
  cancelSpeech();
}

// User setting; turning it off also silences a line mid-sentence.
export function setAnnouncerEnabled(on: boolean): void {
  announcerEnabled = on;
  if (!on) silence();
}

// How much room a line is given, by rung. Only the multikill ladder asks
// for more than the first (src/ui/multikill.ts): a quadrakill leans on the
// gain and pulls the music further down, a pentakill also opens the booth
// onto a room and drops an impact under the first syllable. Louder alone
// does not read as bigger; the reverb and the hole in the music do.
const SHAPES: readonly {
  gain: number;
  verb: number;
  duckMs: number;
  duckDepth: number;
  impact: number;
}[] = [
  { gain: 1, verb: 0, duckMs: 300, duckDepth: 0.3, impact: 0 },
  { gain: 1.22, verb: 0.12, duckMs: 700, duckDepth: 0.18, impact: 0.8 },
  { gain: 1.45, verb: 0.32, duckMs: 1100, duckDepth: 0.08, impact: 1 },
];

// `repeatable` marks a line whose wording repeats across genuinely distinct
// events: since the kill calls stopped naming the champion, two enemies
// dying in one fight produce the same sentence, and the stutter guard
// would eat the second call. `intensity` is the multikill rung, 0 for every
// other line.
export function announceVoice(
  id: VoiceLineId,
  priority = false,
  repeatable = false,
  intensity = 0,
): void {
  if (!announcerEnabled) return;
  const now = performance.now();
  state.busy = (playing !== null && now < playingUntil) || speechBusy();
  const verdict = announcerVerdict(state, id, now, priority, repeatable);
  if (verdict === 'drop') return;
  if (verdict === 'interrupt') silence();

  const rung = Math.max(0, Math.min(SHAPES.length - 1, intensity));
  const shape = SHAPES[rung] ?? SHAPES[0];
  if (!shape) return;
  if (shape.impact > 0) playSfx('multikill', shape.impact);

  const b = audioBus();
  const clip = b
    ? playVoiceClip(
        b,
        id,
        () => {
          if (playing === clip) playing = null;
        },
        { gain: shape.gain, verb: shape.verb },
      )
    : null;
  if (clip) {
    playing = clip;
    playingUntil = now + clip.durationMs + 500;
    duckMusic(clip.durationMs + shape.duckMs, shape.duckDepth);
  } else {
    const text = VOICE_LINES[id];
    if (!speakLine(text, rung)) return;
    duckMusic(600 + text.length * 70 + shape.duckMs, shape.duckDepth);
  }
  state.lastAt = now;
  state.lastId = id;
}
