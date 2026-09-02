// Renders the recorded sound bank (public/sfx/*.ogg) from CC0 recordings
// (playtest: the synthesized palette read as cheap; real recordings do
// not). docs/design/sound.md lists the source packs and where they come
// from; SFX_SRC points at the directory holding them unpacked. Each
// entry below is a recipe: layers of recordings (trimmed, pitched,
// filtered, delayed, gained) mixed through ffmpeg, a convolution reverb
// from a synthesized impulse response on top, then RMS normalization
// with a peak limiter so the bank sits at one level. Several variants
// per sound, so rapid fire never reads as one looped sample.
//
//   SFX_SRC=<dir> node scripts/build_sfx.mjs [--only id] [--list]
//
// Needs ffmpeg and ffprobe on PATH. The manifest the client reads is
// src/game/sfx_bank.ts; tests/sfx_bank.test.ts keeps the two in step.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SRC = process.env.SFX_SRC;
const OUT = path.join(process.cwd(), 'public', 'sfx');
const RATE = 44100;
// Where the bank sits: RMS over the whole file, before the limiter.
const TARGET_RMS_DB = -19;

// Source directories, relative to SFX_SRC.
const K = 'kenney_impact-sounds/Audio';
const KS = 'kenney_sci-fi-sounds/Audio';
const KR = 'kenney_rpg-audio/Audio';
const KD = 'kenney_digital-audio/Audio';
const R80 = 'rpg80';
const S100 = 'sfx100';
const T = 'tinysized/sfx-cc0';
const SW = 'swishes/swishes';
const SN = 'sword_starninjas/sword - StarNinjas';
const SC = 'sword_clash_starninjas';
const RSP = 'rpg_sound_pack/RPG Sound Pack';
const CM = 'curemagic';
const G = 'gunsounds/sounds';

// One layer: a recording and what happens to it before the mix.
//   file     path under SFX_SRC
//   start    seconds into the recording to begin (default 0)
//   dur      seconds to keep (default: the rest)
//   pitch    playback rate factor (1.2 = higher and shorter)
//   gain     dB (default 0)
//   delay    ms before it starts in the mix
//   hp, lp   highpass / lowpass cutoffs in Hz
//   reverse  play backwards
const L = (file, o = {}) => ({ file, ...o });

