// Pure pose-selection logic for champion visuals: renderer-derived input in,
// desired base state out. No three.js imports so Vitest exercises the
// priority order directly; visual.ts owns the mixer that acts on it.

export type ChampionBaseState = 'idle' | 'run' | 'windup' | 'dead';

// What the renderer knows about a champion this frame, presentation-side.
export interface ChampionAnimInput {
  moving: boolean;
  windingUp: boolean;
  dead: boolean;
  // Actual ground speed, world units per second; drives the run clip's time
  // scale so feet stay planted through slows and speed buffs. Optional so
  // poses can be selected without motion data.
  speed?: number;
}

// The run clip's time scale for a champion moving at `speed`, given the
// def's reference speed (the speed at which the authored clip looks
// planted). Clamped so extreme slows or hastes never look broken.
export function runTimeScale(speed: number, referenceSpeed: number): number {
  if (referenceSpeed <= 0) return 1;
  return Math.min(1.9, Math.max(0.55, speed / referenceSpeed));
}

// Reference speed when a def does not author one: near the roster's base
// move speed, so unbuffed movement plays clips at authored pace.
export const DEFAULT_RUN_SPEED = 3.7;

// Priority: death overrides everything; a charging cast holds its windup
// loop even while the champion drifts; otherwise locomotion.
export function desiredBaseState(s: ChampionAnimInput): ChampionBaseState {
  if (s.dead) return 'dead';
  if (s.windingUp) return 'windup';
  if (s.moving) return 'run';
  return 'idle';
}

// One-shot playback windows in seconds. Source clips are authored at leisure
// (a KayKit sword swing runs about a second); combat reads at MOBA tempo, so
// every one-shot is compressed to a fixed duration instead of trusting the
// authored speed. Death fills the corpse window the renderer already keeps.
export const ONESHOT_SECONDS = {
  attack: 0.45,
  cast: 0.55,
  hit: 0.35,
  death: 0.55,
} as const;

// Crossfade lengths, seconds: base-to-base blends stay soft; one-shots snap
// harder so an attack lands on the beat.
export const FADE_BASE = 0.16;
export const FADE_SHOT = 0.08;

// How long a stowable weapon stays in hand after the last swing or cast
// before going back on the back. Autos chain at roughly 1.5 s apart, so the
// weapon must never flicker to the back between two of them.
export const WEAPON_STOW_DELAY_MS = 3500;
