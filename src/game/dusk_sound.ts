// The cold wind outside the light (the battle royale's loud moments): a bed
// of filtered noise whose level follows how deep the champion stands in
// the Dusk (ui/royale_moments.ts frostLevel), rising as they wander out and
// falling silent as they step back in. Synthesized on the shared bus
// (game/sfx.ts), built on first use, so a 5v5 never makes one.
// Presentation only: Math.random is fine.

import { type AudioBus, audioBus } from './sfx';

// The bed's level at full depth, and how fast it follows, seconds.
const WIND_MAX = 0.11;
const FOLLOW_S = 0.35;

interface Wind {
  bus: AudioBus;
  gain: GainNode;
  filter: BiquadFilterNode;
  sources: AudioScheduledSourceNode[];
  level: number;
}

let wind: Wind | null = null;

function build(b: AudioBus): Wind {
  const ctx = b.ctx;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Brown noise: a low roar rather than a hiss.
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 420;
  filter.Q.value = 0.7;
  // Gusts: the band sweeps slowly.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 220;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(b.sfx);
  src.start();
  lfo.start();
  return { bus: b, gain, filter, sources: [src, lfo], level: 0 };
}

// The wind's level this tick, 0 (inside the light) to 1 (deep in the Dusk).
export function setDuskWind(level: number): void {
  const target = Math.max(0, Math.min(1, level));
  if (!wind && target <= 0) return;
  const b = audioBus();
  if (b?.ctx.state !== 'running') return;
  if (!wind) wind = build(b);
  if (Math.abs(target - wind.level) < 0.01) return;
  wind.level = target;
  const t = b.ctx.currentTime;
  wind.gain.gain.cancelScheduledValues(t);
  wind.gain.gain.setTargetAtTime(target * WIND_MAX, t, FOLLOW_S);
  // Deeper is higher and harsher.
  wind.filter.Q.setTargetAtTime(0.7 + target * 1.6, t, FOLLOW_S);
}

// The match is over: the wind dies away and its nodes go.
export function stopDuskWind(): void {
  if (!wind) return;
  const w = wind;
  wind = null;
  const t = w.bus.ctx.currentTime;
  w.gain.gain.cancelScheduledValues(t);
  w.gain.gain.setTargetAtTime(0, t, 0.2);
  window.setTimeout(() => {
    for (const s of w.sources) s.stop();
    w.gain.disconnect();
  }, 1200);
}
