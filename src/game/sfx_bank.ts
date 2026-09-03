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

// Sound id to variant files under /sfx/, <id>_<n>.ogg. Attack ids are
// the SfxName the renderer plays; casts are keyed cast_<id> over the cast
// palette (src/sim/content/sounds.ts). Printed by
// scripts/build_sfx.mjs --manifest from its recipes.
const files = (id: string, n: number): readonly string[] =>
  Array.from({ length: n }, (_, i) => `${id}_${i + 1}.ogg`);

export const SFX_BANK: Readonly<Record<string, readonly string[]>> = {
  swing: files('swing', 4),
  blade: files('blade', 4),
  heavy: files('heavy', 3),
  bow: files('bow', 2),
  bolt: files('bolt', 3),
  gunshot: files('gunshot', 4),
  dagger: files('dagger', 3),
  claw: files('claw', 2),
  chain: files('chain', 2),
  blunt: files('blunt', 3),
  staff: files('staff', 2),
  punch: files('punch', 3),
  bite: files('bite', 2),
  whip: files('whip', 2),
  crossbow: files('crossbow', 2),
  throw: files('throw', 2),
  spell: files('spell', 3),
  laser: files('laser', 3),
  pistol: files('pistol', 3),
  cannon: files('cannon', 2),
  cast_arcane: files('cast_arcane', 3),
  cast_steel: files('cast_steel', 3),
  cast_fire: files('cast_fire', 3),
  cast_life: files('cast_life', 3),
  cast_control: files('cast_control', 3),
  cast_wind: files('cast_wind', 3),
  cast_frost: files('cast_frost', 3),
  cast_shadow: files('cast_shadow', 3),
  cast_thunder: files('cast_thunder', 3),
  cast_fireball: files('cast_fireball', 3),
  cast_explosion: files('cast_explosion', 3),
  cast_ember: files('cast_ember', 2),
  cast_coldsnap: files('cast_coldsnap', 2),
  cast_shatter: files('cast_shatter', 3),
  cast_spark: files('cast_spark', 3),
  cast_storm: files('cast_storm', 2),
  cast_gust: files('cast_gust', 2),
  cast_sand: files('cast_sand', 2),
  cast_earth: files('cast_earth', 2),
  cast_rockfall: files('cast_rockfall', 3),
  cast_water: files('cast_water', 3),
  cast_tide: files('cast_tide', 2),
  cast_venom: files('cast_venom', 3),
  cast_missile: files('cast_missile', 3),
  cast_beam: files('cast_beam', 3),
  cast_pulse: files('cast_pulse', 2),
  cast_blink: files('cast_blink', 3),
  cast_ward: files('cast_ward', 2),
  cast_rune: files('cast_rune', 3),
  cast_gravity: files('cast_gravity', 2),
  cast_soar: files('cast_soar', 2),
  cast_powerup: files('cast_powerup', 3),
  cast_drain: files('cast_drain', 2),
  cast_bloom: files('cast_bloom', 3),
  cast_holy: files('cast_holy', 2),
  cast_chime: files('cast_chime', 3),
  cast_blessing: files('cast_blessing', 3),
  cast_growth: files('cast_growth', 2),
  cast_incantation: files('cast_incantation', 2),
  cast_curse: files('cast_curse', 3),
  cast_void: files('cast_void', 2),
  cast_wraith: files('cast_wraith', 2),
  cast_lich: files('cast_lich', 3),
  cast_clash: files('cast_clash', 3),
  cast_chains: files('cast_chains', 3),
  cast_crush: files('cast_crush', 3),
  cast_stomp: files('cast_stomp', 2),
  cast_roar: files('cast_roar', 3),
  cast_growl: files('cast_growl', 3),
  cast_bite: files('cast_bite', 2),
  cast_dash: files('cast_dash', 3),
  cast_gunfire: files('cast_gunfire', 3),
  cast_cannon: files('cast_cannon', 2),
  cast_laser: files('cast_laser', 3),
  cast_shock: files('cast_shock', 2),
  cast: files('cast', 1),
  hit: files('hit', 4),
  impact: files('impact', 3),
  towershot: files('towershot', 2),
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
