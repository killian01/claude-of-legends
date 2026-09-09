// The spell VFX engine: owns every pooled primitive (particles, shock
// rings, pillars, bolts, decals, debris, light pulses), a delayed-beat
// queue (staggered layers read bigger than one simultaneous blob), and the
// camera-shake budget hook. Presentation only; the renderer feeds it time.

import * as THREE from 'three';
import type { GroundHeight } from '../terrain';
import { LightningBolts } from './bolts';
import { DebrisField } from './debris';
import { GroundDecals } from './decals';
import { ParticleCloud } from './particles';
import { LightPillars } from './pillars';
import { ShockRings } from './rings';
import { SPRITE } from './sprites';

const LIGHT_POOL = 3;
const MAX_BEATS = 48;

interface LightSlot {
  light: THREE.PointLight;
  bornAt: number;
  duration: number;
  peak: number;
  active: boolean;
}

export class VfxSystem {
  readonly particles: ParticleCloud;
  readonly rings: ShockRings;
  readonly pillars: LightPillars;
  readonly bolts: LightningBolts;
  readonly decals: GroundDecals;
  readonly debris: DebrisField;
  // Injected by the renderer: adds trauma to the camera shake budget.
  onShake: (strength: number) => void = () => undefined;
  private readonly beats: { at: number; fn: () => void }[] = [];
  private readonly lights: LightSlot[] = [];

  constructor(
    scene: THREE.Scene,
    private readonly groundHeight?: GroundHeight,
  ) {
    this.particles = new ParticleCloud(scene, groundHeight);
    this.rings = new ShockRings(scene, groundHeight);
    this.pillars = new LightPillars(scene, groundHeight);
    this.bolts = new LightningBolts(scene, groundHeight);
    this.decals = new GroundDecals(scene, groundHeight);
    this.debris = new DebrisField(scene, groundHeight);
    // The light pool is created eagerly and stays visible at intensity 0:
    // Three bakes the light COUNT into every lit material's program, so a
    // light appearing mid-fight would relink all of them (the woc lesson).
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 26, 2);
      light.position.set(0, 3, 0);
      scene.add(light);
      this.lights.push({ light, bornAt: 0, duration: 1, peak: 0, active: false });
    }
  }

  schedule(delayMs: number, fn: () => void): void {
    if (this.beats.length >= MAX_BEATS) return;
    this.beats.push({ at: performance.now() + delayMs, fn });
  }

  lightPulse(x: number, z: number, color: number, intensity: number, durationMs: number): void {
    let slot = this.lights.find((s) => !s.active);
    // Steal the dimmest pulse so the biggest moment always shows.
    if (!slot) slot = this.lights.reduce((a, b) => (a.peak <= b.peak ? a : b));
    slot.active = true;
    slot.bornAt = performance.now();
    slot.duration = durationMs;
    slot.peak = intensity;
    slot.light.color.set(color);
    slot.light.position.set(x, 3 + (this.groundHeight?.(x, z) ?? 0), z);
  }

  // A radial burst of hot sparks; the workhorse impact garnish.
  sparkBurst(
    x: number,
    y: number,
    z: number,
    color: number,
    count: number,
    speed: number,
    opts?: { life?: number; size?: number; gravity?: number; up?: number; sprite?: number },
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      this.particles.spawn({
        x,
        y,
        z,
        vx: Math.cos(a) * v,
        vy: (opts?.up ?? speed * 0.55) * (0.3 + Math.random() * 0.7),
        vz: Math.sin(a) * v,
        life: (opts?.life ?? 0.55) * (0.6 + Math.random() * 0.8),
        size0: (opts?.size ?? 0.5) * (0.7 + Math.random() * 0.6),
        size1: 0.08,
        color0: 0xffffff,
        color1: color,
        alpha0: 1,
        alpha1: 0,
        sprite: opts?.sprite ?? SPRITE.fleck,
        gravity: opts?.gravity ?? 16,
        drag: 1.2,
      });
    }
  }

  // One big soft flash; the white-hot center of any explosion.
  glowFlash(x: number, y: number, z: number, size: number, color: number, lifeS = 0.3): void {
    this.particles.spawn({
      x,
      y,
      z,
      life: lifeS,
      size0: size * 0.5,
      size1: size,
      color0: 0xffffff,
      color1: color,
      alpha0: 0.95,
      alpha1: 0,
      sprite: SPRITE.glow,
    });
  }

  // Lazy smoke puffs drifting up; reads as aftermath, tint dim.
  smokePuffs(x: number, z: number, color: number, count: number, radius: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      this.particles.spawn({
        x: x + Math.cos(a) * r,
        y: 0.4,
        z: z + Math.sin(a) * r,
        vy: 1.6 + Math.random() * 1.2,
        life: 0.9 + Math.random() * 0.7,
        size0: 0.8,
        size1: 2.4,
        color0: color,
        alpha0: 0.4,
        alpha1: 0,
        sprite: SPRITE.smoke,
        rot: Math.random() * Math.PI * 2,
        rotVel: (Math.random() * 2 - 1) * 0.8,
        drag: 0.6,
      });
    }
  }

  update(now: number, dtMs: number, camDir: THREE.Vector3): void {
    for (let i = this.beats.length - 1; i >= 0; i--) {
      const beat = this.beats[i]!;
      if (now >= beat.at) {
        this.beats.splice(i, 1);
        beat.fn();
      }
    }
    const dtS = Math.min(0.1, dtMs / 1000);
    this.particles.update(dtS);
    this.rings.update(now);
    this.pillars.update(now);
    this.bolts.update(now, camDir);
    this.decals.update(now);
    this.debris.update(dtS);
    for (const s of this.lights) {
      if (!s.active) continue;
      const t = (now - s.bornAt) / s.duration;
      if (t >= 1) {
        s.active = false;
        s.peak = 0;
        s.light.intensity = 0;
        continue;
      }
      // Fast attack, quadratic decay.
      const k = t < 0.12 ? t / 0.12 : (1 - (t - 0.12) / 0.88) ** 2;
      s.light.intensity = s.peak * k;
    }
  }
}
