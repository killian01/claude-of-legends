// The tower's shot as the animation authored it: an amber gather at the
// crown, a flash and two rings at the departure, a directed missile with
// a twisting trail, and a burst of rings and fragments where it lands.
// Source: art_src/animations/tower_magic_attack_01 (a Blender scene keyed
// at 30 frames a second, launch at frame 45, impact at frame 64, built
// over the Star Orchard's own tower). This module is that timeline as
// data: every envelope below is the scene's keyframes, in source frames,
// read at a time measured from the launch so the sim's own beats can
// stretch the gather and leave the rest at its authored pace. Pure, so
// tests/tower_shot.test.ts pins it; vfx/tower_shot_fx.ts draws it.

import { attackWindupSeconds } from '../sim/combat/auto_attack';

export const SOURCE_FPS = 30;
export const LAUNCH_FRAME = 45;
export const IMPACT_FRAME = 64;
// The gather starts at the end of the rest: frame 15 to the launch.
export const CHARGE_FRAME = 15;
export const CHARGE_S = (LAUNCH_FRAME - CHARGE_FRAME) / SOURCE_FPS;

// The palette: the tower's own amber, its ivory core, and a softer gold
// for what lingers on the ground.
export const GOLD = 0xff5209;
export const CORE = 0xffd15e;
export const DIM = 0xff6b12;

export type Keys = readonly (readonly [frame: number, value: number])[];

// Piecewise linear between keys, held flat past either end.
export function envelope(keys: Keys, frame: number): number {
  const first = keys[0];
  if (!first) return 0;
  if (frame <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, v1] = keys[i]!;
    if (frame <= f1) {
      const [f0, v0] = keys[i - 1]!;
      return f1 === f0 ? v1 : v0 + ((frame - f0) / (f1 - f0)) * (v1 - v0);
    }
  }
  return keys[keys.length - 1]![1];
}

// The authored frame for a moment measured in seconds from the launch.
// Before the launch the gather is stretched (or squeezed) onto the window
// the game gives it; after it the flash, the flight and the impact run at
// their authored pace.
export function frameAt(sinceLaunchS: number, windowS = CHARGE_S): number {
  if (sinceLaunchS < 0) {
    const stretch = CHARGE_S / Math.max(1e-3, windowS);
    return LAUNCH_FRAME + sinceLaunchS * stretch * SOURCE_FPS;
  }
  return LAUNCH_FRAME + sinceLaunchS * SOURCE_FPS;
}

// When the next gather should begin after an attack event, so that it
// peaks exactly when the next bolt leaves: the attack period, plus the
// windup between the event and the bolt, minus the gather itself.
export function nextChargeDelayS(attackSpeed: number): number {
  const period = 1 / Math.max(0.1, attackSpeed);
  return Math.max(0, period + attackWindupSeconds(attackSpeed, false) - CHARGE_S);
}

// ------------------------------------------------------------------ charge

export const CHARGE_AURA_RADIUS = 0.46;
export const CHARGE_AURA: Keys = [
  [15, 0],
  [25, 0.25],
  [37, 0.68],
  [44, 1.45],
  [46, 0.8],
  [49, 0],
];
// The crystal's emission, 0.7 at rest and 16 at the peak, read as 0..1.
export const CHARGE_CRYSTAL: Keys = [
  [15, 0],
  [28, 0.085],
  [39, 0.41],
  [44, 1],
  [47, 0.085],
  [58, 0],
];
export const CHARGE_LIGHT: Keys = [
  [15, 0.015],
  [35, 0.15],
  [44, 1],
  [46, 0.6],
  [53, 0.015],
];
export const CHARGE_RINGS = 3;
export function chargeRingRadius(i: number): number {
  return 1.13 + i * 0.1;
}
export function chargeRingWidth(i: number): number {
  return i === 0 ? 0.027 : 0.015;
}
export function chargeRingScale(i: number): Keys {
  return [
    [17 + i * 3, 0],
    [25 + i * 3, 1.25],
    [40, 0.83],
    [44, 0.55],
    [48, 1.1],
    [52, 0],
  ];
}
// The orbit's Euler angles at a frame: each ring sits on its own tilt and
// turns about two axes as the gather fills.
export function chargeRingSpin(i: number, frame: number): [number, number, number] {
  return [0.65 + i * 0.65 + frame * 0.011, 0.4 + i * 0.4, i * 0.9 + frame * 0.06];
}
// The end of the gather's last trace (the crystal cooling).
export const CHARGE_END_FRAME = 58;

export const CHARGE_PARTICLES = 22;
export interface ChargeParticle {
  // Offset from the crown, in the game's axes (y up).
  x: number;
  y: number;
  z: number;
  scale: number;
}
// A mote drawn in on a spiral: starts about two meters out, ends at the
// aura's edge, on a staggered start so the stream never reads as one
// ring. Null before its start and after its end.
export function chargeParticle(i: number, frame: number): ChargeParticle | null {
  const start = 17 + (i % 11);
  const end = 42 + (i % 3);
  if (frame < start || frame > end) return null;
  const t = (frame - start) / (end - start);
  const a = (Math.PI * 2 * i) / CHARGE_PARTICLES;
  const reach = 2.3 * (1 - t) + 0.22;
  const scale = envelope(
    [
      [start, 0],
      [start + 3, 1],
      [end - 2, 0.8],
      [end, 0],
    ],
    frame,
  );
  return {
    x: Math.cos(a + t * 2.8) * reach,
    y: 0.5 * Math.sin(a * 2 + t) * reach,
    z: Math.sin(a + t * 2.8) * reach,
    scale,
  };
}

