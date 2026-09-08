// The announcer voice: recorded lines (voice_bank.ts, rendered from the
// table in voice_lines.ts by scripts/build_voice.mjs) played over the
// shared audio bus, with the browser's speech synthesis reading the same
// text while a clip has not decoded or could not (announcer_speech.ts).
// announcer_policy.ts decides what gets said; the music ducks while a
// line plays. Presentation only.

import { type AnnouncerState, announcerVerdict } from './announcer_policy';
import { cancelSpeech, speakLine, speechBusy } from './announcer_speech';
import { duckMusic } from './music';
import { audioBus } from './sfx';
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

// `repeatable` marks a line whose wording repeats across genuinely distinct
// events: since the kill calls stopped naming the champion, two enemies
// dying in one fight produce the same sentence, and the stutter guard
// would eat the second call.
export function announceVoice(id: VoiceLineId, priority = false, repeatable = false): void {
  if (!announcerEnabled) return;
  const now = performance.now();
  state.busy = (playing !== null && now < playingUntil) || speechBusy();
  const verdict = announcerVerdict(state, id, now, priority, repeatable);
  if (verdict === 'drop') return;
  if (verdict === 'interrupt') silence();

  const b = audioBus();
  const clip = b
    ? playVoiceClip(b, id, () => {
        if (playing === clip) playing = null;
      })
    : null;
  if (clip) {
    playing = clip;
    playingUntil = now + clip.durationMs + 500;
    duckMusic(clip.durationMs + 300);
  } else {
    const text = VOICE_LINES[id];
    if (!speakLine(text)) return;
    duckMusic(600 + text.length * 70);
  }
  state.lastAt = now;
  state.lastId = id;
}
