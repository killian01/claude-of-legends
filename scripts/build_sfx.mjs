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
//   SFX_SRC=<dir> node scripts/build_sfx.mjs [--only id] [--list] [--manifest]
//
// --manifest prints the SFX_BANK entries for src/game/sfx_bank.ts.
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
const IC = 'icespells';
const GV = 'ghostvoices/Ghost and Lich Voice Pack';
const RX = 'randomsfx/SFX';

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
  {
    id: 'dagger',
    len: 0.45,
    reverb: 0.05,
    trim: -2,
    variants: [
      [
        L(`${KR}/knifeSlice2.ogg`, { start: 0.018, dur: 0.4, pitch: 1.15 }),
        L(`${SW}/swish-12.wav`, { start: 0.01, gain: -3 }),
      ],
      [
        L(`${T}/seax-unsheathe-01.wav`, { start: 0.03, dur: 0.4, pitch: 1.2 }),
        L(`${SW}/swish-13.wav`, { gain: -3 }),
      ],
      [
        L(`${KR}/knifeSlice.ogg`, { start: 0.082, dur: 0.4, pitch: 1.2 }),
        L(`${SW}/swish-10.wav`, { start: 0.011, gain: -3 }),
      ],
    ],
  },
  {
    id: 'claw',
    len: 0.5,
    reverb: 0.05,
    trim: -2,
    variants: [
      [
        L(`${SW}/swish-2.wav`, { start: 0.021 }),
        L(`${T}/metal-knife-scrape-03.wav`, {
          start: 0.023,
          dur: 0.4,
          pitch: 1.3,
          hp: 1200,
          gain: -4,
          delay: 30,
        }),
        L(`${T}/wood-twigs-break-01.wav`, { start: 0.027, dur: 0.3, delay: 60, gain: -8 }),
      ],
      [
        L(`${SW}/swish-6.wav`, { start: 0.021 }),
        L(`${T}/metal-fork-scrape-02.wav`, {
          start: 0.096,
          dur: 0.4,
          pitch: 1.25,
          hp: 1200,
          gain: -4,
          delay: 30,
        }),
        L(`${T}/wood-twigs-break-02.wav`, { start: 0.1, dur: 0.3, delay: 60, gain: -8 }),
      ],
    ],
  },
  {
    id: 'chain',
    len: 0.6,
    reverb: 0.05,
    trim: -2,
    variants: [
      [
        L(`${SW}/swish-4.wav`, { start: 0.027, pitch: 0.9 }),
        L(`${R80}/chain_01.ogg`, { start: 0.018, delay: 40 }),
        L(`${K}/impactMetal_heavy_001.ogg`, { delay: 110, gain: -6 }),
      ],
      [
        L(`${SW}/swish-8.wav`, { start: 0.04, pitch: 0.9 }),
        L(`${R80}/chain_02.ogg`, { delay: 40 }),
        L(`${K}/impactMetal_heavy_003.ogg`, { delay: 110, gain: -6 }),
      ],
    ],
  },
  {
    id: 'blunt',
    len: 0.55,
    reverb: 0.05,
    trim: -1,
    variants: [
      [
        L(`${SW}/swish-7.wav`, { start: 0.018, pitch: 0.8, gain: -3 }),
        L(`${K}/impactWood_medium_000.ogg`, { delay: 80 }),
        L(`${K}/impactSoft_heavy_000.ogg`, { delay: 80, gain: -4, lp: 800 }),
      ],
      [
        L(`${SW}/swish-9.wav`, { start: 0.034, pitch: 0.8, gain: -3 }),
        L(`${K}/impactWood_medium_002.ogg`, { delay: 80 }),
        L(`${K}/impactSoft_heavy_002.ogg`, { delay: 80, gain: -4, lp: 800 }),
      ],
      [
        L(`${SW}/swish-3.wav`, { start: 0.033, pitch: 0.8, gain: -3 }),
        L(`${K}/impactWood_medium_004.ogg`, { delay: 80 }),
        L(`${K}/impactSoft_heavy_004.ogg`, { delay: 80, gain: -4, lp: 800 }),
      ],
    ],
  },
  {
    id: 'staff',
    len: 0.5,
    reverb: 0.05,
    trim: -1,
    variants: [
      [
        L(`${SW}/swish-5.wav`, { start: 0.021, pitch: 0.9, gain: -3 }),
        L(`${S100}/sfx100v2_wood_hit_01.ogg`, { start: 0.027, delay: 70 }),
        L(`${R80}/item_wood_03.ogg`, { delay: 70, gain: -6 }),
      ],
      [
        L(`${SW}/swish-1.wav`, { start: 0.025, pitch: 0.9, gain: -3 }),
        L(`${S100}/sfx100v2_wood_hit_03.ogg`, { start: 0.019, delay: 70 }),
        L(`${R80}/item_wood_01.ogg`, { delay: 70, gain: -6 }),
      ],
    ],
  },
  {
    id: 'punch',
    len: 0.45,
    reverb: 0,
    trim: -1,
    variants: [
      [
        L(`${SW}/swish-11.wav`, { start: 0.013, gain: -6 }),
        L(`${K}/impactPunch_medium_000.ogg`, { delay: 50 }),
      ],
      [
        L(`${SW}/swish-12.wav`, { start: 0.01, gain: -6 }),
        L(`${K}/impactPunch_medium_002.ogg`, { delay: 50 }),
      ],
      [
        L(`${SW}/swish-10.wav`, { start: 0.011, gain: -6 }),
        L(`${K}/impactPunch_medium_004.ogg`, { delay: 50 }),
      ],
    ],
  },
  {
    id: 'bite',
    len: 0.5,
    reverb: 0,
    trim: -2,
    variants: [
      [
        L(`${SW}/swish-13.wav`, { gain: -6 }),
        L(`${RSP}/NPC/beetle/bite-small.wav`, { delay: 40 }),
        L(`${RSP}/NPC/slime/slime3.wav`, { start: 0.022, delay: 60, gain: -6 }),
      ],
      [
        L(`${SW}/swish-12.wav`, { start: 0.01, gain: -6 }),
        L(`${RSP}/NPC/beetle/bite-small2.wav`, { delay: 40 }),
        L(`${RSP}/NPC/slime/slime1.wav`, { start: 0.022, delay: 60, gain: -6 }),
      ],
    ],
  },
  {
    id: 'whip',
    len: 0.5,
    reverb: 0.08,
    trim: -2,
    variants: [
      [
        L(`${SW}/swish-13.wav`, { pitch: 1.3 }),
        L(`${T}/wood-twigs-break-01.wav`, {
          start: 0.027,
          dur: 0.15,
          delay: 90,
          pitch: 1.4,
          gain: -2,
        }),
        L(`${K}/impactGeneric_light_000.ogg`, { delay: 95, gain: -4, hp: 1500 }),
      ],
      [
        L(`${SW}/swish-11.wav`, { start: 0.013, pitch: 1.3 }),
        L(`${T}/wood-twigs-break-02.wav`, {
          start: 0.1,
          dur: 0.15,
          delay: 90,
          pitch: 1.4,
          gain: -2,
        }),
        L(`${K}/impactGeneric_light_002.ogg`, { delay: 95, gain: -4, hp: 1500 }),
      ],
    ],
  },
  {
    id: 'crossbow',
    len: 0.7,
    reverb: 0.08,
    trim: -2,
    variants: [
      [
        L(`${S100}/sfx100v2_switch_01.ogg`, { gain: -4 }),
        L(`${T}/quiver-leather-squeeze-01.wav`, { start: 0.015, dur: 0.15, lp: 3000, gain: -8 }),
        L(`${T}/tube-plastic-whoosh-01.wav`, { start: 0.046, delay: 60, pitch: 0.9 }),
        L(`${K}/impactWood_light_000.ogg`, { delay: 60, gain: -6 }),
        L(`${T}/arrow-feathers-01.wav`, {
          start: 0.026,
          delay: 70,
          dur: 0.35,
          hp: 1500,
          gain: -6,
          pitch: 0.9,
        }),
      ],
      [
        L(`${S100}/sfx100v2_switch_02.ogg`, { gain: -4 }),
        L(`${T}/tube-plastic-whoosh-02.wav`, { start: 0.045, delay: 60, pitch: 0.85 }),
        L(`${K}/impactWood_light_002.ogg`, { delay: 60, gain: -6 }),
        L(`${T}/arrow-feathers-01.wav`, {
          start: 0.026,
          delay: 70,
          dur: 0.35,
          hp: 1500,
          gain: -6,
          pitch: 0.85,
        }),
      ],
    ],
  },
  {
    id: 'throw',
    len: 0.6,
    reverb: 0.08,
    trim: -2,
    variants: [
      [
        L(`${SW}/swish-3.wav`, { start: 0.033 }),
        L(`${SW}/swish-8.wav`, { start: 0.04, delay: 110, gain: -3 }),
        L(`${SW}/swish-5.wav`, { start: 0.021, delay: 220, gain: -6 }),
        L(`${RSP}/inventory/metal-ringing.wav`, { start: 0.011, gain: -10, hp: 2000 }),
      ],
      [
        L(`${SW}/swish-9.wav`, { start: 0.034 }),
        L(`${SW}/swish-4.wav`, { start: 0.027, delay: 110, gain: -3 }),
        L(`${SW}/swish-1.wav`, { start: 0.025, delay: 220, gain: -6 }),
        L(`${KR}/drawKnife3.ogg`, { start: 0.093, gain: -2, hp: 2000 }),
      ],
    ],
  },
  {
    id: 'spell',
    len: 0.6,
    reverb: 0.12,
    trim: -2,
    variants: [
      [
        L('magical_6.ogg', { dur: 0.55, pitch: 1.2, gain: 10 }),
        L(`${KS}/laserSmall_003.ogg`, { pitch: 0.8, gain: -4 }),
      ],
      [
        L('magical_7.ogg', { dur: 0.55, pitch: 1.2, gain: 8 }),
        L(`${KS}/laserSmall_004.ogg`, { pitch: 0.8, gain: -4 }),
      ],
      [
        L('magical_2.ogg', { dur: 0.55, pitch: 1.25, gain: 5 }),
        L(`${KS}/laserSmall_000.ogg`, { pitch: 0.85, gain: -4 }),
      ],
    ],
  },
  {
    id: 'laser',
    len: 0.45,
    reverb: 0.1,
    trim: -3,
    variants: [
      [L(`${KS}/laserRetro_000.ogg`), L(`${KD}/laser3.ogg`, { start: 0.1, dur: 0.35, gain: -6 })],
      [L(`${KS}/laserRetro_002.ogg`), L(`${KD}/laser6.ogg`, { start: 0.098, dur: 0.35, gain: -6 })],
      [L(`${KS}/laserRetro_004.ogg`), L(`${KD}/laser8.ogg`, { start: 0.127, dur: 0.35, gain: -6 })],
    ],
  },
  {
    id: 'pistol',
    len: 0.6,
    reverb: 0.12,
    trim: -1,
    variants: [
      [L('pistol22.wav', { start: 0.135, dur: 0.35, pitch: 1.15 })],
      [L(`${G}/cz.wav`, { dur: 0.35, pitch: 1.1 })],
      [
        L('pistol22.wav', { start: 0.135, dur: 0.35, pitch: 1.05 }),
        L(`${K}/impactMetal_heavy_004.ogg`, { gain: -10, delay: 60 }),
      ],
    ],
  },
  {
    id: 'cannon',
    len: 1.2,
    reverb: 0.2,
    trim: 0,
    variants: [
      [
        L('blackpowder.wav', { start: 0.148, dur: 1.1 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { start: 0.037, dur: 0.9, gain: -4 }),
      ],
      [
        L('blackpowder.wav', { start: 0.148, dur: 1.1, pitch: 0.9 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { start: 0.023, dur: 0.9, gain: -4 }),
      ],
    ],
  },
  // ---- casts, keyed cast_<id> over the cast palette ---------------------
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
  // ---- the wider palette (2026-09-02: nine casts were far too few) ----
  // Elements.
  {
    id: 'cast_fireball',
    len: 1.3,
    reverb: 0.12,
    trim: -1,
    variants: [
      [
        L(`${SW}/swish-7.wav`, { start: 0.018, pitch: 0.7 }),
        L(`${R80}/spell_fire_03.ogg`, { start: 0.037, dur: 1.2, gain: 10, delay: 30 }),
        L(`${KS}/thrusterFire_000.ogg`, { dur: 0.6, gain: -10, lp: 2000, delay: 40 }),
      ],
      [
        L(`${SW}/swish-9.wav`, { start: 0.034, pitch: 0.7 }),
        L(`${R80}/spell_fire_05.ogg`, { start: 0.136, dur: 1.1, gain: 12, delay: 30 }),
        L(`${KS}/thrusterFire_002.ogg`, { dur: 0.6, gain: -10, lp: 2000, delay: 40 }),
      ],
      [
        L('whoosh2_0.wav', { start: 0.4, dur: 0.6, gain: 4, hp: 300 }),
        L(`${R80}/spell_fire_06.ogg`, { dur: 1.0, gain: 6, delay: 60 }),
        L(`${KS}/thrusterFire_004.ogg`, { dur: 0.6, gain: -10, lp: 2000, delay: 60 }),
      ],
    ],
  },
  {
    id: 'cast_explosion',
    len: 1.6,
    reverb: 0.2,
    trim: 1,
    variants: [
      [
        L('blackpowder.wav', { start: 0.148, dur: 1.2 }),
        L(`${KS}/explosionCrunch_001.ogg`, { gain: -2 }),
        L(`${S100}/sfx100v2_stones_01.ogg`, { start: 0.02, delay: 250, gain: -8 }),
      ],
      [
        L(`${KS}/explosionCrunch_004.ogg`, { dur: 1.5 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { start: 0.037, gain: -2 }),
        L(`${R80}/stones_01.ogg`, { delay: 300, gain: -8 }),
      ],
      [
        L('blackpowder.wav', { start: 0.148, dur: 1.2, pitch: 0.85 }),
        L(`${KS}/explosionCrunch_003.ogg`, { gain: -3 }),
        L(`${S100}/sfx100v2_stones_02.ogg`, { start: 0.023, delay: 280, gain: -8 }),
      ],
    ],
  },
  {
    id: 'cast_ember',
    len: 1.0,
    reverb: 0.1,
    trim: -3,
    variants: [
      [L('flame_0.ogg'), L(`${R80}/spell_fire_07.ogg`, { start: 0.105, gain: 10, delay: 80 })],
      [
        L('flame_0.ogg', { pitch: 0.9 }),
        L(`${R80}/spell_fire_02.ogg`, { start: 0.058, dur: 0.9, gain: 14, delay: 60 }),
      ],
    ],
  },
  {
    id: 'cast_coldsnap',
    len: 1.6,
    reverb: 0.2,
    trim: -1,
    variants: [
      [L(`${IC}/coldsnap.wav`, { dur: 1.5 })],
      [
        L(`${IC}/coldsnap.wav`, { dur: 1.5, pitch: 1.1 }),
        L(`${K}/impactGlass_heavy_001.ogg`, { gain: -8, delay: 50 }),
      ],
    ],
  },
  {
    id: 'cast_shatter',
    len: 1.2,
    reverb: 0.25,
    trim: -2,
    variants: [
      [
        L(`${IC}/ice.wav`, { dur: 1.1 }),
        L(`${K}/impactGlass_heavy_000.ogg`, { gain: -2 }),
        L(`${K}/impactGlass_heavy_004.ogg`, { gain: -4, delay: 90 }),
      ],
      [
        L(`${S100}/sfx100v2_glass_02.ogg`, { start: 0.05 }),
        L(`${S100}/sfx100v2_glass_05.ogg`, { gain: -3, delay: 120 }),
        L('freeze.wav', { start: 0.5, dur: 1.0, gain: -8 }),
      ],
      [
        L(`${S100}/sfx100v2_glass_03.ogg`, { start: 0.052 }),
        L(`${K}/impactGlass_heavy_002.ogg`, { gain: -2, delay: 70 }),
        L(`${IC}/ice.wav`, { dur: 1.0, gain: -6, delay: 40 }),
      ],
    ],
  },
  {
    id: 'cast_spark',
    len: 0.9,
    reverb: 0.1,
    trim: -2,
    variants: [
      [
        L(`${T}/paralyzer-discharge-01.wav`, { start: 0.012, dur: 0.6 }),
        L(`${KD}/zap1.ogg`, { start: 0.111, dur: 0.5, gain: -4 }),
      ],
      [
        L(`${T}/paralyzer-discharge-02.wav`, { start: 0.013, dur: 0.7 }),
        L(`${KD}/zap2.ogg`, { start: 0.074, dur: 0.5, gain: -4 }),
      ],
      [
        L(`${T}/paralyzer-discharge-01.wav`, { start: 0.012, dur: 0.5, pitch: 1.2 }),
        L(`${KD}/zapTwoTone.ogg`, { start: 0.132, dur: 0.6, gain: -5 }),
      ],
    ],
  },
  {
    id: 'cast_storm',
    len: 2.0,
    reverb: 0.2,
    trim: 0,
    variants: [
      [
        L(`${S100}/sfx100v2_air_01.ogg`, { dur: 1.2, hp: 200 }),
        L(`${S100}/sfx100v2_thunder_01.ogg`, { start: 0.243, dur: 1.6, delay: 350 }),
      ],
      [
        L('whoosh2_0.wav', { start: 0.4, dur: 1.4, gain: 6, hp: 200 }),
        L(`${KS}/explosionCrunch_000.ogg`, { delay: 400, gain: -4 }),
        L(`${S100}/sfx100v2_thunder_01.ogg`, { start: 0.6, dur: 1.5, delay: 420 }),
      ],
    ],
  },
  {
    id: 'cast_gust',
    len: 1.6,
    reverb: 0.1,
    trim: -1,
    variants: [
      [
        L('whoosh2_0.wav', { start: 0.35, dur: 1.6, gain: 6 }),
        L(`${SW}/swish-7.wav`, { start: 0.018, pitch: 0.6, gain: -4 }),
      ],
      [
        L(`${S100}/sfx100v2_air_01.ogg`, { dur: 1.6, gain: 2 }),
        L(`${T}/compressed-air-spray-02.wav`, { start: 0.076, dur: 1.0, gain: -10, lp: 3000 }),
      ],
    ],
  },
  {
    id: 'cast_sand',
    len: 1.3,
    reverb: 0.1,
    trim: -2,
    variants: [
      [L('sand_spell.flac', { start: 0.033 })],
      [
        L('sand_spell.flac', { start: 0.033, pitch: 0.9 }),
        L(`${T}/soil-steps-01.wav`, { start: 0.17, dur: 0.6, gain: -8 }),
      ],
    ],
  },
  {
    id: 'cast_earth',
    len: 1.9,
    reverb: 0.2,
    trim: 0,
    variants: [
      [L('earth_spell.flac', { start: 0.046 })],
      [
        L('earth_spell.flac', { start: 0.046, pitch: 0.9 }),
        L(`${K}/impactMining_001.ogg`, { gain: -6, delay: 100 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { start: 0.037, gain: -6 }),
      ],
    ],
  },
  {
    id: 'cast_rockfall',
    len: 1.3,
    reverb: 0.15,
    trim: -1,
    variants: [
      [
        L(`${R80}/stones_03.ogg`),
        L(`${K}/impactMining_000.ogg`, { gain: -4, delay: 150 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { start: 0.023, dur: 0.8, gain: -6 }),
      ],
      [
        L(`${S100}/sfx100v2_stones_03.ogg`),
        L(`${R80}/stones_04.ogg`, { start: 0.022, delay: 200, gain: -2 }),
        L(`${K}/impactMining_003.ogg`, { gain: -4, delay: 120 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { start: 0.037, dur: 0.8, gain: -6 }),
      ],
      [
        L(`${R80}/stones_01.ogg`, { start: 0.024 }),
        L(`${R80}/item_stone_03.ogg`, { delay: 250, gain: -2 }),
        L(`${K}/impactMining_004.ogg`, { gain: -4, delay: 100 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, {
          start: 0.023,
          dur: 0.8,
          gain: -6,
          pitch: 0.9,
        }),
      ],
    ],
  },
  {
    id: 'cast_water',
    len: 1.2,
    reverb: 0.15,
    trim: -2,
    variants: [
      [
        L(`${T}/water-pour-01.wav`, { start: 0.165, dur: 1.0 }),
        L(`${T}/water-drop-01.wav`, { start: 0.024, gain: -3 }),
        L(`${RSP}/inventory/bubble.wav`, { start: 0.029, delay: 200, gain: -6 }),
      ],
      [
        L(`${T}/water-vial-fill-01.wav`, { start: 0.034, dur: 1.0 }),
        L(`${T}/water-drop-03.wav`, { start: 0.022, gain: -3, delay: 50 }),
        L(`${RSP}/inventory/bubble3.wav`, { start: 0.046, delay: 250, gain: -6 }),
      ],
      [
        L(`${T}/water-drop-02.wav`, { start: 0.039 }),
        L(`${RX}/Background/Shallow Bubbles.wav`, { start: 0.02, dur: 1.0, gain: 4 }),
        L(`${T}/water-pour-01.wav`, { start: 0.4, dur: 0.7, gain: -4, delay: 100 }),
      ],
    ],
  },
  {
    id: 'cast_tide',
    len: 1.8,
    reverb: 0.2,
    trim: -1,
    variants: [
      [
        L(`${RX}/Background/Crystal Falls.wav`, { dur: 1.7, gain: -2 }),
        L(`${T}/water-pour-01.wav`, { start: 0.165, dur: 1.2, gain: -2, delay: 100 }),
        L(`${S100}/sfx100v2_air_02.ogg`, { start: 0.012, gain: -8, lp: 1500 }),
      ],
      [
        L(`${RX}/Background/Falls.wav`, { dur: 1.7, gain: 10 }),
        L(`${T}/water-vial-fill-01.wav`, { start: 0.034, dur: 1.3, gain: -2 }),
        L('whoosh2_0.wav', { start: 0.4, dur: 1.4, gain: 2, lp: 2000 }),
      ],
    ],
  },
  {
    id: 'cast_venom',
    len: 1.3,
    reverb: 0.15,
    trim: -2,
    variants: [
      [
        L(`${RX}/Background/Muck Bubbles.wav`, { start: 0.06, dur: 1.2 }),
        L(`${RSP}/NPC/slime/slime8.wav`, { gain: -3 }),
        L(`${RSP}/inventory/bubble2.wav`, { start: 0.062, delay: 300, gain: -4 }),
      ],
      [
        L(`${RX}/Background/Metal Bubbles.wav`, { dur: 1.2, gain: -3 }),
        L(`${R80}/creature_slime_02.ogg`, { start: 0.04 }),
        L(`${RSP}/inventory/bubble3.wav`, { start: 0.046, delay: 350, gain: -4 }),
      ],
      [
        L(`${KS}/slime_000.ogg`),
        L(`${RX}/Background/Muck Bubbles.wav`, { start: 1.5, dur: 1.2, gain: -2 }),
        L(`${R80}/creature_slime_04.ogg`, { delay: 200, gain: -3 }),
      ],
    ],
  },
  // Arcane.
  {
    id: 'cast_missile',
    len: 1.0,
    reverb: 0.15,
    trim: -2,
    variants: [
      [
        L(`${KD}/phaserUp1.ogg`, { start: 0.098, gain: -2 }),
        L(`${KS}/laserSmall_000.ogg`, { pitch: 0.9, delay: 30 }),
        L('magical_3.ogg', { dur: 0.9, gain: -4, delay: 60 }),
      ],
      [
        L(`${KD}/phaserUp3.ogg`, { start: 0.088, gain: -2 }),
        L(`${KS}/laserSmall_004.ogg`, { pitch: 0.9, delay: 30 }),
        L('magical_1.ogg', { start: 0.036, dur: 0.9, delay: 60 }),
      ],
      [
        L(`${KD}/phaserUp6.ogg`, { start: 0.074, gain: -2 }),
        L(`${KS}/laserSmall_002.ogg`, { pitch: 0.85, delay: 30 }),
        L('magical_5.ogg', { dur: 0.9, gain: 6, delay: 60 }),
      ],
    ],
  },
  {
    id: 'cast_beam',
    len: 1.3,
    reverb: 0.15,
    trim: -2,
    variants: [
      [
        L(`${KS}/laserLarge_001.ogg`, { dur: 1.0 }),
        L(`${KS}/forceField_000.ogg`, { gain: -8, delay: 100 }),
        L(`${KD}/laser1.ogg`, { start: 0.095, gain: -8, delay: 50 }),
      ],
      [
        L(`${KS}/laserLarge_003.ogg`, { dur: 1.0 }),
        L(`${KS}/forceField_002.ogg`, { gain: -8, delay: 100 }),
        L(`${KD}/laser5.ogg`, { start: 0.129, gain: -8, delay: 50 }),
      ],
      [
        L(`${KS}/laserLarge_004.ogg`, { dur: 1.0, pitch: 0.9 }),
        L(`${KS}/forceField_004.ogg`, { gain: -8, delay: 100 }),
        L(`${KD}/laser9.ogg`, { start: 0.108, gain: -8, delay: 50 }),
      ],
    ],
  },
  {
    id: 'cast_pulse',
    len: 1.2,
    reverb: 0.2,
    trim: -1,
    variants: [
      [
        L(`${KD}/lowThreeTone.ogg`, { start: 0.099, gain: -2 }),
        L(`${KS}/forceField_001.ogg`, { gain: -6 }),
        L('gravity_inverter.ogg', { start: 0.033, gain: -6, lp: 1500 }),
      ],
      [
        L(`${KD}/lowRandom.ogg`, { start: 0.098 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { start: 0.023, dur: 0.9, gain: -6 }),
        L(`${KS}/forceField_003.ogg`, { gain: -6, delay: 60 }),
      ],
    ],
  },
  {
    id: 'cast_blink',
    len: 1.2,
    reverb: 0.25,
    trim: -2,
    variants: [
      [L('teleport.wav', { start: 0.103, dur: 1.1 })],
      [
        L(`${KD}/phaseJump1.ogg`, { start: 0.123 }),
        L('teleport.wav', { start: 0.103, dur: 1.0, gain: -4, pitch: 1.15, delay: 40 }),
      ],
      [
        L(`${KD}/phaseJump4.ogg`, { start: 0.108 }),
        L(`${KD}/spaceTrash2.ogg`, { start: 0.098, dur: 0.8, reverse: true, gain: -8 }),
        L('teleport.wav', { start: 0.103, dur: 0.9, gain: -6, pitch: 0.9, delay: 80 }),
      ],
    ],
  },
  {
    id: 'cast_ward',
    len: 1.3,
    reverb: 0.25,
    trim: -2,
    variants: [
      [
        L(`${KS}/forceField_002.ogg`, { gain: -2 }),
        L(`${KD}/powerUp7.ogg`, { start: 0.109, gain: -4 }),
        L(`${K}/impactBell_heavy_003.ogg`, { pitch: 1.3, gain: -10, delay: 60 }),
      ],
      [
        L(`${KS}/forceField_004.ogg`, { gain: -2 }),
        L(`${KD}/powerUp11.ogg`, { start: 0.111, gain: -4 }),
        L(`${K}/impactBell_heavy_004.ogg`, { pitch: 1.2, gain: -10, delay: 60 }),
      ],
    ],
  },
  {
    id: 'cast_rune',
    len: 1.3,
    reverb: 0.3,
    trim: -2,
    variants: [
      [
        L(`${R80}/item_gem_04.ogg`, { start: 0.017 }),
        L('magical_4.ogg', { dur: 1.2, gain: 8, delay: 30 }),
        L('fantasy_magic_button_1.mp3', { start: 0.036, dur: 1.0, gain: -6 }),
      ],
      [
        L(`${R80}/item_gem_01.ogg`),
        L(`${R80}/item_gem_03.ogg`, { start: 0.011, delay: 120, gain: -3 }),
        L('magical_7.ogg', { dur: 1.2, gain: 10, delay: 30 }),
      ],
      [
        L(`${R80}/item_gem_02.ogg`, { start: 0.011, gain: 3 }),
        L('fantasy_magic_button_1.mp3', { start: 0.036, dur: 1.2 }),
        L(`${K}/impactBell_heavy_004.ogg`, { pitch: 1.6, gain: -8, delay: 100 }),
      ],
    ],
  },
  {
    id: 'cast_gravity',
    len: 1.2,
    reverb: 0.2,
    trim: -1,
    variants: [
      [L('gravity_inverter.ogg', { start: 0.033 })],
      [
        L('gravity_inverter.ogg', { start: 0.033, pitch: 0.85 }),
        L(`${KD}/spaceTrash4.ogg`, { start: 0.166, dur: 0.9, reverse: true, gain: -8 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { start: 0.023, dur: 0.8, gain: -8 }),
      ],
    ],
  },
  {
    id: 'cast_soar',
    len: 1.8,
    reverb: 0.2,
    trim: -2,
    variants: [
      [L('flight_sound.mp3', { start: 0.025, dur: 1.7 })],
      [
        L('flight_sound.mp3', { start: 0.025, dur: 1.7, pitch: 1.1 }),
        L('whoosh2_0.wav', { start: 0.4, dur: 1.2, gain: 2, hp: 400 }),
      ],
    ],
  },
  {
    id: 'cast_powerup',
    len: 1.2,
    reverb: 0.15,
    trim: -3,
    variants: [
      [L(`${KD}/powerUp1.ogg`, { start: 0.094 })],
      [
        L(`${KD}/powerUp3.ogg`, { start: 0.139 }),
        L(`${KD}/phaserUp2.ogg`, { start: 0.088, gain: -6, delay: 200 }),
      ],
      [
        L(`${KD}/powerUp12.ogg`, { start: 0.119 }),
        L(`${KD}/phaserUp5.ogg`, { start: 0.091, gain: -6, delay: 150 }),
      ],
    ],
  },
  {
    id: 'cast_drain',
    len: 1.5,
    reverb: 0.25,
    trim: -2,
    variants: [
      [
        L(`${KD}/phaserDown1.ogg`, { start: 0.12, gain: -2 }),
        L('powerdrain.ogg', { start: 0.3, dur: 1.3, gain: -3, delay: 50 }),
      ],
      [
        L(`${KD}/phaserDown3.ogg`, { start: 0.088, gain: -2 }),
        L('powerdrain.ogg', { dur: 1.4, pitch: 1.1, gain: -3, delay: 50 }),
        L(`${KS}/forceField_001.ogg`, { reverse: true, gain: -10 }),
      ],
    ],
  },
  // Light and nature.
  {
    id: 'cast_bloom',
    len: 1.6,
    reverb: 0.3,
    trim: -3,
    variants: [
      [
        L(`${CM}/Cure2.wav`),
        L(`${T}/chimes-wood-rattle.wav`, { start: 0.129, dur: 1.2, gain: -14, hp: 2000 }),
      ],
      [
        L(`${CM}/Cure5.wav`, { dur: 1.5 }),
        L(`${T}/chimes-wood-rattle.wav`, { start: 2.0, dur: 1.2, gain: -14, hp: 2000 }),
      ],
      [
        L(`${CM}/Cure8.wav`, { dur: 1.5 }),
        L(`${T}/chimes-wood-rattle.wav`, { start: 4.0, dur: 1.2, gain: -14, hp: 2000, pitch: 1.1 }),
      ],
    ],
  },
  {
    id: 'cast_holy',
    len: 1.9,
    reverb: 0.35,
    trim: -2,
    variants: [
      [
        L(`${K}/impactBell_heavy_001.ogg`, { gain: -2 }),
        L('health_restore.wav', { start: 0.012, dur: 1.8, gain: -4, delay: 80 }),
      ],
      [
        L(`${K}/impactBell_heavy_000.ogg`, { pitch: 0.9, gain: -2 }),
        L('health_restore.wav', { start: 0.5, dur: 1.7, gain: -4, delay: 60 }),
        L(`${CM}/Cure6.wav`, { dur: 1.5, gain: -8, delay: 100 }),
      ],
    ],
  },
  {
    id: 'cast_chime',
    len: 1.2,
    reverb: 0.3,
    trim: -3,
    variants: [
      [
        L(`${K}/impactBell_heavy_000.ogg`, { pitch: 1.5 }),
        L(`${K}/impactBell_heavy_001.ogg`, { pitch: 2.0, delay: 120, gain: -3 }),
        L(`${R80}/item_gem_03.ogg`, { start: 0.011, delay: 240, gain: -4 }),
      ],
      [
        L(`${K}/impactBell_heavy_001.ogg`, { pitch: 1.7 }),
        L(`${K}/impactBell_heavy_000.ogg`, { pitch: 2.2, delay: 110, gain: -3 }),
        L(`${R80}/item_gem_01.ogg`, { delay: 220, gain: -4 }),
      ],
      [
        L(`${K}/impactBell_heavy_000.ogg`, { pitch: 1.3 }),
        L(`${K}/impactBell_heavy_001.ogg`, { pitch: 1.9, delay: 130, gain: -3 }),
        L(`${R80}/item_gem_02.ogg`, { start: 0.011, delay: 260, gain: -1 }),
      ],
    ],
  },
  {
    id: 'cast_blessing',
    len: 1.5,
    reverb: 0.3,
    trim: -3,
    variants: [
      [
        L(`${KD}/powerUp4.ogg`, { start: 0.14, gain: -3 }),
        L(`${CM}/Cure3.wav`, { dur: 1.4, delay: 60 }),
      ],
      [
        L(`${KD}/powerUp9.ogg`, { start: 0.141, gain: -3 }),
        L(`${CM}/Cure1.wav`, { start: 0.012, dur: 1.4, delay: 60 }),
      ],
      [
        L(`${KD}/powerUp6.ogg`, { start: 0.14, gain: -3 }),
        L(`${CM}/Cure7.wav`, { dur: 1.4, delay: 60 }),
        L(`${K}/impactBell_heavy_004.ogg`, { pitch: 1.5, gain: -10, delay: 300 }),
      ],
    ],
  },
  {
    id: 'cast_growth',
    len: 1.5,
    reverb: 0.25,
    trim: -3,
    variants: [
      [
        L(`${T}/wood-twigs-break-01.wav`, { start: 0.027, gain: -4 }),
        L(`${T}/wood-twigs-break-02.wav`, { start: 0.1, delay: 180, gain: -6 }),
        L(`${CM}/Cure4.wav`, { delay: 100 }),
        L(`${T}/chimes-wood-rattle.wav`, { start: 6.0, dur: 1.2, gain: -16, hp: 2000, delay: 200 }),
      ],
      [
        L(`${T}/wood-twigs-break-02.wav`, { start: 0.1, gain: -4 }),
        L(`${T}/soil-steps-01.wav`, { start: 0.17, dur: 0.5, gain: -10 }),
        L(`${CM}/Cure2.wav`, { delay: 120, pitch: 0.95 }),
        L(`${T}/chimes-wood-rattle.wav`, { start: 8.0, dur: 1.2, gain: -16, hp: 2000, delay: 200 }),
      ],
    ],
  },
  {
    id: 'cast_incantation',
    len: 1.8,
    reverb: 0.3,
    trim: -2,
    variants: [
      [L('magic_words.wav', { start: 0.081, dur: 1.7 })],
      [
        L('magic_words.wav', { start: 1.5, dur: 1.7 }),
        L('magical_2.ogg', { gain: 2, delay: 200, lp: 4000 }),
      ],
    ],
  },
  // Shadow.
  {
    id: 'cast_curse',
    len: 1.6,
    reverb: 0.3,
    trim: -2,
    variants: [
      [
        L(`${RSP}/NPC/shade/shade8.wav`, { start: 0.047, gain: -2 }),
        L('powerdrain.ogg', { start: 0.5, dur: 1.2, gain: -4, delay: 100 }),
      ],
      [
        L(`${RSP}/NPC/shade/shade12.wav`, { start: 0.07, gain: -2 }),
        L(`${KD}/phaserDown2.ogg`, { start: 0.06, gain: -6, delay: 200 }),
        L('powerdrain.ogg', { dur: 1.2, gain: -6, delay: 150 }),
      ],
      [
        L(`${RSP}/NPC/shade/shade9.wav`, { start: 0.061, gain: -2 }),
        L('ghostbreath.flac', { start: 0.386, dur: 1.4, gain: 8, delay: 80 }),
      ],
    ],
  },
  {
    id: 'cast_void',
    len: 1.6,
    reverb: 0.3,
    trim: -1,
    variants: [
      [
        L(`${K}/impactBell_heavy_001.ogg`, { reverse: true, lp: 1000, gain: -4 }),
        L(`${KD}/spaceTrash1.ogg`, { start: 0.089, dur: 1.0, reverse: true, gain: -6 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { start: 0.037, dur: 1.2, gain: -2, delay: 700 }),
      ],
      [
        L(`${KS}/forceField_003.ogg`, { reverse: true, gain: -4 }),
        L(`${K}/impactBell_heavy_000.ogg`, { reverse: true, lp: 800, gain: -6 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { start: 0.023, dur: 0.9, delay: 800 }),
        L(`${KS}/explosionCrunch_000.ogg`, { gain: -8, delay: 820, lp: 1500 }),
      ],
    ],
  },
  {
    id: 'cast_wraith',
    len: 1.8,
    reverb: 0.35,
    trim: -2,
    variants: [
      [
        L('ghostbreath.flac', { start: 0.386, dur: 1.7, gain: 12 }),
        L(`${RX}/Background/Hollow Wind.wav`, { dur: 1.6, gain: 6, hp: 300 }),
      ],
      [
        L('ghostbreath.flac', { start: 1.2, dur: 1.7, gain: 12, pitch: 0.9 }),
        L(`${GV}/output (11).wav`, { start: 0.087, dur: 1.5, gain: -8, delay: 100 }),
      ],
    ],
  },
  {
    id: 'cast_lich',
    len: 1.8,
    reverb: 0.3,
    trim: -2,
    variants: [
      [L(`${GV}/output (1).wav`, { start: 0.064, dur: 1.7 })],
      [L(`${GV}/output (5).wav`, { start: 0.106, dur: 1.7 })],
      [L(`${GV}/output (13).wav`, { start: 0.084, dur: 1.7, gain: 3 })],
    ],
  },
  // Steel and body.
  {
    id: 'cast_clash',
    len: 1.1,
    reverb: 0.15,
    trim: -1,
    variants: [
      [
        L(`${T}/sword-clash-03.wav`, { start: 0.05 }),
        L(`${SC}/sword_clash.2.ogg`, { start: 0.03, gain: -4, delay: 20 }),
      ],
      [
        L(`${T}/sword-clash-05.wav`, { start: 0.027 }),
        L(`${SC}/sword_clash.4.ogg`, { start: 0.042, gain: -4, delay: 20 }),
      ],
      [
        L(`${T}/sword-clash-01.wav`, { start: 0.031, dur: 1.0 }),
        L(`${SC}/sword_clash.8.ogg`, { start: 0.146, gain: -4, delay: 20 }),
      ],
    ],
  },
  {
    id: 'cast_chains',
    len: 1.2,
    reverb: 0.15,
    trim: -1,
    variants: [
      [
        L(`${R80}/chain_03.ogg`, { start: 0.019 }),
        L(`${R80}/chain_01.ogg`, { start: 0.018, delay: 350, gain: -2 }),
        L(`${K}/impactMetal_heavy_001.ogg`, { delay: 600, gain: -4 }),
      ],
      [
        L(`${R80}/chain_02.ogg`),
        L(`${R80}/chain_03.ogg`, { start: 0.019, delay: 300, gain: -2 }),
        L(`${S100}/sfx100v2_metal_hit_01.ogg`, { start: 0.025, delay: 650, gain: -4 }),
      ],
      [
        L(`${R80}/chain_01.ogg`, { start: 0.018 }),
        L(`${R80}/chain_02.ogg`, { delay: 250, gain: -2 }),
        L(`${R80}/chain_03.ogg`, { start: 0.019, delay: 500, gain: -3 }),
        L(`${K}/impactMetal_heavy_003.ogg`, { delay: 700, gain: -4 }),
      ],
    ],
  },
  {
    id: 'cast_crush',
    len: 1.3,
    reverb: 0.2,
    trim: 0,
    variants: [
      [
        L(`${SW}/swish-7.wav`, { start: 0.018, pitch: 0.6, gain: -2 }),
        L(`${T}/metal-hammer-hit-01.wav`, { start: 0.022, dur: 1.0, delay: 120 }),
        L(`${K}/impactPlate_heavy_004.ogg`, { delay: 120, gain: -3 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { start: 0.037, dur: 0.9, delay: 120, gain: -4 }),
      ],
      [
        L(`${SW}/swish-9.wav`, { start: 0.034, pitch: 0.6, gain: -2 }),
        L(`${T}/metal-hammer-hit-02.wav`, { start: 0.018, dur: 1.0, delay: 120 }),
        L(`${K}/impactPlate_heavy_001.ogg`, { delay: 120, gain: -3 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { start: 0.023, dur: 0.9, delay: 120, gain: -4 }),
      ],
      [
        L(`${SW}/swish-4.wav`, { start: 0.027, pitch: 0.55, gain: -2 }),
        L(`${K}/impactMining_002.ogg`, { delay: 120 }),
        L(`${K}/impactPlate_heavy_003.ogg`, { delay: 120, gain: -3 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, {
          start: 0.037,
          dur: 0.9,
          delay: 120,
          gain: -3,
          pitch: 0.85,
        }),
      ],
    ],
  },
  {
    id: 'cast_stomp',
    len: 1.1,
    reverb: 0.15,
    trim: 0,
    variants: [
      [
        L(`${T}/boots-leather-jump-01.wav`, { start: 0.032, gain: -4 }),
        L(`${K}/impactSoft_heavy_001.ogg`, { delay: 60 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { start: 0.037, dur: 0.9, delay: 60, gain: -2 }),
        L(`${S100}/sfx100v2_stones_01.ogg`, { start: 0.02, delay: 120, gain: -10 }),
      ],
      [
        L(`${T}/mud-steps-03.wav`, { start: 0.274, dur: 0.4, gain: -4 }),
        L(`${K}/impactSoft_heavy_003.ogg`, { delay: 60 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, {
          start: 0.023,
          dur: 0.9,
          delay: 60,
          gain: -2,
          pitch: 0.9,
        }),
        L(`${R80}/stones_04.ogg`, { start: 0.022, delay: 120, gain: -10 }),
      ],
    ],
  },
  {
    id: 'cast_roar',
    len: 1.4,
    reverb: 0.25,
    trim: 0,
    variants: [
      [
        L(`${R80}/creature_roar_02.ogg`, { start: 0.042 }),
        L(`${RSP}/NPC/giant/giant2.wav`, { start: 0.017, gain: -6, delay: 50 }),
      ],
      [
        L(`${R80}/creature_roar_03.ogg`, { start: 0.03 }),
        L(`${RSP}/NPC/giant/giant5.wav`, { start: 0.033, gain: -6, delay: 50 }),
      ],
      [
        L(`${R80}/creature_roar_01.ogg`, { start: 0.021, pitch: 0.9 }),
        L(`${RSP}/NPC/gutteral beast/mnstr14.wav`, { start: 0.051, gain: -4, delay: 80 }),
      ],
    ],
  },
  {
    id: 'cast_growl',
    len: 1.2,
    reverb: 0.2,
    trim: -1,
    variants: [
      [
        L(`${RSP}/NPC/gutteral beast/mnstr5.wav`, { start: 0.03 }),
        L(`${RSP}/NPC/ogre/ogre2.wav`, { start: 0.025, gain: -6, delay: 100 }),
      ],
      [
        L(`${RSP}/NPC/gutteral beast/mnstr9.wav`, { start: 0.046 }),
        L(`${RSP}/NPC/ogre/ogre4.wav`, { start: 0.028, gain: -6, delay: 100 }),
      ],
      [
        L(`${RSP}/NPC/gutteral beast/mnstr11.wav`, { start: 0.027 }),
        L(`${R80}/creature_monster_01.ogg`, { gain: -4, delay: 150 }),
      ],
    ],
  },
  {
    id: 'cast_bite',
    len: 0.8,
    reverb: 0.1,
    trim: -2,
    variants: [
      [
        L(`${RSP}/NPC/beetle/bite-small3.wav`, { start: 0.024, gain: 2 }),
        L(`${RSP}/NPC/slime/slime6.wav`, { delay: 80, gain: -4 }),
        L(`${R80}/creature_misc_06.ogg`, { start: 0.059, delay: 40, gain: -6 }),
      ],
      [
        L(`${RSP}/NPC/beetle/bite-small.wav`, { gain: 2 }),
        L(`${RSP}/NPC/slime/slime9.wav`, { delay: 80, gain: -4 }),
        L(`${R80}/creature_hurt_01.ogg`, { start: 0.043, delay: 120, gain: -10 }),
      ],
    ],
  },
  {
    id: 'cast_dash',
    len: 0.8,
    reverb: 0.1,
    trim: -2,
    variants: [
      [
        L(`${T}/boots-leather-jump-01.wav`, { start: 0.032, dur: 0.3, gain: -6 }),
        L(`${T}/tube-plastic-whoosh-01.wav`, { start: 0.046, pitch: 0.8, delay: 40 }),
        L(`${SW}/swish-7.wav`, { start: 0.018, pitch: 0.75, delay: 60, gain: -3 }),
      ],
      [
        L(`${T}/boots-leather-step-01.wav`, { start: 0.035, dur: 0.3, gain: -6 }),
        L(`${T}/tube-plastic-whoosh-02.wav`, { start: 0.045, pitch: 0.8, delay: 40 }),
        L(`${SW}/swish-9.wav`, { start: 0.034, pitch: 0.75, delay: 60, gain: -3 }),
      ],
      [
        L(`${S100}/sfx100v2_air_03.ogg`, { start: 0.014 }),
        L(`${SW}/swish-3.wav`, { start: 0.033, pitch: 0.7, delay: 80, gain: -3 }),
        L(`${T}/compressed-air-spray-01.wav`, { start: 0.068, dur: 0.4, gain: -10, hp: 1000 }),
      ],
    ],
  },
  // Tech.
  {
    id: 'cast_gunfire',
    len: 1.0,
    reverb: 0.15,
    trim: 0,
    variants: [
      [
        L(`${G}/cz.wav`, { dur: 0.3 }),
        L(`${G}/cz.wav`, { dur: 0.3, delay: 120, gain: -1 }),
        L(`${G}/cz.wav`, { dur: 0.3, delay: 240, gain: -2 }),
        L(`${G}/cz.wav`, { dur: 0.5, delay: 360, gain: -2 }),
      ],
      [
        L('pistol22.wav', { start: 0.135, dur: 0.3 }),
        L('pistol22.wav', { start: 0.135, dur: 0.3, delay: 110, gain: -1, pitch: 1.05 }),
        L('pistol22.wav', { start: 0.135, dur: 0.5, delay: 220, gain: -2, pitch: 0.97 }),
      ],
      [
        L(`${G}/sks.wav`, { start: 0.04, dur: 0.3 }),
        L(`${G}/sks.wav`, { start: 0.04, dur: 0.3, delay: 150, gain: -1 }),
        L(`${G}/sks.wav`, { start: 0.04, dur: 0.6, delay: 300, gain: -2 }),
      ],
    ],
  },
  {
    id: 'cast_cannon',
    len: 1.6,
    reverb: 0.25,
    trim: 1,
    variants: [
      [
        L('blackpowder.wav', { start: 0.148, dur: 1.5 }),
        L(`${KS}/lowFrequency_explosion_000.ogg`, { start: 0.037, dur: 1.2, gain: -3 }),
      ],
      [
        L('blackpowder.wav', { start: 0.148, dur: 1.5, pitch: 0.85 }),
        L(`${G}/shotty.wav`, { gain: -4 }),
        L(`${KS}/lowFrequency_explosion_001.ogg`, { start: 0.023, dur: 1.0, gain: -3 }),
      ],
    ],
  },
  {
    id: 'cast_laser',
    len: 0.9,
    reverb: 0.15,
    trim: -2,
    variants: [
      [
        L(`${KS}/laserRetro_001.ogg`),
        L(`${KD}/laser2.ogg`, { start: 0.108, gain: -4, delay: 30 }),
        L(`${KS}/laserLarge_000.ogg`, { gain: -10, delay: 50 }),
      ],
      [
        L(`${KS}/laserRetro_003.ogg`),
        L(`${KD}/laser4.ogg`, { start: 0.181, gain: -4, delay: 30 }),
        L(`${KS}/laserLarge_002.ogg`, { gain: -10, delay: 50 }),
      ],
      [
        L(`${KS}/laserRetro_000.ogg`, { pitch: 0.9 }),
        L(`${KD}/laser7.ogg`, { start: 0.118, gain: -4, delay: 30 }),
        L(`${KS}/laserLarge_004.ogg`, { gain: -10, delay: 50 }),
      ],
    ],
  },
  {
    id: 'cast_shock',
    len: 1.1,
    reverb: 0.1,
    trim: -2,
    variants: [
      [
        L(`${T}/paralyzer-discharge-02.wav`, { start: 0.013, dur: 1.0 }),
        L(`${KD}/zapThreeToneDown.ogg`, { start: 0.1, dur: 0.8, gain: -8 }),
      ],
      [
        L(`${T}/paralyzer-discharge-01.wav`, { start: 0.012, dur: 0.9 }),
        L(`${T}/paralyzer-discharge-02.wav`, {
          start: 0.4,
          dur: 0.6,
          gain: -4,
          delay: 300,
          pitch: 1.1,
        }),
        L(`${KD}/zap2.ogg`, { start: 0.074, dur: 0.6, gain: -8 }),
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
  if (args.includes('--manifest')) {
    for (const r of RECIPES) console.log(`  ${r.id}: files('${r.id}', ${r.variants.length}),`);
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
