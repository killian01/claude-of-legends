// The recorded sound bank (playtest: the synthesized palette read as
// cheap). public/sfx/ holds short recordings rendered by
// scripts/build_sfx.mjs from CC0 sources (docs/design/sound.md); this
// manifest is data-as-code listing, per sound id, its variant files, so
// rapid fire never reads as one looped sample. sfx.ts asks here first and
// falls back to its synthesis when a sound has no recording, or until
// the bank has decoded (the first seconds of a session) or on a browser
// that cannot decode the files. Nothing here touches the sim; Math.random
// picks variants and jitters pitch, presentation only.

import type { AudioBus } from './sfx';

// Sound id to variant files under /sfx/. Attack ids are the SfxName the
// renderer plays; casts are keyed cast_<school>, the schools being the
// cast palette (src/sim/content/sounds.ts).
export const SFX_BANK: Readonly<Record<string, readonly string[]>> = {
  swing: ['swing_1.ogg', 'swing_2.ogg', 'swing_3.ogg', 'swing_4.ogg'],
  blade: ['blade_1.ogg', 'blade_2.ogg', 'blade_3.ogg', 'blade_4.ogg'],
  heavy: ['heavy_1.ogg', 'heavy_2.ogg', 'heavy_3.ogg'],
  bow: ['bow_1.ogg', 'bow_2.ogg'],
  bolt: ['bolt_1.ogg', 'bolt_2.ogg', 'bolt_3.ogg'],
  gunshot: ['gunshot_1.ogg', 'gunshot_2.ogg', 'gunshot_3.ogg', 'gunshot_4.ogg'],
  cast_arcane: ['cast_arcane_1.ogg', 'cast_arcane_2.ogg', 'cast_arcane_3.ogg'],
  cast_steel: ['cast_steel_1.ogg', 'cast_steel_2.ogg', 'cast_steel_3.ogg'],
  cast_fire: ['cast_fire_1.ogg', 'cast_fire_2.ogg', 'cast_fire_3.ogg'],
  cast_life: ['cast_life_1.ogg', 'cast_life_2.ogg', 'cast_life_3.ogg'],
  cast_control: ['cast_control_1.ogg', 'cast_control_2.ogg', 'cast_control_3.ogg'],
  cast_wind: ['cast_wind_1.ogg', 'cast_wind_2.ogg', 'cast_wind_3.ogg'],
  cast_frost: ['cast_frost_1.ogg', 'cast_frost_2.ogg', 'cast_frost_3.ogg'],
  cast_shadow: ['cast_shadow_1.ogg', 'cast_shadow_2.ogg', 'cast_shadow_3.ogg'],
  cast_thunder: ['cast_thunder_1.ogg', 'cast_thunder_2.ogg', 'cast_thunder_3.ogg'],
  cast: ['cast_1.ogg'],
  hit: ['hit_1.ogg', 'hit_2.ogg', 'hit_3.ogg', 'hit_4.ogg'],
  impact: ['impact_1.ogg', 'impact_2.ogg', 'impact_3.ogg'],
  towershot: ['towershot_1.ogg', 'towershot_2.ogg'],
};

export function sfxBankUrl(file: string): string {
  return `/sfx/${file}`;
}

const decoded = new Map<string, AudioBuffer[]>();
let loading: Promise<void> | null = null;

// Fetches and decodes the whole bank once, in the background; sounds
// play from the bank as each id lands. Safe to call any time: before the
// first user gesture the context still decodes, it only refuses to run.
export function preloadSfxBank(b: AudioBus): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    await Promise.all(
      Object.entries(SFX_BANK).map(async ([id, files]) => {
        const buffers: AudioBuffer[] = [];
        for (const file of files) {
          try {
            const res = await fetch(sfxBankUrl(file));
            if (!res.ok) continue;
            buffers.push(await b.ctx.decodeAudioData(await res.arrayBuffer()));
          } catch {
            // A missing or undecodable file leaves the synthesis in place.
          }
        }
        if (buffers.length > 0) decoded.set(id, buffers);
      }),
    );
  })();
  return loading;
}

export function sfxBankReady(id: string): boolean {
  return decoded.has(id);
}

// Test seam.
export function resetSfxBank(): void {
  decoded.clear();
  loading = null;
}

// Plays one variant of `id` at `gain` (1 = authored level) with a touch
// of pitch jitter, through the shared bus and its reverb send. False when
// the bank has no decoded recording for it.
export function playSfxBank(b: AudioBus, id: string, gain: number, verb = 0.12): boolean {
  const buffers = decoded.get(id);
  if (!buffers) return false;
  const buffer = buffers[Math.floor(Math.random() * buffers.length)];
  if (!buffer) return false;
  const src = b.ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 0.96 + Math.random() * 0.08;
  const out = b.ctx.createGain();
  out.gain.value = Math.min(1.5, gain);
  src.connect(out);
  out.connect(b.sfx);
  if (verb > 0) {
    const send = b.ctx.createGain();
    send.gain.value = verb;
    out.connect(send);
    send.connect(b.verb);
  }
  src.start();
  return true;
}
