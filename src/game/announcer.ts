// The announcer voice, via the browser's speech synthesis: no assets, and
// every event line the genre expects. Voice quality varies wildly per
// browser: Chrome's remote Google voices sound far better than the local
// SAPI ones but load LATE, so the pick is redone on voiceschanged. The
// music ducks while a line plays. Presentation only.

import { duckMusic } from './music';

// Best-known voices first; the Google ones are the closest to a real
// announcer readily available in a browser.
const PREFERRED: readonly RegExp[] = [
  /google uk english female/i,
  /google us english/i,
  /\baria\b/i,
  /\bjenny\b/i,
  /\bzira\b/i,
  /female/i,
  /samantha/i,
];

let voice: SpeechSynthesisVoice | null = null;
let voiceLoaded = false;
let lastSpokeAt = 0;
let lastLine = '';

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
  console.info('[announcer] voice:', voice?.name ?? 'browser default');
}

// priority: true lines (kills, objectives) interrupt whatever is playing;
// others are dropped while speech is busy.
export function announceVoice(line: string, priority = false): void {
  if (typeof speechSynthesis === 'undefined') return;
  pickVoice();
  const now = performance.now();
  if (line === lastLine && now - lastSpokeAt < 4000) return;
  if (speechSynthesis.speaking) {
    if (!priority) return;
    speechSynthesis.cancel();
  } else if (now - lastSpokeAt < 900 && !priority) {
    return;
  }
  const u = new SpeechSynthesisUtterance(line);
  if (voice) u.voice = voice;
  // Calm and deliberate, near-natural pitch: an announcer, not a robot.
  u.rate = 0.85;
  u.pitch = 0.8;
  u.volume = 1.0;
  duckMusic(600 + line.length * 70);
  speechSynthesis.speak(u);
  lastSpokeAt = now;
  lastLine = line;
}
