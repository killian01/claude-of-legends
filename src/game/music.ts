// Procedural battle score, MOBA register: taiko booms and rolls, martial
// noise ticks, a staccato low-string ostinato, dark slow pads over a
// lament-bass progression (Am, G, F, E from the harmonic minor), and a
// sparse horn call instead of a running melody. All synthesized on the
// shared audio bus. Presentation only; nothing here touches the sim, so
// Math.random is fine.

import { audioBus } from './sfx';

const MUSIC_VOL = 0.22;
let userMusicVolume = 1;
const musicVol = (): number => MUSIC_VOL * userMusicVolume;

// User setting, 0..1 over the authored level; ramps live when playing.
export function setMusicVolume(v: number): void {
  userMusicVolume = v;
  const b = audioBus();
  if (!b || !state) return;
  const g = state.out.gain;
  const t = b.ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(musicVol(), t + 0.15);
}

const BEAT_S = 0.714; // 84 bpm
const BEATS_PER_CHORD = 8; // two bars
const ROOT_HZ = 110;

// Semitone offsets from A2. Open-fifth voicings; the E chord carries the
// raised leading tone (G sharp) for the harmonic-minor pull home.
const CHORDS: readonly (readonly number[])[] = [
  [0, 7, 12],
  [-2, 5, 10],
  [-4, 3, 8],
  [-5, -1, 2, 7],
];
const CHORD_ROOTS: readonly number[] = [0, -2, -4, -5];

// A sparse horn call per chord: long chord tones with room to breathe.
// b is the beat offset inside the chord, n semitones from A2, d in beats.
interface HornNote {
  b: number;
  n: number;
  d: number;
}
const HORN: readonly (readonly HornNote[])[] = [
  [
    { b: 0, n: 12, d: 3 },
    { b: 3, n: 15, d: 2 },
    { b: 5, n: 19, d: 3 },
  ],
  [
    { b: 0, n: 17, d: 2.5 },
    { b: 4, n: 15, d: 1.5 },
    { b: 5.5, n: 14, d: 2.5 },
  ],
  [
    { b: 0, n: 15, d: 3 },
    { b: 4, n: 12, d: 4 },
  ],
  [
    { b: 0, n: 11, d: 2 },
    { b: 2, n: 14, d: 2 },
    { b: 4, n: 19, d: 4 },
  ],
];

const hz = (semi: number): number => ROOT_HZ * 2 ** (semi / 12);

interface MusicState {
  out: GainNode;
  timer: number;
  nextBeatAt: number;
  beatIdx: number;
  bed: { sources: AudioScheduledSourceNode[] } | null;
}

let state: MusicState | null = null;

