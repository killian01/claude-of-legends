// Procedural battle score: a beat grid at 96 bpm with a kick pulse, a bass
// line, string-like chord pads, and a composed lead motif per chord, over a
// deep drone and wind bed. All synthesized on the shared audio bus.
// Presentation only; nothing here touches the sim, so Math.random is fine.

import { audioBus } from './sfx';

const MUSIC_VOL = 0.22;
const BEAT_S = 0.625; // 96 bpm
const BEATS_PER_CHORD = 8; // two bars
const ROOT_HZ = 110;

// Semitone offsets from A2: Am, F, C, G with an octave on top.
const CHORDS: readonly (readonly number[])[] = [
  [0, 7, 12, 19],
  [-4, 3, 8, 15],
  [3, 10, 15, 22],
  [-2, 5, 10, 17],
];
const CHORD_ROOTS: readonly number[] = [0, -4, 3, -2];

// One eight-beat phrase per chord, chord tones with passing notes; null is
// a rest. Played an octave up.
const MELODY: readonly (readonly (number | null)[])[] = [
  [12, 15, 19, 15, 12, 10, 12, null],
  [8, 12, 15, 12, 8, 7, 8, null],
  [15, 19, 22, 19, 15, 14, 15, null],
  [10, 14, 17, 14, 12, 10, 7, 10],
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

// Everything that happens on one beat of the grid.
function scheduleBeat(out: GainNode, beat: number, t0: number): void {
  const chordIdx = Math.floor(beat / BEATS_PER_CHORD) % CHORDS.length;
  const step = beat % BEATS_PER_CHORD;

  // Kick pulse: every beat, heavier on the downbeat.
  const downbeat = beat % 4 === 0;
  envOsc(out, 105, t0, 0.13, downbeat ? 0.085 : 0.05, 'sine', { slideTo: 42 });

  // Bass: the chord root, low, on a push rhythm.
  if (step % 4 === 0 || step % 4 === 2 || step % 4 === 3) {
    const root = CHORD_ROOTS[chordIdx] ?? 0;
    envOsc(out, hz(root - 12), t0, 0.3, 0.055, 'sawtooth', { lpf: 260 });
  }

  // Chord pad: a slow string swell at each chord change.
  if (step === 0) {
    const chord = CHORDS[chordIdx] ?? CHORDS[0]!;
    const len = BEATS_PER_CHORD * BEAT_S;
    for (const semi of chord) {
      for (const detune of [-6, 6]) {
        envOsc(out, hz(semi) * 2 ** (detune / 1200), t0, len + 0.6, 0.02, 'sawtooth', {
          lpf: 620,
          verb: 0.6,
          attack: 0.9,
        });
      }
    }
  }

  // Lead motif: the composed phrase, doubled an octave apart, echoing.
  const note = MELODY[chordIdx]?.[step] ?? null;
  if (note !== null) {
    envOsc(out, hz(note + 12), t0, 0.5, 0.06, 'triangle', { verb: 0.7 });
    envOsc(out, hz(note), t0, 0.45, 0.03, 'sine', { verb: 0.5 });
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
  out.gain.value = MUSIC_VOL;
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
