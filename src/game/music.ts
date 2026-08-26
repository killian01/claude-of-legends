// Procedural ambient score: a slow four-chord pad, sparse pentatonic plucks,
// and a wind bed, all synthesized on the shared audio bus. Presentation only;
// nothing here touches the sim, so Math.random is fine.

import { audioBus } from './sfx';

const MUSIC_VOL = 0.24;
const CHORD_LEN_S = 6.4;
const PLUCK_SLOT_S = 0.8;
const ROOT_HZ = 110;

// Semitone offsets from A2 per chord: Am, F, C, G. A calm minor loop that
// never fights the combat sounds.
const CHORDS: readonly (readonly number[])[] = [
  [0, 3, 7, 12],
  [-4, 0, 3, 8],
  [3, 7, 10, 15],
  [-2, 2, 5, 10],
];

// A minor pentatonic pool for the pluck line, an octave or two up.
const PLUCK_POOL: readonly number[] = [12, 15, 17, 19, 22, 24, 27];

const hz = (semi: number): number => ROOT_HZ * 2 ** (semi / 12);

interface MusicState {
  out: GainNode;
  timer: number;
  nextChordAt: number;
  chordIdx: number;
  nextPluckAt: number;
  wind: { src: AudioBufferSourceNode; lfo: OscillatorNode } | null;
}

let state: MusicState | null = null;

function schedulePad(out: GainNode, chord: readonly number[], t0: number): void {
  const b = audioBus();
  if (!b) return;
  for (const semi of chord) {
    for (const detune of [-5, 5]) {
      const osc = b.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz(semi);
      osc.detune.value = detune;
      const lp = b.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 780;
      const gain = b.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.045, t0 + 2.2);
      gain.gain.setValueAtTime(0.045, t0 + CHORD_LEN_S - 1.6);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + CHORD_LEN_S + 0.4);
      osc.connect(lp);
      lp.connect(gain);
      gain.connect(out);
      const send = b.ctx.createGain();
      send.gain.value = 0.5;
      gain.connect(send);
      send.connect(b.verb);
      osc.start(t0);
      osc.stop(t0 + CHORD_LEN_S + 0.6);
    }
  }
}

function schedulePluck(out: GainNode, t0: number): void {
  const b = audioBus();
  if (!b) return;
  const semi = PLUCK_POOL[Math.floor(Math.random() * PLUCK_POOL.length)] ?? 12;
  const osc = b.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = hz(semi);
  const gain = b.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(0.075, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
  osc.connect(gain);
  gain.connect(out);
  const send = b.ctx.createGain();
  send.gain.value = 0.9;
  gain.connect(send);
  send.connect(b.verb);
  osc.start(t0);
  osc.stop(t0 + 1.0);
}

function startWind(out: GainNode): MusicState['wind'] {
  const b = audioBus();
  if (!b) return null;
  const len = b.ctx.sampleRate * 2;
  const buf = b.ctx.createBuffer(1, len, b.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = b.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const lp = b.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  const gain = b.ctx.createGain();
  gain.gain.value = 0.05;
  // A very slow swell so the wind breathes instead of hissing statically.
  const lfo = b.ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = b.ctx.createGain();
  lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);
  src.connect(lp);
  lp.connect(gain);
  gain.connect(out);
  src.start();
  lfo.start();
  return { src, lfo };
}

export function startMusic(): void {
  const b = audioBus();
  if (!b || state) return;
  const out = b.ctx.createGain();
  out.gain.value = MUSIC_VOL;
  out.connect(b.master);
  const s: MusicState = {
    out,
    timer: 0,
    nextChordAt: 0,
    chordIdx: 0,
    nextPluckAt: 0,
    wind: null,
  };
  // Lookahead scheduler: while the context is suspended (before the first
  // user gesture) keep the timeline pinned to "now" so nothing piles up and
  // fires all at once on resume.
  s.timer = window.setInterval(() => {
    if (b.ctx.state !== 'running') {
      s.nextChordAt = b.ctx.currentTime + 0.2;
      s.nextPluckAt = b.ctx.currentTime + 0.6;
      return;
    }
    if (!s.wind) s.wind = startWind(out);
    const horizon = b.ctx.currentTime + 1.4;
    while (s.nextChordAt < horizon) {
      const chord = CHORDS[s.chordIdx % CHORDS.length] ?? CHORDS[0]!;
      schedulePad(out, chord, Math.max(s.nextChordAt, b.ctx.currentTime + 0.05));
      s.chordIdx++;
      s.nextChordAt = Math.max(s.nextChordAt, b.ctx.currentTime) + CHORD_LEN_S;
    }
    while (s.nextPluckAt < horizon) {
      if (Math.random() < 0.4)
        schedulePluck(out, Math.max(s.nextPluckAt, b.ctx.currentTime + 0.05));
      s.nextPluckAt = Math.max(s.nextPluckAt, b.ctx.currentTime) + PLUCK_SLOT_S;
    }
  }, 400);
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
      s.wind?.src.stop();
      s.wind?.lfo.stop();
      s.out.disconnect();
    },
    (fadeS + 0.2) * 1000,
  );
}