function envOsc(
  out: GainNode,
  freq: number,
  t0: number,
  dur: number,
  vol: number,
  type: OscillatorType,
  opts: { slideTo?: number; lpf?: number; verb?: number; attack?: number } = {},
): void {
  const b = audioBus();
  if (!b) return;
  const osc = b.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo !== undefined)
    osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
  const gain = b.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + (opts.attack ?? 0.012));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let head: AudioNode = osc;
  if (opts.lpf !== undefined) {
    const lp = b.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opts.lpf;
    head.connect(lp);
    head = lp;
  }
  head.connect(gain);
  gain.connect(out);
  if (opts.verb) {
    const send = b.ctx.createGain();
    send.gain.value = opts.verb;
    gain.connect(send);
    send.connect(b.verb);
  }
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// Shared noise buffer for the percussion (ticks, rolls, crash).
let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function envNoise(
  out: GainNode,
  t0: number,
  dur: number,
  vol: number,
  opts: { bpf?: number; hpf?: number; verb?: number } = {},
): void {
  const b = audioBus();
  if (!b) return;
  const src = b.ctx.createBufferSource();
  src.buffer = noiseBuffer(b.ctx);
  src.loop = true;
  let head: AudioNode = src;
  if (opts.bpf !== undefined) {
    const bp = b.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = opts.bpf;
    bp.Q.value = 1.2;
    head.connect(bp);
    head = bp;
  }
  if (opts.hpf !== undefined) {
    const hp = b.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = opts.hpf;
    head.connect(hp);
    head = hp;
  }
  const gain = b.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  head.connect(gain);
  gain.connect(out);
  if (opts.verb) {
    const send = b.ctx.createGain();
    send.gain.value = opts.verb;
    gain.connect(send);
    send.connect(b.verb);
  }
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// A taiko-like boom: a sine drop with a touch of noise skin.
function taiko(out: GainNode, t0: number, vol: number): void {
  envOsc(out, 96, t0, 0.28, vol, 'sine', { slideTo: 34 });
  envNoise(out, t0, 0.06, vol * 0.35, { bpf: 420 });
}

// Everything that happens on one beat of the grid.
function scheduleBeat(out: GainNode, beat: number, t0: number): void {
  const chordIdx = Math.floor(beat / BEATS_PER_CHORD) % CHORDS.length;
  const step = beat % BEATS_PER_CHORD;
  const half = BEAT_S / 2;

  // War drums: heavy hands on 0 and 4, a pickup double before each, and a
  // rising four-hit roll at the end of every chord.
  if (step === 0) taiko(out, t0, 0.13);
  if (step === 4) taiko(out, t0, 0.1);
  if (step === 3 || step === 7) taiko(out, t0 + half, 0.06);
  if (step === 7) {
    for (let i = 0; i < 4; i++) {
      taiko(out, t0 + (i * BEAT_S) / 4, 0.045 + i * 0.02);
    }
  }

  // Martial tick on every offbeat: a dry snare-edge pulse.
  envNoise(out, t0 + half, 0.05, 0.022, { bpf: 2100 });
  if (step % 2 === 1) envNoise(out, t0, 0.04, 0.014, { bpf: 3200 });

  // Low string ostinato: staccato eighth pulses on the chord root, with
  // accents on the drum hands.
  const root = CHORD_ROOTS[chordIdx] ?? 0;
  const accent = step % 4 === 0 ? 0.055 : 0.038;
  envOsc(out, hz(root - 12), t0, 0.12, accent, 'sawtooth', { lpf: 520 });
  envOsc(out, hz(root - 12), t0 + half, 0.1, 0.03, 'sawtooth', { lpf: 480 });

  // Dark pad: a slow swell at each chord change, plus a cycle-start crash.
  if (step === 0) {
    const chord = CHORDS[chordIdx] ?? CHORDS[0]!;
    const len = BEATS_PER_CHORD * BEAT_S;
    for (const semi of chord) {
      for (const detune of [-7, 7]) {
        envOsc(out, hz(semi) * 2 ** (detune / 1200), t0, len + 0.8, 0.018, 'sawtooth', {
          lpf: 460,
          verb: 0.65,
          attack: 1.2,
        });
      }
    }
    if (chordIdx === 0) envNoise(out, t0, 1.1, 0.045, { hpf: 2600, verb: 0.8 });
  }

  // The horn call: sparse long tones, doubled an octave down, far back in
  // the hall. Scheduled once per chord.
  if (step === 0) {
    for (const note of HORN[chordIdx] ?? []) {
      const nt = t0 + note.b * BEAT_S;
      const dur = note.d * BEAT_S;
      envOsc(out, hz(note.n + 12), nt, dur, 0.05, 'sawtooth', {
        lpf: 1150,
        verb: 0.75,
        attack: 0.07,
      });
      envOsc(out, hz(note.n), nt, dur, 0.028, 'sawtooth', {
        lpf: 700,
        verb: 0.6,
        attack: 0.07,
      });
    }
  }
}

// The continuous bed: a deep detuned root drone plus breathing wind.
function startBed(out: GainNode): MusicState['bed'] {
  const b = audioBus();
  if (!b) return null;
  const sources: AudioScheduledSourceNode[] = [];

  for (const detune of [-5, 5]) {
    const osc = b.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = ROOT_HZ / 2;
    osc.detune.value = detune;
    const lp = b.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const gain = b.ctx.createGain();
    gain.gain.value = 0.016;
    const lfo = b.ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = b.ctx.createGain();
    lfoGain.gain.value = 70;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    osc.connect(lp);
    lp.connect(gain);
    gain.connect(out);
    osc.start();
    lfo.start();
    sources.push(osc, lfo);
  }

  const len = b.ctx.sampleRate * 2;
  const buf = b.ctx.createBuffer(1, len, b.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const wind = b.ctx.createBufferSource();
  wind.buffer = buf;
  wind.loop = true;
  const windLp = b.ctx.createBiquadFilter();
  windLp.type = 'lowpass';
  windLp.frequency.value = 300;
  const windGain = b.ctx.createGain();
  windGain.gain.value = 0.028;
  const windLfo = b.ctx.createOscillator();
  windLfo.frequency.value = 0.07;
  const windLfoGain = b.ctx.createGain();
  windLfoGain.gain.value = 0.018;
  windLfo.connect(windLfoGain);
  windLfoGain.connect(windGain.gain);
  wind.connect(windLp);
  windLp.connect(windGain);
  windGain.connect(out);
  wind.start();
  windLfo.start();
  sources.push(wind, windLfo);

  return { sources };
}

export function startMusic(): void {
  const b = audioBus();
  if (!b || state) return;
  const out = b.ctx.createGain();
  out.gain.value = musicVol();
  out.connect(b.master);
  const s: MusicState = { out, timer: 0, nextBeatAt: 0, beatIdx: 0, bed: null };
  // Lookahead scheduler: while the context is suspended (before the first
  // user gesture) keep the timeline pinned to "now" so nothing piles up and
  // fires all at once on resume.
  s.timer = window.setInterval(() => {
    if (b.ctx.state !== 'running') {
      s.nextBeatAt = b.ctx.currentTime + 0.2;
      return;
    }
    if (!s.bed) s.bed = startBed(out);
    const horizon = b.ctx.currentTime + 1.2;
    while (s.nextBeatAt < horizon) {
      scheduleBeat(out, s.beatIdx, Math.max(s.nextBeatAt, b.ctx.currentTime + 0.05));
      s.beatIdx++;
      s.nextBeatAt = Math.max(s.nextBeatAt, b.ctx.currentTime) + BEAT_S;
    }
  }, 300);
  state = s;
}

// Briefly lowers the score under the announcer's voice, then swells back.
export function duckMusic(durationMs = 1200): void {
  const b = audioBus();
  if (!b || !state) return;
  const g = state.out.gain;
  const t = b.ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(musicVol() * 0.3, t + 0.15);
  g.setValueAtTime(musicVol() * 0.3, t + durationMs / 1000);
  g.linearRampToValueAtTime(musicVol(), t + durationMs / 1000 + 0.7);
}

// Fades the score out (end of match); safe to call repeatedly.
export function stopMusic(fadeS = 2.5): void {
  const b = audioBus();
  if (!b || !state) return;
  const s = state;
  state = null;
  window.clearInterval(s.timer);
  const t = b.ctx.currentTime;
  s.out.gain.setValueAtTime(s.out.gain.value, t);
  s.out.gain.linearRampToValueAtTime(0.0001, t + fadeS);
  window.setTimeout(
    () => {
      for (const src of s.bed?.sources ?? []) src.stop();
      s.out.disconnect();
    },
    (fadeS + 0.2) * 1000,
  );
}
