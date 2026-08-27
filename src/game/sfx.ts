// Procedural sound design over WebAudio: no assets, everything synthesized.
// All sounds run through one shared bus (dry -> compressor -> speakers) with
// a feedback-delay reverb send for space. Layered tones plus filtered noise
// bursts read far less "beepy" than raw oscillators. The AudioContext
// resumes on the first user gesture per browser policy.

export type SfxName =
  | 'cast'
  | 'kill'
  | 'death'
  | 'gold'
  | 'ping'
  | 'tower'
  | 'hit'
  | 'victory'
  | 'defeat'
  | 'deny'
  | 'levelup'
  | 'buy'
  | 'swing'
  | 'gunshot'
  | 'impact'
  | 'towershot';

export interface AudioBus {
  ctx: AudioContext;
  master: GainNode;
  // Sound effects route through their own gain so the settings panel can
  // trim them without touching the music (which feeds master directly).
  sfx: GainNode;
  verb: GainNode;
}

let bus: AudioBus | null = null;
let noiseBuffer: AudioBuffer | null = null;
const lastPlay = new Map<SfxName, number>();
let sfxVolume = 1;
// Per-call gain multiplier, set by playSfx/playCastSfx for the voices they
// schedule synchronously; distance attenuation for other units' combat.
let callGain = 1;

// User setting, 0..1; applies live and to a bus built later.
export function setSfxVolume(v: number): void {
  sfxVolume = v;
  if (bus) bus.sfx.gain.value = v;
}

// Lazily builds the shared context, master chain, and reverb loop; also used
// by the music layer so everything shares one output bus.
export function audioBus(): AudioBus | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!bus) {
    const ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 22;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(comp);
    const sfx = ctx.createGain();
    sfx.gain.value = sfxVolume;
    sfx.connect(master);
    // Small-room reverb: a lowpassed feedback delay fed by a send gain.
    const verb = ctx.createGain();
    verb.gain.value = 0.6;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.14;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42;
    verb.connect(delay);
    delay.connect(lp);
    lp.connect(master);
    lp.connect(feedback);
    feedback.connect(delay);
    const resume = (): void => {
      ctx.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    bus = { ctx, master, sfx, verb };
  }
  return bus;
}

function getNoise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const len = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

interface ToneOpts {
  freq: number;
  dur: number;
  type?: OscillatorType;
  slideTo?: number;
  delay?: number;
  vol?: number;
  attack?: number;
  lpf?: number;
  verb?: number;
}

// One enveloped oscillator voice: optional pitch slide, lowpass, reverb send.
function tone(b: AudioBus, o: ToneOpts): void {
  const t0 = b.ctx.currentTime + (o.delay ?? 0);
  const osc = b.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + o.dur);
  const gain = b.ctx.createGain();
  const vol = (o.vol ?? 0.5) * 0.16 * callGain;
  const attack = o.attack ?? 0.005;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  let head: AudioNode = osc;
  if (o.lpf !== undefined) {
    const lp = b.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lpf;
    head.connect(lp);
    head = lp;
  }
  head.connect(gain);
  gain.connect(b.sfx);
  if (o.verb) {
    const send = b.ctx.createGain();
    send.gain.value = o.verb;
    gain.connect(send);
    send.connect(b.verb);
  }
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
}

interface NoiseOpts {
  dur: number;
  freq: number;
  slideTo?: number;
  type?: BiquadFilterType;
  q?: number;
  delay?: number;
  vol?: number;
  attack?: number;
  verb?: number;
}

// One enveloped filtered-noise voice: the texture layer of most sounds.
function noise(b: AudioBus, o: NoiseOpts): void {
  const t0 = b.ctx.currentTime + (o.delay ?? 0);
  const src = b.ctx.createBufferSource();
  src.buffer = getNoise(b.ctx);
  src.loop = true;
  const filter = b.ctx.createBiquadFilter();
  filter.type = o.type ?? 'bandpass';
  filter.Q.value = o.q ?? 1;
  filter.frequency.setValueAtTime(o.freq, t0);
  if (o.slideTo !== undefined) filter.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + o.dur);
  const gain = b.ctx.createGain();
  const vol = (o.vol ?? 0.5) * 0.16 * callGain;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + (o.attack ?? 0.005));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(b.sfx);
  if (o.verb) {
    const send = b.ctx.createGain();
    send.gain.value = o.verb;
    gain.connect(send);
    send.connect(b.verb);
  }
  src.start(t0);
  src.stop(t0 + o.dur + 0.05);
}

const MIN_INTERVAL_MS: Partial<Record<SfxName, number>> = {
  cast: 90,
  hit: 120,
  gold: 60,
  deny: 160,
  swing: 90,
  gunshot: 90,
  impact: 70,
  towershot: 120,
};

