// Nisk's visuals, built procedurally from the shared VFX vocabulary: the
// darts (a pepper dart shedding stinging dust, the poisoned auto darts),
// the sprint's dust, the poison coating its darts, the hidden pod and the
// sour cloud it bursts into. Presentation only: the sim owns every target,
// lifetime and number; these read the zone's radius and age.

import * as THREE from 'three';
import { basicMat, flatDisc, flatRing } from './shapes';
import { SPRITE } from './sprites';
import type { VfxSystem } from './system';

// The sour poison of the pods and the coated darts, and the pepper of the
// dart that makes its victim fumble.
export const SOUR = { main: 0x8fd14a, glow: 0xd8f57a, deep: 0x3f6b1e } as const;
export const PEPPER = { main: 0xe8652a, glow: 0xffb070 } as const;

// A slim dart along X (the flight axis): a needle body, a bright tip and a
// tuft of fletching; `tip` colors the point and the glow sheath.
export function buildDart(tip: number, length = 1): THREE.Object3D {
  const holder = new THREE.Group();
  holder.userData.stretch = false;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.7 * length, 5),
    new THREE.MeshBasicMaterial({ color: 0xd9c9a0 }),
  );
  shaft.rotation.z = Math.PI / 2;
  holder.add(shaft);
  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.22 * length, 5),
    new THREE.MeshBasicMaterial({ color: tip }),
  );
  (point.material as THREE.MeshBasicMaterial).toneMapped = false;
  point.rotation.z = -Math.PI / 2;
  point.position.x = 0.45 * length;
  holder.add(point);
  const tuft = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.2 * length, 4),
    new THREE.MeshBasicMaterial({ color: 0xf2e6c4 }),
  );
  tuft.rotation.z = -Math.PI / 2;
  tuft.position.x = -0.38 * length;
  holder.add(tuft);
  const sheath = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), basicMat(tip, 0.35, true));
  sheath.scale.set(2.6 * length, 0.5, 0.5);
  holder.add(sheath);
  return holder;
}

// Stinging dust shed behind the pepper dart.
export function pepperTrail(fx: VfxSystem, x: number, z: number): void {
  fx.particles.spawn({
    x: x + (Math.random() - 0.5) * 0.3,
    y: 1.0 + (Math.random() - 0.5) * 0.2,
    z: z + (Math.random() - 0.5) * 0.3,
    vy: 0.4,
    life: 0.45,
    size0: 0.35,
    size1: 0.9,
    color0: PEPPER.glow,
    color1: PEPPER.main,
    alpha0: 0.55,
    alpha1: 0,
    sprite: SPRITE.smoke,
    rot: Math.random() * Math.PI * 2,
    drag: 1.5,
  });
}

// The pepper bursting in the victim's face: a puff of orange dust at head
// height and a few hot flecks.
export function pepperImpact(fx: VfxSystem, x: number, z: number): void {
  fx.glowFlash(x, 1.3, z, 1.6, PEPPER.glow, 0.18);
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    fx.particles.spawn({
      x,
      y: 1.4,
      z,
      vx: Math.cos(a) * 1.6,
      vy: 0.5 + Math.random() * 0.6,
      vz: Math.sin(a) * 1.6,
      life: 0.7 + Math.random() * 0.4,
      size0: 0.5,
      size1: 1.6,
      color0: PEPPER.glow,
      color1: PEPPER.main,
      alpha0: 0.6,
      alpha1: 0,
      sprite: SPRITE.smoke,
      rot: Math.random() * Math.PI * 2,
      rotVel: (Math.random() * 2 - 1) * 1.2,
      drag: 1.8,
    });
  }
  fx.sparkBurst(x, 1.3, z, PEPPER.main, 6, 4, { life: 0.35, size: 0.3 });
}

// A poisoned auto dart landing: a green spit of droplets.
export function sourSplash(fx: VfxSystem, x: number, z: number): void {
  fx.sparkBurst(x, 1.0, z, SOUR.main, 5, 4, { life: 0.3, size: 0.3, gravity: 12 });
  fx.glowFlash(x, 1.05, z, 0.8, SOUR.glow, 0.12);
}

// Hightail: dust kicked up at the heels and a few wind streaks.
export function hightailBurst(fx: VfxSystem, x: number, z: number, dx: number, dz: number): void {
  fx.smokePuffs(x, z, 0xc8b48a, 4, 0.6);
  const len = Math.hypot(dx, dz) || 1;
  for (let i = 0; i < 6; i++) {
    const side = (Math.random() - 0.5) * 1.2;
    fx.particles.spawn({
      x: x - (dz / len) * side,
      y: 0.5 + Math.random() * 0.9,
      z: z + (dx / len) * side,
      vx: (-dx / len) * 7,
      vz: (-dz / len) * 7,
      life: 0.28,
      size0: 0.6,
      size1: 0.15,
      color0: 0xf4f0dc,
      alpha0: 0.7,
      sprite: SPRITE.spark,
      rot: Math.atan2(dx, dz),
    });
  }
}