// A recipe: id (the bank key), the mix length cap in seconds, the reverb
// send (0 = dry), a dB trim after normalization, and the variants, each
// a list of layers.
const RECIPES = [
  // ---- basic attacks (the palette in src/sim/content/sounds.ts) -------
  {
    id: 'swing',
    len: 0.4,
    reverb: 0,
    trim: -4,
    variants: [
      [
        L(`${SW}/swish-3.wav`, { start: 0.025, hp: 200 }),
        L(`${SW}/swish-8.wav`, { pitch: 0.85, gain: -5 }),
      ],
      [
        L(`${SW}/swish-5.wav`, { start: 0.015, hp: 200 }),
        L(`${SW}/swish-1.wav`, { pitch: 0.8, gain: -5 }),
      ],
      [
        L(`${SW}/swish-9.wav`, { start: 0.025, hp: 200 }),
        L(`${SW}/swish-4.wav`, { pitch: 0.9, gain: -5 }),
      ],
      [L(`${SW}/swish-7.wav`, { hp: 200 }), L(`${SW}/swish-11.wav`, { pitch: 0.85, gain: -5 })],
    ],
  },
  {
    id: 'blade',
    len: 0.7,
    reverb: 0.1,
    trim: -2,
    variants: [
      [L(`${SN}/sword.1.ogg`, { start: 0.125, dur: 0.6 }), L(`${R80}/blade_01.ogg`, { gain: -3 })],
      [L(`${SN}/sword.3.ogg`, { dur: 0.6 }), L(`${R80}/blade_02.ogg`, { gain: -3 })],
      [L(`${SN}/sword.6.ogg`, { dur: 0.6 }), L(`${R80}/blade_03.ogg`, { gain: -3 })],
      [L(`${SN}/sword.9.ogg`, { start: 0.5, dur: 0.55 }), L(`${KR}/knifeSlice2.ogg`, { gain: -6 })],
    ],
  },
  {
    id: 'heavy',
    len: 0.8,
    reverb: 0.1,
    trim: 0,
    variants: [
      [
        L(`${SW}/swish-7.wav`, { pitch: 0.7, gain: -2 }),
        L(`${K}/impactWood_heavy_000.ogg`, { delay: 90 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { dur: 0.45, delay: 90, gain: -8, lp: 200 }),
      ],
      [
        L(`${SW}/swish-9.wav`, { start: 0.025, pitch: 0.7, gain: -2 }),
        L(`${K}/impactWood_heavy_002.ogg`, { delay: 90 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { dur: 0.45, delay: 90, gain: -8, lp: 200 }),
      ],
      [
        L(`${SW}/swish-4.wav`, { pitch: 0.65, gain: -2 }),
        L(`${K}/impactPlank_medium_001.ogg`, { delay: 90 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { dur: 0.45, delay: 90, gain: -8, lp: 200 }),
      ],
    ],
  },
  {
    id: 'bow',
    len: 0.65,
    reverb: 0.08,
    trim: -2,
    variants: [
      [
        L(`${T}/quiver-leather-squeeze-01.wav`, { dur: 0.18, lp: 3000, gain: -6 }),
        L(`${T}/scissors-close-01.wav`, { delay: 150, gain: -8, hp: 800 }),
        L(`${T}/tube-plastic-whoosh-01.wav`, { start: 0.04, delay: 160, pitch: 1.1 }),
        L(`${T}/arrow-feathers-01.wav`, { start: 0.02, delay: 170, dur: 0.35, hp: 1500, gain: -6 }),
      ],
      [
        L(`${T}/quiver-leather-squeeze-02.wav`, { dur: 0.18, lp: 3000, gain: -6 }),
        L(`${T}/scissors-close-01.wav`, { delay: 150, gain: -8, hp: 800, pitch: 1.1 }),
        L(`${T}/tube-plastic-whoosh-02.wav`, { delay: 160, pitch: 1.05 }),
        L(`${T}/arrow-feathers-01.wav`, {
          start: 0.02,
          delay: 170,
          dur: 0.35,
          hp: 1500,
          gain: -6,
          pitch: 1.1,
        }),
      ],
    ],
  },
  {
    id: 'bolt',
    len: 0.5,
    reverb: 0.1,
    trim: -2,
    variants: [
      [
        L(`${KS}/laserSmall_000.ogg`, { pitch: 0.75 }),
        L(`${KD}/zap1.ogg`, { start: 0.1, dur: 0.35, gain: -6 }),
        L(`${KS}/forceField_000.ogg`, { dur: 0.4, gain: -12, lp: 2500 }),
      ],
      [
        L(`${KS}/laserSmall_001.ogg`, { pitch: 0.75 }),
        L(`${KD}/zap2.ogg`, { dur: 0.35, gain: -6 }),
        L(`${KS}/forceField_001.ogg`, { dur: 0.4, gain: -12, lp: 2500 }),
      ],
      [
        L(`${KS}/laserSmall_002.ogg`, { pitch: 0.7 }),
        L(`${KD}/zap1.ogg`, { start: 0.1, dur: 0.35, gain: -6, pitch: 1.1 }),
        L(`${KS}/forceField_002.ogg`, { dur: 0.4, gain: -12, lp: 2500 }),
      ],
    ],
  },
  {
    id: 'gunshot',
    len: 0.9,
    reverb: 0.15,
    trim: 0,
    variants: [
      [L('pistol22.wav', { start: 0.135, dur: 0.45 })],
      [L('magnum22.wav', { start: 0.226, dur: 0.6 })],
      [L(`${G}/shotty.wav`, { dur: 0.7 })],
      [L(`${G}/cz.wav`, { dur: 0.6 })],
    ],
  },
  // ---- casts, keyed cast_<school> -------------------------------------
  {
    id: 'cast_arcane',
    len: 1.4,
    reverb: 0.2,
    trim: -2,
    variants: [
      [L('magical_1.ogg', { start: 0.03 }), L(`${KS}/forceField_000.ogg`, { gain: -10, lp: 3000 })],
      [L('magical_2.ogg'), L(`${KS}/forceField_001.ogg`, { gain: -10, lp: 3000 })],
      [L('magical_5.ogg'), L(`${KS}/forceField_002.ogg`, { gain: -10, lp: 3000 })],
    ],
  },
  {
    id: 'cast_steel',
    len: 1.0,
    reverb: 0.15,
    trim: -1,
    variants: [
      [
        L(`${KR}/knifeSlice.ogg`, { start: 0.075 }),
        L(`${SC}/sword_clash.1.ogg`, { delay: 60, gain: -2 }),
        L(`${K}/impactMetal_heavy_000.ogg`, { delay: 60, gain: -6 }),
      ],
      [
        L(`${KR}/knifeSlice2.ogg`),
        L(`${SC}/sword_clash.4.ogg`, { delay: 60, gain: -2 }),
        L(`${K}/impactMetal_heavy_002.ogg`, { delay: 60, gain: -6 }),
      ],
      [
        L(`${T}/seax-unsheathe-01.wav`, { start: 0.025 }),
        L(`${SC}/sword_clash.7.ogg`, { delay: 60, gain: -2 }),
        L(`${K}/impactMetal_heavy_004.ogg`, { delay: 60, gain: -6 }),
      ],
    ],
  },
  {
    id: 'cast_fire',
    len: 1.5,
    reverb: 0.1,
    trim: 0,
    variants: [
      [
        L(`${R80}/spell_fire_01.ogg`, { start: 0.065 }),
        L(`${KS}/explosionCrunch_000.ogg`, { gain: -9, lp: 1200 }),
      ],
      [
        L(`${R80}/spell_fire_02.ogg`, { start: 0.05 }),
        L(`${KS}/explosionCrunch_001.ogg`, { gain: -9, lp: 1200 }),
      ],
      [
        L(`${R80}/spell_fire_04.ogg`, { start: 0.085, dur: 1.4 }),
        L(`${KS}/explosionCrunch_002.ogg`, { gain: -9, lp: 1200 }),
      ],
    ],
  },
  {
    id: 'cast_life',
    len: 1.6,
    reverb: 0.25,
    trim: -3,
    variants: [
      [
        L(`${CM}/Cure1.wav`, { dur: 1.5 }),
        L(`${K}/impactBell_heavy_000.ogg`, { pitch: 1.5, gain: -12, delay: 40 }),
      ],
      [
        L(`${CM}/Cure4.wav`, { dur: 1.5 }),
        L(`${K}/impactBell_heavy_001.ogg`, { pitch: 1.5, gain: -12, delay: 40 }),
      ],
      [
        L(`${CM}/Cure7.wav`, { dur: 1.5 }),
        L(`${K}/impactBell_heavy_002.ogg`, { pitch: 1.5, gain: -12, delay: 40 }),
      ],
    ],
  },
  {
    id: 'cast_control',
    len: 1.1,
    reverb: 0.2,
    trim: 0,
    variants: [
      [
        L(`${K}/impactPlate_heavy_000.ogg`),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { dur: 1.0, gain: -3 }),
        L(`${KR}/chop.ogg`, { delay: 20, gain: -4 }),
      ],
      [
        L(`${K}/impactPlate_heavy_002.ogg`),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { dur: 1.0, gain: -3 }),
        L(`${K}/impactPunch_heavy_001.ogg`, { delay: 20, gain: -4 }),
      ],
      [
        L(`${T}/metal-hammer-hit-01.wav`, { dur: 0.8 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { dur: 1.0, gain: -3, pitch: 0.9 }),
      ],
    ],
  },
  {
    id: 'cast_wind',
    len: 1.3,
    reverb: 0.1,
    trim: -2,
    variants: [
      [
        L(`${S100}/sfx100v2_air_02.ogg`, { hp: 250 }),
        L(`${SW}/swish-9.wav`, { start: 0.025, pitch: 0.8, gain: -4 }),
      ],
      [
        L('whoosh2_0.wav', { start: 0.4, dur: 1.2, hp: 250 }),
        L(`${SW}/swish-3.wav`, { start: 0.025, pitch: 0.8, gain: -4 }),
      ],
      [
        L(`${S100}/sfx100v2_air_01.ogg`, { start: 0.3, dur: 1.2, hp: 250 }),
        L(`${T}/tin-whistle-whoosh-01.wav`, { gain: -8 }),
      ],
    ],
  },
  {
    id: 'cast_frost',
    len: 1.7,
    reverb: 0.25,
    trim: -2,
    variants: [
      [
        L('freeze.wav', { start: 0.11, dur: 1.6 }),
        L(`${K}/impactGlass_heavy_000.ogg`, { gain: -6, delay: 30 }),
      ],
      [
        L('freeze.wav', { start: 0.2, dur: 1.5 }),
        L(`${S100}/sfx100v2_glass_02.ogg`, { gain: -6 }),
        L(`${K}/impactGlass_light_001.ogg`, { gain: -8, delay: 120 }),
      ],
      [
        L('freeze.wav', { start: 0.11, pitch: 1.15, dur: 1.6 }),
        L(`${K}/impactGlass_heavy_003.ogg`, { gain: -6, delay: 30 }),
      ],
    ],
  },
  {
    id: 'cast_shadow',
    len: 1.5,
    reverb: 0.3,
    trim: -2,
    variants: [
      [
        L('powerdrain.ogg', { dur: 1.3 }),
        L(`${K}/impactBell_heavy_000.ogg`, { reverse: true, lp: 1200, gain: -8 }),
      ],
      [
        L(`${RSP}/NPC/shade/shade1.wav`, { start: 0.05, gain: -4, lp: 2500 }),
        L('powerdrain.ogg', { start: 0.5, dur: 1.0, gain: -3 }),
      ],
      [
        L('powerdrain.ogg', { pitch: 0.85, dur: 1.4 }),
        L(`${KS}/forceField_003.ogg`, { reverse: true, gain: -10 }),
      ],
    ],
  },
  {
    id: 'cast_thunder',
    len: 1.9,
    reverb: 0.2,
    trim: 0,
    variants: [
      [
        L(`${KS}/explosionCrunch_000.ogg`),
        L(`${S100}/sfx100v2_thunder_01.ogg`, { start: 0.235, dur: 1.8, gain: -2 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { gain: -4 }),
      ],
      [
        L(`${KS}/explosionCrunch_003.ogg`),
        L(`${S100}/sfx100v2_thunder_01.ogg`, { start: 0.6, dur: 1.6, gain: -2 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { gain: -4 }),
      ],
      [
        L(`${T}/paralyzer-discharge-01.wav`, { dur: 0.5, gain: -6 }),
        L(`${KS}/explosionCrunch_002.ogg`),
        L(`${S100}/sfx100v2_thunder_01.ogg`, { start: 0.3, dur: 1.7, gain: -2 }),
      ],
    ],
  },
  // The shared whoosh (sigils, unknown keys).
  {
    id: 'cast',
    len: 1.1,
    reverb: 0.1,
    trim: -3,
    variants: [[L(`${S100}/sfx100v2_air_02.ogg`), L(`${RSP}/battle/magic1.wav`, { gain: -8 })]],
  },
  // ---- combat ----------------------------------------------------------
  {
    id: 'hit',
    len: 0.5,
    reverb: 0,
    trim: -3,
    variants: [
      [L(`${K}/impactPunch_heavy_000.ogg`, { lp: 6000 })],
      [L(`${K}/impactPunch_heavy_001.ogg`, { lp: 6000 })],
      [L(`${K}/impactPunch_heavy_002.ogg`, { lp: 6000 })],
      [L(`${K}/impactPunch_heavy_003.ogg`, { lp: 6000 })],
    ],
  },
  {
    id: 'impact',
    len: 0.45,
    reverb: 0,
    trim: -2,
    variants: [
      [L(`${S100}/sfx100v2_hit_01.ogg`)],
      [L(`${S100}/sfx100v2_hit_02.ogg`)],
      [L(`${S100}/sfx100v2_hit_03.ogg`), L(`${K}/impactGeneric_light_000.ogg`, { gain: -4 })],
    ],
  },
  {
    id: 'towershot',
    len: 0.8,
    reverb: 0.15,
    trim: 0,
    variants: [
      [
        L(`${KS}/laserLarge_000.ogg`),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { dur: 0.6, gain: -6 }),
      ],
      [
        L(`${KS}/laserLarge_002.ogg`),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { dur: 0.6, gain: -6 }),
      ],
    ],
  },
];

// ---------------------------------------------------------------- ffmpeg

function run(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1 << 26,
  });
}

