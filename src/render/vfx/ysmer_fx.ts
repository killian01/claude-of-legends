// Ysmer's visuals, built procedurally from the shared VFX vocabulary: the
// lamplight of her bolts, the lantern she hangs, the changeling spark, and
// the thread of light every trade of places draws between its two spots
// (CONTEXT.md: Trade places). Presentation only: the sim owns every
// target, lifetime and number; these read the zone's radius and age.

import * as THREE from 'three';
import { basicMat, flatDisc, flatRing } from './shapes';
import { SPRITE } from './sprites';
import type { VfxSystem } from './system';

// The lamp's amber, its pale heart, and the iron of the cage; the spark's
// twin colors, one for each side of a trade.
export const LAMP = { main: 0xffb347, glow: 0xffe6a8, iron: 0x3b3640 } as const;
export const SPARK = { warm: 0xffc46b, cool: 0x9fd8ff } as const;

// How long the thread of a trade hangs between its two spots.
export const THREAD_MS = 520;

// A bead of lamplight: a hot white core in an amber sheath, round so it
// reads the same from every heading.
export function buildWick(radius: number): THREE.Object3D {
  const holder = new THREE.Group();
  holder.userData.stretch = false;
  const r = Math.max(0.18, radius * 0.45);
  holder.add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 8, 6), basicMat(0xfff6e0, 1)));
  holder.add(new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), basicMat(LAMP.main, 0.45, true)));
  return holder;
}

// Embers falling off the bolt as it flies.
export function wickTrail(fx: VfxSystem, x: number, z: number): void {
  fx.particles.spawn({
    x: x + (Math.random() - 0.5) * 0.2,
    y: 1.0 + (Math.random() - 0.5) * 0.2,
    z: z + (Math.random() - 0.5) * 0.2,
    vy: -0.4,
    life: 0.4,
    size0: 0.3,
    size1: 0.05,
    color0: LAMP.glow,
    color1: LAMP.main,
    alpha0: 0.8,
    alpha1: 0,
    sprite: SPRITE.spark,
  });
}

// The bolt bursting: a warm flash and a spray of embers.
export function wickImpact(fx: VfxSystem, x: number, z: number): void {
  fx.glowFlash(x, 1.1, z, 1.3, LAMP.glow, 0.18);
  fx.sparkBurst(x, 1.0, z, LAMP.main, 7, 4, { life: 0.35, size: 0.3 });
}

// The Hung Lantern: an iron post with a lantern on it, its light pooled on
// the ground. A friendly pool is warm; a foe's lantern wears a red rim so
// its reveal reads as a threat.
export function buildHungLantern(radius: number, hostile: boolean): THREE.Object3D {
  const holder = new THREE.Group();
  holder.add(flatDisc(radius, LAMP.main, 0.12, 0.06));
  holder.add(flatRing(radius - 0.12, radius, hostile ? 0xff6a4a : LAMP.glow, 0.6, 0.07));
  const iron = new THREE.MeshLambertMaterial({ color: LAMP.iron, flatShading: true });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.7, 5), iron);
  post.position.y = 0.85;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), iron);
  arm.position.set(0.22, 1.68, 0);
  const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.36, 6, 1, true), iron);
  cage.position.set(0.42, 1.42, 0);
  const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.13), basicMat(LAMP.glow, 1));
  flame.position.copy(cage.position);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), basicMat(LAMP.main, 0.3, true));
  halo.position.copy(cage.position);
  holder.add(post, arm, cage, flame, halo);
  holder.userData.flame = flame;
  holder.userData.halo = halo;
  return holder;
}

// The flame flickers; now and then a mote of light rises off the pool.
export function lanternTick(
  fx: VfxSystem,
  holder: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  ageMs: number,
  dtMs: number,
): void {
  const flame = holder.userData.flame as THREE.Mesh | undefined;
  const halo = holder.userData.halo as THREE.Mesh | undefined;
  const flicker = 1 + 0.12 * Math.sin(ageMs * 0.023) + 0.06 * Math.sin(ageMs * 0.061);
  flame?.scale.setScalar(flicker);
  halo?.scale.setScalar(0.9 + 0.1 * flicker);
  if (Math.random() > dtMs / 180) return;
  const a = Math.random() * Math.PI * 2;
  const d = Math.random() * radius * 0.85;
  fx.particles.spawn({
    x: x + Math.cos(a) * d,
    y: 0.2,
    z: z + Math.sin(a) * d,
    vy: 0.9,
    life: 0.9,
    size0: 0.22,
    size1: 0.06,
    color0: LAMP.glow,
    color1: LAMP.main,
    alpha0: 0.75,
    alpha1: 0,
    sprite: SPRITE.spark,
  });
}

