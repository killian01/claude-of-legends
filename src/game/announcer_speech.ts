// The announcer's fallback: the browser's speech synthesis reading a line
// while its recorded clip has not decoded or could not (voice_bank.ts).
// Voice quality varies wildly per browser: Chrome's remote Google voices
// sound far better than the local SAPI ones but load LATE, so the pick is
// redone on voiceschanged.

// Preference order settled by playtest: the local female voices (Zira on
// Windows) read as the better announcer; the remote Google ones follow.
const PREFERRED: readonly RegExp[] = [
  /\bzira\b/i,
  /samantha/i,
  /\baria\b/i,
  /\bjenny\b/i,
  /female/i,
  /google us english/i,
];

let voice: SpeechSynthesisVoice | null = null;
let voiceLoaded = false;

if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    voiceLoaded = false;
  });
}

function pickVoice(): void {
  if (voiceLoaded || typeof speechSynthesis === 'undefined') return;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return;
  voiceLoaded = true;
  const en = voices.filter((v) => v.lang.startsWith('en'));
  voice = null;
  for (const re of PREFERRED) {
    const hit = en.find((v) => re.test(v.name));
    if (hit) {
      voice = hit;
      break;
    }
  }
  if (!voice) voice = en[0] ?? null;
  console.info('[announcer] speech fallback voice:', voice?.name ?? 'browser default');
}

export function speechAvailable(): boolean {
  return typeof speechSynthesis !== 'undefined';
}

export function speechBusy(): boolean {
  return speechAvailable() && speechSynthesis.speaking;
}

export function cancelSpeech(): void {
  if (speechAvailable()) speechSynthesis.cancel();
}

// Calm and deliberate, near-natural pitch: an announcer, not a robot. The
// rungs above it are the multikill ladder climbing (src/ui/multikill.ts):
// synthesis caps volume at 1, so intensity has to come out of the delivery,
// and a line read faster and higher is the one lever that reads as excited.
const DELIVERY: readonly { rate: number; pitch: number }[] = [
  { rate: 0.85, pitch: 0.8 },
  { rate: 0.95, pitch: 0.95 },
  { rate: 1.05, pitch: 1.1 },
];

// Reads `text` aloud; false when the browser has no speech synthesis.
export function speakLine(text: string, intensity = 0): boolean {
  if (!speechAvailable()) return false;
  pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  const how = DELIVERY[Math.max(0, Math.min(DELIVERY.length - 1, intensity))] ?? DELIVERY[0];
  u.rate = how?.rate ?? 0.85;
  u.pitch = how?.pitch ?? 0.8;
  u.volume = 1.0;
  speechSynthesis.speak(u);
  return true;
}