// The reverb's impulse response: pink noise dying exponentially over a
// second, banded to a room. Synthesized, deterministic (seeded).
function buildImpulse(file) {
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `anoisesrc=d=1.1:c=pink:r=${RATE}:a=0.6:s=7`,
      '-af',
      'afade=t=out:st=0:d=1.1:curve=exp,highpass=f=200,lowpass=f=4500',
      '-ac',
      '1',
      file,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

function layerChain(layer, index) {
  const parts = [`aformat=sample_fmts=fltp:sample_rates=${RATE}:channel_layouts=mono`];
  if (layer.start !== undefined || layer.dur !== undefined) {
    const start = layer.start ?? 0;
    parts.push(
      layer.dur !== undefined
        ? `atrim=start=${start}:duration=${layer.dur}`
        : `atrim=start=${start}`,
    );
    parts.push('asetpts=PTS-STARTPTS');
  }
  if (layer.reverse) parts.push('areverse');
  if (layer.pitch !== undefined && layer.pitch !== 1) {
    parts.push(`asetrate=${Math.round(RATE * layer.pitch)}`, `aresample=${RATE}`);
  }
  if (layer.hp !== undefined) parts.push(`highpass=f=${layer.hp}`);
  if (layer.lp !== undefined) parts.push(`lowpass=f=${layer.lp}`);
  parts.push('afade=t=in:st=0:d=0.004');
  if (layer.gain) parts.push(`volume=${layer.gain}dB`);
  if (layer.delay) parts.push(`adelay=delays=${layer.delay}:all=1`);
  return `[${index}:a]${parts.join(',')}[l${index}]`;
}

// Mixes one variant to a wav, unnormalized.
function renderMix(recipe, layers, irFile, outWav) {
  const inputs = [];
  for (const l of layers) inputs.push('-i', path.join(SRC, l.file));
  const irIndex = layers.length;
  inputs.push('-i', irFile);
  const chains = layers.map((l, i) => layerChain(l, i));
  const mixIn = layers.map((_, i) => `[l${i}]`).join('');
  const fadeAt = Math.max(0, recipe.len - 0.08).toFixed(3);
  const tail = `atrim=duration=${recipe.len},afade=t=out:st=${fadeAt}:d=0.08`;
  let graph;
  if (recipe.reverb > 0) {
    graph = [
      ...chains,
      `${mixIn}amix=inputs=${layers.length}:duration=longest:normalize=0[mix]`,
      '[mix]asplit=2[dry][wetin]',
      `[wetin][${irIndex}:a]afir=dry=1:wet=1:gtype=gn[wet]`,
      `[wet]volume=${recipe.reverb}[wetv]`,
      `[dry][wetv]amix=inputs=2:duration=longest:normalize=0,${tail}[out]`,
    ].join(';');
  } else {
    graph = [
      ...chains,
      `${mixIn}amix=inputs=${layers.length}:duration=longest:normalize=0,${tail}[out]`,
    ].join(';');
  }
  // Float samples: a mix of full-scale layers passes 0 dBFS before the
  // normalization brings it down, and must not clip on the way.
  run([
    ...inputs,
    '-filter_complex',
    graph,
    '-map',
    '[out]',
    '-ac',
    '1',
    '-ar',
    String(RATE),
    '-c:a',
    'pcm_f32le',
    outWav,
  ]);
}

// Overall RMS and peak of a wav in dBFS: astats logs them on stderr.
function measureLevels(wav) {
  const res = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-i',
      wav,
      '-af',
      'astats=measure_overall=RMS_level+Peak_level:measure_perchannel=none',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  const text = `${res.stdout}${res.stderr}`;
  const rms = /RMS level dB:\s*(-?[\d.]+)/.exec(text);
  const peak = /Peak level dB:\s*(-?[\d.]+)/.exec(text);
  if (!rms || !peak) throw new Error(`no level reading for ${wav}`);
  return { rms: Number(rms[1]), peak: Number(peak[1]) };
}

// The gain that brings the file to the bank's RMS, capped so the peak
// never passes -1 dBFS: a transient (a gunshot over its quiet tail) keeps
// its crack instead of being pushed into the limiter.
function normalizeAndEncode(wav, recipe, outOgg) {
  const { rms, peak } = measureLevels(wav);
  const gain = Math.min(TARGET_RMS_DB - rms, -1 - peak) + (recipe.trim ?? 0);
  run([
    '-i',
    wav,
    '-af',
    `volume=${gain.toFixed(2)}dB,alimiter=limit=0.891:attack=1:release=40:level=false`,
    '-c:a',
    'libvorbis',
    '-q:a',
    '4',
    '-ac',
    '1',
    '-ar',
    String(RATE),
    outOgg,
  ]);
  return { rms, gain };
}

// ------------------------------------------------------------------ main

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const r of RECIPES) console.log(`${r.id}: ${r.variants.length} variant(s)`);
    return;
  }
  if (!SRC) throw new Error('SFX_SRC must point at the directory holding the source packs');
  const onlyAt = args.indexOf('--only');
  const only = onlyAt >= 0 ? args[onlyAt + 1] : null;
  const recipes = only ? RECIPES.filter((r) => r.id === only) : RECIPES;
  if (recipes.length === 0) throw new Error(`no recipe named ${only}`);
  // Every source must be there before anything renders.
  const missing = [];
  for (const r of recipes) {
    for (const v of r.variants) {
      for (const l of v) {
        if (!existsSync(path.join(SRC, l.file))) missing.push(l.file);
      }
    }
  }
  if (missing.length > 0) throw new Error(`missing sources:\n${missing.join('\n')}`);
  mkdirSync(OUT, { recursive: true });
  const work = path.join(tmpdir(), `sfx-build-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const ir = path.join(work, 'ir.wav');
  buildImpulse(ir);
  let total = 0;
  for (const r of recipes) {
    r.variants.forEach((layers, i) => {
      const name = `${r.id}_${i + 1}.ogg`;
      const wav = path.join(work, `${r.id}_${i + 1}.wav`);
      renderMix(r, layers, ir, wav);
      const out = path.join(OUT, name);
      const { rms, gain } = normalizeAndEncode(wav, r, out);
      const size = statSync(out).size;
      total += size;
      console.log(
        `${name.padEnd(22)} ${(size / 1024).toFixed(1).padStart(6)} KB  rms ${rms.toFixed(1)} dB  gain ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`,
      );
    });
  }
  // SFX_KEEP leaves the unnormalized mixes behind for inspection.
  if (process.env.SFX_KEEP) console.log(`mixes kept in ${work}`);
  else rmSync(work, { recursive: true, force: true });
  console.log(`bank: ${(total / 1024).toFixed(0)} KB`);
}

main();
