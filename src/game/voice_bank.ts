// The announcer's recorded lines: public/voice/ holds one clip per id in
// voice_lines.ts, rendered by scripts/build_voice.mjs. Like the sound
// bank, the clips decode in the background from the moment the audio bus
// exists; announcer.ts asks here first and falls back to speech synthesis
// while a clip has not landed or could not decode (a clone made without
// git-lfs holds pointer text under public/voice/, which fails to decode
// and falls through the same way). Presentation only.

import type { AudioBus } from './sfx';
import { VOICE_LINE_IDS, type VoiceLineId, voiceClipUrl } from './voice_lines';

// The clips are rendered at speech level; a touch above unity keeps the
// announcer on top of a fight without leaning on the compressor.
const VOICE_GAIN = 1.15;

const decoded = new Map<VoiceLineId, AudioBuffer>();
let loading: Promise<void> | null = null;

// Fetches and decodes every clip once, in the background. Safe to call any
// time: before the first user gesture the context still decodes, it only
// refuses to run.
export function preloadVoiceBank(b: AudioBus): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    await Promise.all(
      VOICE_LINE_IDS.map(async (id) => {
        try {
          const res = await fetch(voiceClipUrl(id));
          if (!res.ok) return;
          decoded.set(id, await b.ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // A missing or undecodable clip leaves the speech fallback in place.
        }
      }),
    );
  })();
  return loading;
}

export function voiceClipReady(id: VoiceLineId): boolean {
  return decoded.has(id);
}

// Test seam.
export function resetVoiceBank(): void {
  decoded.clear();
  loading = null;
}

export interface VoicePlayback {
  durationMs: number;
  stop(): void;
}

// Plays the clip for `id` dry through the sound-effects gain: the
// announcer sits in a booth, not in the room, so no reverb send. Null
// when the clip has not decoded; `onEnded` fires when it plays out (not
// when it is stopped).
export function playVoiceClip(
  b: AudioBus,
  id: VoiceLineId,
  onEnded: () => void,
): VoicePlayback | null {
  const buffer = decoded.get(id);
  if (!buffer) return null;
  const src = b.ctx.createBufferSource();
  src.buffer = buffer;
  const out = b.ctx.createGain();
  out.gain.value = VOICE_GAIN;
  src.connect(out);
  out.connect(b.sfx);
  src.onended = onEnded;
  src.start();
  return {
    durationMs: buffer.duration * 1000,
    stop: () => {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // Already finished.
      }
    },
  };
}