// The changeling spark: two motes of different light circling each other,
// the trade it carries.
export function buildSpark(radius: number): THREE.Object3D {
  const holder = new THREE.Group();
  holder.userData.stretch = false;
  const r = Math.max(0.12, radius * 0.3);
  const spin = new THREE.Group();
  const warm = new THREE.Mesh(new THREE.OctahedronGeometry(r), basicMat(SPARK.warm, 1));
  warm.position.x = r * 1.4;
  const cool = new THREE.Mesh(new THREE.OctahedronGeometry(r), basicMat(SPARK.cool, 1));
  cool.position.x = -r * 1.4;
  spin.add(warm, cool);
  holder.add(spin);
  holder.add(
    new THREE.Mesh(new THREE.SphereGeometry(r * 2.4, 8, 6), basicMat(0xffffff, 0.18, true)),
  );
  holder.userData.spin = spin;
  return holder;
}

export function sparkTick(fx: VfxSystem, x: number, z: number, holder: THREE.Object3D): void {
  const spin = holder.userData.spin as THREE.Object3D | undefined;
  if (spin) spin.rotation.y += 0.45;
  if (Math.random() < 0.5) return;
  fx.particles.spawn({
    x,
    y: 1.0,
    z,
    life: 0.3,
    size0: 0.25,
    size1: 0.05,
    color0: Math.random() < 0.5 ? SPARK.warm : SPARK.cool,
    alpha0: 0.7,
    alpha1: 0,
    sprite: SPRITE.spark,
  });
}

export function sparkImpact(fx: VfxSystem, x: number, z: number): void {
  fx.glowFlash(x, 1.1, z, 1.2, 0xffffff, 0.16);
  fx.sparkBurst(x, 1.0, z, SPARK.warm, 4, 3.5, { life: 0.3, size: 0.28 });
  fx.sparkBurst(x, 1.0, z, SPARK.cool, 4, 3.5, { life: 0.3, size: 0.28 });
}

// In My Stead: the lantern raised, a column of lamplight at her feet.
export function steadRaise(fx: VfxSystem, x: number, z: number): void {
  fx.pillars.spawn(x, z, 0.9, 4.5, LAMP.main, 420, 0.35);
  fx.rings.spawn(x, z, 1.6, LAMP.glow, 380, { width: 0.2, alpha: 0.8 });
}

// One end of a trade: a flash where a body stands now, a ring at its feet.
function tradeEnd(fx: VfxSystem, x: number, z: number, color: number): void {
  fx.glowFlash(x, 1.2, z, 2.4, color, 0.3);
  fx.rings.spawn(x, z, 1.3, color, 420, { width: 0.3, alpha: 1 });
  fx.sparkBurst(x, 1.1, z, color, 6, 3, { life: 0.35, size: 0.3 });
}

// The thread of a trade: a near-straight line of amber light between the
// two spots at chest height for a beat, a flash at each end, motes along it
// and a warm light between. Same reading from either side: both moved.
export function tradeThread(fx: VfxSystem, ax: number, az: number, bx: number, bz: number): void {
  const from = new THREE.Vector3(ax, 1.15, az);
  const to = new THREE.Vector3(bx, 1.15, bz);
  fx.bolts.spawn(from, to, LAMP.main, THREAD_MS, 0.3, 0.05);
  fx.bolts.spawn(from, to, LAMP.glow, THREAD_MS * 0.7, 0.12, 0.02);
  tradeEnd(fx, ax, az, SPARK.warm);
  tradeEnd(fx, bx, bz, SPARK.cool);
  fx.lightPulse((ax + bx) / 2, (az + bz) / 2, LAMP.main, 4, THREAD_MS);
  for (let i = 0; i < 10; i++) {
    const t = Math.random();
    fx.particles.spawn({
      x: ax + (bx - ax) * t,
      y: 1.15 + (Math.random() - 0.5) * 0.2,
      z: az + (bz - az) * t,
      vy: 0.5,
      life: 0.5 + Math.random() * 0.3,
      size0: 0.24,
      size1: 0.04,
      color0: LAMP.glow,
      color1: LAMP.main,
      alpha0: 0.85,
      alpha1: 0,
      sprite: SPRITE.spark,
    });
  }
}