// Per-school cast sounds, six sonic identities instead of one shared
// whoosh (player review). gain < 1 for other units' casts, by distance.
export function playCastSfx(school: string, gain = 1): void {
  const b = audioBus();
  if (!b || b.ctx.state === 'suspended' || gain <= 0.02) return;
  const now = performance.now();
  if (now - (lastPlay.get('cast') ?? 0) < 90) return;
  lastPlay.set('cast', now);
  callGain = Math.min(1.5, gain);
  const j = 0.94 + Math.random() * 0.12;
  switch (school) {
    case 'steel':
      // A metallic schwing.
      noise(b, { dur: 0.12, freq: 1400 * j, slideTo: 3800 * j, q: 2.2, vol: 0.5 });
      tone(b, { freq: 2300 * j, dur: 0.1, type: 'triangle', vol: 0.18, verb: 0.3 });
      break;
    case 'fire':
      // A crackling roar.
      noise(b, { dur: 0.3, freq: 1500 * j, slideTo: 300, type: 'lowpass', vol: 0.65, verb: 0.3 });
      tone(b, { freq: 110 * j, slideTo: 65, dur: 0.25, type: 'sawtooth', vol: 0.3, lpf: 500 });
      break;
    case 'life':
      // A warm double chime.
      tone(b, { freq: 660 * j, dur: 0.2, type: 'sine', vol: 0.3, verb: 0.6 });
      tone(b, { freq: 990 * j, dur: 0.25, type: 'sine', delay: 0.06, vol: 0.25, verb: 0.6 });
      break;
    case 'control':
      // A heavy low slam.
      tone(b, {
        freq: 200 * j,
        slideTo: 90,
        dur: 0.3,
        type: 'square',
        vol: 0.4,
        lpf: 600,
        verb: 0.4,
      });
      noise(b, { dur: 0.12, freq: 500, slideTo: 150, type: 'lowpass', vol: 0.5 });
      break;
    case 'wind':
      // A fast breathy sweep.
      noise(b, { dur: 0.22, freq: 900 * j, slideTo: 5200 * j, q: 0.6, vol: 0.55, verb: 0.4 });
      break;
    default:
      // Arcane: the airy whoosh with a shimmer above it.
      noise(b, { dur: 0.26, freq: 350 * j, slideTo: 1800 * j, q: 0.9, vol: 0.6, verb: 0.4 });
      noise(b, {
        dur: 0.18,
        freq: 3200 * j,
        slideTo: 6400,
        q: 1.4,
        vol: 0.18,
        delay: 0.05,
        verb: 0.6,
      });
      break;
  }
  callGain = 1;
}

