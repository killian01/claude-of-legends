// The announcer voice, via the browser's speech synthesis: no assets, and
// every event line the genre expects. A small cooldown and a priority rule
// keep it from talking over itself in a bloodbath. Presentation only.

let voice: SpeechSynthesisVoice | null = null;
let voiceLoaded = false;
let lastSpokeAt = 0;
let lastLine = '';

function pickVoice(): void {
  if (voiceLoaded || typeof speechSynthesis === 'undefined') return;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return;
  voiceLoaded = true;
  // The genre's announcer is a calm female voice: prefer known female
  // English voices (Zira on Windows, Samantha on macOS, Google UK Female),
  // then any English voice.
  const en = voices.filter((v) => v.lang.startsWith('en'));
  voice =
    en.find((v) => /zira|samantha|female|aria|jenny/i.test(v.name)) ??
    en.find((v) => v.localService) ??
    en[0] ??
    null;
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
  // Calm and deliberate, not a robot bark: near-natural pitch, slow rate.
  u.rate = 0.85;
  u.pitch = 0.8;
  u.volume = 1.0;
  speechSynthesis.speak(u);
  lastSpokeAt = now;
  lastLine = line;
}