// Bittertip: the darts dipped in poison, a green welling around Nisk.
export function bittertipCoat(fx: VfxSystem, x: number, z: number): void {
  fx.glowFlash(x, 1.0, z, 1.8, SOUR.glow, 0.25);
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.3 + Math.random() * 0.4;
    fx.particles.spawn({
      x: x + Math.cos(a) * r,
      y: 0.4 + Math.random() * 0.6,
      z: z + Math.sin(a) * r,
      vy: 1.2 + Math.random() * 0.8,
      life: 0.6 + Math.random() * 0.3,
      size0: 0.28,
      size1: 0.08,
      color0: SOUR.glow,
      color1: SOUR.main,
      alpha0: 0.9,
      sprite: SPRITE.glow,
      gravity: -1,
    });
  }
}

// The pod: a half-buried bulb with a sour sheen. To its own team it shows
// a faint ring of where it bursts; to an enemy that stands close enough to
// see it, a warning rim.
export function buildPod(radius: number, hostile: boolean): THREE.Object3D {
  const holder = new THREE.Group();
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 8, 6),
    new THREE.MeshLambertMaterial({
      color: 0x5c7a2a,
      emissive: SOUR.main,
      emissiveIntensity: 0.35,
      flatShading: true,
    }),
  );
  bulb.scale.set(1, 0.6, 1);
  bulb.position.y = 0.05;
  holder.add(bulb);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.36, 4),
      new THREE.MeshLambertMaterial({ color: 0x3f6b1e, flatShading: true }),
    );
    leaf.position.set(Math.cos(a) * 0.26, 0.12, Math.sin(a) * 0.26);
    leaf.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    holder.add(leaf);
  }
  holder.add(flatRing(radius - 0.06, radius, hostile ? 0xff7a3a : SOUR.glow, 0.45, 0.06));
  if (hostile) holder.add(flatDisc(radius, 0xff7a3a, 0.1, 0.05));
  holder.userData.bulb = bulb;
  return holder;
}

// The pod breathes, slow and low, so a careful eye catches it.
export function podTick(holder: THREE.Object3D, ageMs: number): void {
  const bulb = holder.userData.bulb as THREE.Mesh | undefined;
  if (!bulb) return;
  const s = 1 + 0.08 * Math.sin(ageMs * 0.004);
  bulb.scale.set(s, 0.6 * s, s);
}

// The cloud a pod bursts into: two low sour layers and a rim; it rolls.
export function buildCloud(radius: number, hostile: boolean): THREE.Object3D {
  const holder = new THREE.Group();
  holder.add(flatDisc(radius, SOUR.deep, 0.28, 0.07));
  const inner = flatDisc(radius * 0.75, SOUR.main, 0.22, 0.09);
  holder.add(inner);
  holder.add(flatRing(radius - 0.22, radius, hostile ? 0xc8e04a : SOUR.glow, 0.7, 0.1));
  holder.userData.inner = inner;
  return holder;
}

// The burst on the cloud's first frame, then bubbles and sour smoke
// rising off it while it lasts.
export function cloudTick(
  fx: VfxSystem,
  holder: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  ageMs: number,
  dtMs: number,
): void {
  if (!holder.userData.burst) {
    holder.userData.burst = true;
    fx.glowFlash(x, 0.9, z, radius * 1.6, SOUR.glow, 0.3);
    fx.sparkBurst(x, 0.5, z, SOUR.main, 16, 7, { life: 0.5, gravity: 14 });
    fx.rings.spawn(x, z, radius * 1.1, SOUR.main, 420, { alpha: 0.7 });
    fx.smokePuffs(x, z, SOUR.main, 6, radius * 0.6);
    fx.lightPulse(x, z, SOUR.main, 8, 360);
  }
  const inner = holder.userData.inner as THREE.Mesh | undefined;
  if (inner) inner.rotation.z = ageMs * 0.0008;
  const rate = (dtMs / 1000) * 14;
  const n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius * 0.9;
    const bubble = Math.random() < 0.45;
    fx.particles.spawn({
      x: x + Math.cos(a) * r,
      y: 0.2,
      z: z + Math.sin(a) * r,
      vy: bubble ? 1.4 : 0.7,
      life: bubble ? 0.7 : 1.2,
      size0: bubble ? 0.22 : 0.9,
      size1: bubble ? 0.32 : 2.0,
      color0: bubble ? SOUR.glow : SOUR.main,
      color1: SOUR.deep,
      alpha0: bubble ? 0.85 : 0.35,
      alpha1: 0,
      sprite: bubble ? SPRITE.glow : SPRITE.smoke,
      rot: Math.random() * Math.PI * 2,
      drag: 0.8,
    });
  }
}