// gain scales the whole sound (1 = authored volume); combat events from
// other units pass a distance-attenuated gain so nearby fights are audible
// without the whole map playing at your ear.
export function playSfx(name: SfxName, gain = 1): void {
  const b = audioBus();
  if (!b || b.ctx.state === 'suspended' || gain <= 0.02) return;
  const now = performance.now();
  const min = MIN_INTERVAL_MS[name] ?? 0;
  if (min > 0 && now - (lastPlay.get(name) ?? 0) < min) return;
  lastPlay.set(name, now);
  callGain = Math.min(1.5, gain);

  // A little pitch jitter keeps rapid-fire combat sounds from stuttering
  // like one looped sample.
  const j = 0.92 + Math.random() * 0.16;

  switch (name) {
    case 'cast':
      // Pure air, no oscillator: a body whoosh, a bright breath above it,
      // and a low push underneath.
      noise(b, {
        dur: 0.28,
        freq: 320 * j,
        slideTo: 1500 * j,
        q: 0.8,
        vol: 0.75,
        verb: 0.35,
      });
      noise(b, {
        dur: 0.2,
        freq: 2400 * j,
        slideTo: 5200 * j,
        q: 1.2,
        vol: 0.22,
        delay: 0.04,
        verb: 0.5,
      });
      tone(b, { freq: 95 * j, slideTo: 55, dur: 0.16, type: 'sine', vol: 0.35 });
      break;
    case 'hit':
      // A soft body thud: dark noise plus a pitched-down thump.
      noise(b, { dur: 0.07, freq: 900 * j, slideTo: 250, type: 'lowpass', vol: 0.6 });
      tone(b, { freq: 170 * j, slideTo: 70, dur: 0.09, type: 'sine', vol: 0.55 });
      break;
    case 'swing':
      // A quick air whip for the player's own auto-attacks.
      noise(b, { dur: 0.08, freq: 700 * j, slideTo: 2200 * j, q: 1.1, vol: 0.3 });
      break;
    case 'gunshot':
      // A rifle report: an instant wideband crack, a low powder thump, and
      // a short reverb tail that sells the caliber.
      noise(b, { dur: 0.05, freq: 3200 * j, slideTo: 1100, q: 0.4, vol: 0.85, attack: 0.001 });
      noise(b, {
        dur: 0.18,
        freq: 900 * j,
        slideTo: 180,
        type: 'lowpass',
        vol: 0.55,
        verb: 0.5,
      });
      tone(b, { freq: 150 * j, slideTo: 55, dur: 0.12, type: 'sine', vol: 0.5 });
      break;
    case 'impact':
      // The crack of YOUR damage landing on someone else.
      noise(b, { dur: 0.06, freq: 2200 * j, slideTo: 600, q: 1.4, vol: 0.5 });
      tone(b, { freq: 220 * j, slideTo: 110, dur: 0.07, type: 'sine', vol: 0.4 });
      break;
    case 'towershot':
      // A heavy arcane bolt: unmistakably a tower.
      tone(b, { freq: 320 * j, slideTo: 90, dur: 0.16, type: 'sawtooth', vol: 0.5, lpf: 900 });
      noise(b, { dur: 0.1, freq: 1400, slideTo: 400, q: 1, vol: 0.35 });
      break;
    case 'kill':
      // Heavy impact then a two-note glory chime.
      tone(b, { freq: 130, slideTo: 44, dur: 0.35, type: 'sine', vol: 1.0 });
      noise(b, { dur: 0.12, freq: 1800, type: 'highpass', vol: 0.35 });
      tone(b, { freq: 740, dur: 0.22, type: 'triangle', delay: 0.08, vol: 0.32, verb: 0.6 });
      tone(b, { freq: 1108, dur: 0.3, type: 'triangle', delay: 0.18, vol: 0.32, verb: 0.6 });
      break;
    case 'death':
      // A long dark fall with a heavy reverb tail.
      tone(b, {
        freq: 240,
        slideTo: 58,
        dur: 0.8,
        type: 'sawtooth',
        vol: 0.4,
        lpf: 850,
        verb: 0.7,
      });
      tone(b, { freq: 120, slideTo: 48, dur: 0.8, type: 'sine', vol: 0.45, verb: 0.4 });
      break;
    case 'gold':
      // A quiet coin glint: two soft partials and a sparkle of noise.
      tone(b, { freq: 1420, dur: 0.06, type: 'triangle', vol: 0.2 });
      tone(b, { freq: 1880, dur: 0.09, type: 'triangle', delay: 0.05, vol: 0.2 });
      noise(b, { dur: 0.05, freq: 6500, type: 'highpass', vol: 0.1 });
      break;
    case 'ping':
      // A sonar blip that echoes through the reverb.
      tone(b, { freq: 920, dur: 0.28, type: 'sine', vol: 0.4, verb: 0.9 });
      tone(b, { freq: 1380, dur: 0.14, type: 'sine', vol: 0.18, verb: 0.7 });
      break;
    case 'tower':
      // Falling masonry: a sub drop, rubble noise, and a crack on top.
      tone(b, { freq: 78, slideTo: 34, dur: 0.9, type: 'sine', vol: 1.0 });
      noise(b, { dur: 0.7, freq: 380, slideTo: 110, type: 'lowpass', vol: 0.7, verb: 0.5 });
      noise(b, { dur: 0.06, freq: 2800, type: 'bandpass', q: 0.8, vol: 0.5 });
      break;
    case 'victory':
      for (const [i, f] of [523.25, 659.25, 783.99, 1046.5].entries())
        tone(b, { freq: f, dur: 0.5, type: 'triangle', delay: i * 0.16, vol: 0.4, verb: 0.6 });
      tone(b, { freq: 261.63, dur: 1.3, type: 'sine', vol: 0.3, attack: 0.2, verb: 0.5 });
      break;
    case 'defeat':
      for (const [i, f] of [440, 349.23, 293.66, 220].entries())
        tone(b, { freq: f, dur: 0.6, type: 'sine', delay: i * 0.22, vol: 0.4, verb: 0.6 });
      break;
    case 'deny':
      // The classic double buzz: "you cannot do that".
      tone(b, { freq: 138, dur: 0.07, type: 'square', vol: 0.4, lpf: 520 });
      tone(b, { freq: 118, dur: 0.09, type: 'square', delay: 0.1, vol: 0.4, lpf: 520 });
      break;
    case 'levelup':
      // A bright ascending arpeggio with shimmer.
      for (const [i, f] of [392, 523.25, 659.25, 783.99].entries())
        tone(b, { freq: f, dur: 0.3, type: 'triangle', delay: i * 0.07, vol: 0.35, verb: 0.5 });
      noise(b, { dur: 0.4, freq: 7000, type: 'highpass', vol: 0.08, attack: 0.1, verb: 0.6 });
      break;
    case 'buy':
      // A till click plus a two-coin chime.
      noise(b, { dur: 0.04, freq: 1300, type: 'bandpass', q: 2, vol: 0.4 });
      tone(b, { freq: 990, dur: 0.08, type: 'triangle', vol: 0.28 });
      tone(b, { freq: 1480, dur: 0.11, type: 'triangle', delay: 0.06, vol: 0.28, verb: 0.3 });
      break;
    default:
      break;
  }
  callGain = 1;
}
