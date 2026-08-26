// Minimal procedural sound effects over WebAudio: no assets, tiny, and
// enough to make combat audible (review finding: the game was fully mute).
// The AudioContext resumes on the first user gesture per browser policy.

export type SfxName =
  | 'cast'
  | 'kill'
  | 'death'
  | 'gold'
  | 'ping'
  | 'tower'
  | 'hit'
  | 'victory'
  | 'defeat';

const MASTER_GAIN = 0.14;

let ctx: AudioContext | null = null;
const lastPlay = new Map<SfxName, number>();

function ensureCtx(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    const resume = (): void => {
      ctx?.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
  }
  return ctx;
}

function tone(
  audio: AudioContext,
  freq: number,
  durationS: number,
  type: OscillatorType,
  startDelay = 0,
  slideTo?: number,
): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const t0 = audio.currentTime + startDelay;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + durationS);
  gain.gain.setValueAtTime(MASTER_GAIN, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationS);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + durationS + 0.02);
}

const MIN_INTERVAL_MS: Partial<Record<SfxName, number>> = {
  cast: 90,
  hit: 140,
  gold: 60,
};

export function playSfx(name: SfxName): void {
  const audio = ensureCtx();
  if (!audio || audio.state === 'suspended') return;
  const now = performance.now();
  const min = MIN_INTERVAL_MS[name] ?? 0;
  if (min > 0 && now - (lastPlay.get(name) ?? 0) < min) return;
  lastPlay.set(name, now);

  switch (name) {
    case 'cast':
      tone(audio, 420, 0.12, 'square', 0, 760);
      break;
    case 'hit':
      tone(audio, 180, 0.06, 'sawtooth', 0, 120);
      break;
    case 'kill':
      tone(audio, 160, 0.25, 'sawtooth', 0, 60);
      tone(audio, 880, 0.18, 'sine', 0.08);
      break;
    case 'death':
      tone(audio, 320, 0.5, 'sine', 0, 90);
      break;
    case 'gold':
      tone(audio, 1250, 0.08, 'triangle');
      tone(audio, 1650, 0.1, 'triangle', 0.05);
      break;
    case 'ping':
      tone(audio, 980, 0.2, 'sine', 0, 1250);
      break;
    case 'tower':
      tone(audio, 90, 0.6, 'sawtooth', 0, 45);
      break;
    case 'victory':
      for (const [i, f] of [523, 659, 784, 1047].entries())
        tone(audio, f, 0.28, 'triangle', i * 0.14);
      break;
    case 'defeat':
      for (const [i, f] of [392, 330, 262].entries()) tone(audio, f, 0.34, 'sine', i * 0.18);
      break;
    default:
      break;
  }
}