// ------------------------------------------------------------------ launch

// A flat flash across the muzzle, facing the flight.
export const LAUNCH_FLASH: Keys = [
  [44, 0],
  [45, 1.4],
  [47, 0.7],
  [50, 0],
];
export const LAUNCH_RINGS = 2;
export const LAUNCH_RING_RADIUS = 0.55;
export function launchRingScale(i: number): Keys {
  return [
    [43 + i * 2, 0.001],
    [45 + i * 2, 0.8],
    [48 + i * 2, 2.2],
    [54 + i * 2, 3.3],
  ];
}
export function launchRingWidth(i: number): Keys {
  return [
    [43 + i * 2, 0],
    [45 + i * 2, 0.024 - i * 0.006],
    [48 + i * 2, 0.016],
    [54 + i * 2, 0],
  ];
}
export const LAUNCH_END_FRAME = 57;

// ------------------------------------------------------------------ flight

// The missile's core is born small and full a beat later; its three
// filaments follow.
export const FLIGHT_HEAD: Keys = [
  [44, 0],
  [45, 0.35],
  [47, 1],
];
export const FLIGHT_FILAMENTS: Keys = [
  [44, 0],
  [46, 1],
];
export const FILAMENTS = 3;
export const FILAMENT_RADIUS = 0.028;
// A filament's point along the missile: from the tail to the nose, wound
// 1.3 turns round the axis, fattest at the middle. Axes: x forward.
export function filamentPoint(i: number, t: number): [number, number, number] {
  const a = (i * Math.PI * 2) / FILAMENTS + t * Math.PI * 2 * 1.3;
  const r = 0.25 * Math.sin(t * Math.PI);
  return [-0.55 + t * 0.95, Math.cos(a) * r, Math.sin(a) * r];
}
// The trail turns about the flight line as it streams.
export const TRAIL_SPIN_RAD_S = 0.21 * SOURCE_FPS;
// Sparks shed behind the bolt: eighteen over thirteen frames, each alive
// nine, drifting three quarters of a meter on and a little down.
export const SPARK_RATE_PER_S = (18 / 13) * SOURCE_FPS;
export const SPARK_LIFE_S = 9 / SOURCE_FPS;
export const SPARK_SPREAD = 0.28;
export const SPARK_DRIFT_FORWARD = 0.75;
export const SPARK_DRIFT_DOWN = 0.3;

// ------------------------------------------------------------------ impact

export const IMPACT_BURST_RADIUS = 0.65;
export const IMPACT_BURST: Keys = [
  [63, 0],
  [64, 0.45],
  [65, 1],
  [67, 0.65],
  [70, 0],
];
export const IMPACT_RINGS = 3;
export function impactRingWidthBase(i: number): number {
  return 0.028 - i * 0.005;
}
export function impactRingScale(i: number): Keys {
  const s = 63 + i * 2;
  return [
    [s, 0.001],
    [s + 3, 0.5],
    [s + 9, 1.55],
    [s + 20, 2.8],
  ];
}
export function impactRingWidth(i: number): Keys {
  const s = 63 + i * 2;
  return [
    [s, 0],
    [s + 3, 0.023],
    [s + 9, 0.012],
    [s + 20, 0],
  ];
}
// Each ring's normal leans a little further off the flight line: up, and
// aside.
export function impactRingLean(i: number): [up: number, aside: number] {
  return [0.1 * i, 0.18 * i];
}
export const IMPACT_GROUND_RINGS = 2;
export function impactGroundRingStartS(i: number): number {
  return (65 + i * 3 - IMPACT_FRAME) / SOURCE_FPS;
}
export const IMPACT_GROUND_RING_S = 24 / SOURCE_FPS;
export const IMPACT_GROUND_RING_RADIUS = 2.8;
export const IMPACT_LIGHT: Keys = [
  [63, 0],
  [65, 1],
  [69, 0.5],
  [78, 0],
];
export const IMPACT_END_FRAME = 92;

export const IMPACT_FRAGMENTS = 34;
// Blender keyed the fragments' fall as 2.8 t squared: an acceleration of
// 5.6 meters a second squared.
export const FRAGMENT_GRAVITY = 5.6;
export interface Fragment {
  dx: number;
  dy: number;
  dz: number;
  speed: number;
  lifeS: number;
  // Every fifth fragment burns ivory, the rest amber.
  bright: boolean;
}
// A small deterministic generator so the burst is the same shape on every
// engine and in every test (presentation only, never the sim's Rng).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function impactFragments(seed = 831): Fragment[] {
  const rnd = lcg(seed);
  const out: Fragment[] = [];
  for (let i = 0; i < IMPACT_FRAGMENTS; i++) {
    const dx = rnd() * 2 - 1;
    const dz = rnd() * 2 - 1;
    const dy = rnd() * 1.25 - 0.25;
    const n = Math.hypot(dx, dy, dz) || 1;
    const speed = 2 + rnd() * 3;
    const lifeS = (11 + Math.floor(rnd() * 14)) / SOURCE_FPS;
    out.push({ dx: dx / n, dy: dy / n, dz: dz / n, speed, lifeS, bright: i % 5 === 0 });
  }
  return out;
}
