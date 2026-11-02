// Ostrand's visuals, built procedurally from the shared VFX vocabulary: the
// Lance Drive's steel point and the crimson streak it leaves, the Standard
// planted in the ground with its ward circle, the thrown gauntlet trailing
// its red ribbon, and the dust of the Oathfield's stones breaking the
// ground (the ring itself is drawn by rampart.ts). Presentation only: the
// sim owns every target, lifetime and number; these read the zone's radius
// and age.

import * as THREE from 'three';
import { basicMat, flatDisc, flatRing } from './shapes';
import { SPRITE } from './sprites';
import type { VfxSystem } from './system';

// The oath's crimson, the battered steel of his plate, the Standard's gold.
export const OATH = { main: 0xc0282e, glow: 0xff6a5a, deep: 0x5a1014 } as const;
export const STEEL = 0xc8ccd4;
export const WARD = 0xf2c66a;
export const STONE = 0x8a8478;

// The Lance Drive's point along X (the flight axis): a long steel blade, a
// crossguard, and a crimson sheath stretched behind it like a thrust.
export function buildLancePoint(): THREE.Object3D {
  const holder = new THREE.Group();
  holder.userData.stretch = false;
  const blade = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 1.3, 4),
    new THREE.MeshBasicMaterial({ color: STEEL }),
  );
  blade.rotation.z = -Math.PI / 2;
  blade.position.x = 0.2;
  holder.add(blade);
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.06, 0.5),
    new THREE.MeshBasicMaterial({ color: 0x6a6258 }),
  );
  guard.position.x = -0.45;
  holder.add(guard);
  const sheath = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22),
    basicMat(OATH.main, 0.45, true),
  );
  sheath.scale.set(4, 0.45, 0.45);
  sheath.position.x = -0.5;
  holder.add(sheath);
  holder.userData.blade = blade;
  return holder;
}

// The thrust leaving: a crimson streak down the line he drives along.
export function lanceThrust(fx: VfxSystem, x: number, z: number, dx: number, dz: number): void {
  for (let i = 1; i <= 6; i++) {
    const d = i * 0.7;
    fx.particles.spawn({
      x: x + dx * d,
      y: 1.0,
      z: z + dz * d,
      vx: dx * 6,
      vz: dz * 6,
      life: 0.22,
      size0: 0.7,
      size1: 0.2,
      color0: OATH.glow,
      color1: OATH.main,
      alpha0: 0.8,
      sprite: SPRITE.spark,
      rot: Math.atan2(dx, dz),
    });
  }
  fx.glowFlash(x + dx * 0.8, 1.0, z + dz * 0.8, 1.1, OATH.glow, 0.14);
}

// The point striking home: steel sparks and a crimson burst.
export function driveImpact(fx: VfxSystem, x: number, z: number): void {
  fx.sparkBurst(x, 1.0, z, STEEL, 8, 7, { life: 0.3, size: 0.3, gravity: 14 });
  fx.sparkBurst(x, 1.0, z, OATH.main, 6, 4, { life: 0.4, size: 0.4 });
  fx.glowFlash(x, 1.0, z, 1.4, OATH.glow, 0.16);
}

// Where the Standard's pole stands from the circle's heart: beside him and
// a little behind, up the screen from the top-down camera.
export const STANDARD_OFFSET = { x: 0.7, z: -0.8 } as const;

// The Standard: an iron pole planted in the ground, a crimson cloth at its
// head, and the ward circle at its foot. Allies read a gold rim (it hardens
// them); the other side reads a crimson one (it reveals them).
export function buildStandard(radius: number, hostile: boolean): THREE.Object3D {
  const holder = new THREE.Group();
  // The banner stands at his shoulder, not under him: planted at the
  // circle's heart it would hide behind his own body from above.
  const staff = new THREE.Group();
  staff.position.set(STANDARD_OFFSET.x, 0, STANDARD_OFFSET.z);
  holder.add(staff);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.07, 3.2, 6),
    new THREE.MeshLambertMaterial({ color: 0x4a4440, flatShading: true }),
  );
  pole.position.y = 1.6;
  staff.add(pole);
  const finial = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.3, 4),
    new THREE.MeshLambertMaterial({ color: STEEL, flatShading: true }),
  );
  finial.position.y = 3.35;
  staff.add(finial);
  // The cloth hangs from a pivot at the pole so the tick can sway it.
  const pivot = new THREE.Group();
  pivot.position.y = 3.05;
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.4),
    new THREE.MeshLambertMaterial({
      color: OATH.main,
      emissive: OATH.deep,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  cloth.position.set(0.57, -0.7, 0);
  pivot.add(cloth);
  staff.add(pivot);
  const rim = hostile ? OATH.glow : WARD;
  holder.add(flatRing(radius - 0.12, radius, rim, 0.6, 0.07));
  holder.add(flatDisc(radius, rim, hostile ? 0.08 : 0.12, 0.05));
  const glow = flatRing(0.3, 0.9, WARD, 0.4, 0.09);
  glow.position.x = STANDARD_OFFSET.x;
  glow.position.z = STANDARD_OFFSET.z;
  holder.add(glow);
  holder.userData.pivot = pivot;
  holder.userData.glow = glow;
  return holder;
}

// The Standard planted: dust kicked at its foot and the ward spreading out
// on its first frame; then the cloth sways and gold motes rise off the
// circle while it stands.
export function standardTick(
  fx: VfxSystem,
  holder: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  ageMs: number,
  dtMs: number,
): void {
  if (!holder.userData.planted) {
    holder.userData.planted = true;
    fx.smokePuffs(x, z, 0xb09878, 4, 0.5);
    fx.rings.spawn(x, z, radius, WARD, 460, { alpha: 0.6 });
    fx.lightPulse(x, z, WARD, 6, 320);
  }
  const pivot = holder.userData.pivot as THREE.Object3D | undefined;
  if (pivot) pivot.rotation.y = 0.35 * Math.sin(ageMs * 0.006);
  const glow = holder.userData.glow as THREE.Mesh | undefined;
  if (glow) glow.scale.setScalar(1 + 0.12 * Math.sin(ageMs * 0.008));
  const rate = (dtMs / 1000) * 6;
  const n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius * 0.9;
    fx.particles.spawn({
      x: x + Math.cos(a) * r,
      y: 0.15,
      z: z + Math.sin(a) * r,
      vy: 1.1,
      life: 0.9,
      size0: 0.2,
      size1: 0.06,
      color0: WARD,
      alpha0: 0.8,
      sprite: SPRITE.glow,
    });
  }
}

// The thrown gauntlet: a steel fist, fingers open, and a red ribbon of
// light behind it.
export function buildGauntlet(): THREE.Object3D {
  const holder = new THREE.Group();
  holder.userData.stretch = false;
  const steel = new THREE.MeshLambertMaterial({ color: STEEL, flatShading: true });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.3), steel);
  holder.add(palm);
  for (let i = 0; i < 4; i++) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), steel);
    finger.position.set(0.25, 0, -0.11 + i * 0.075);
    holder.add(finger);
  }
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.2, 6), steel);
  cuff.rotation.z = Math.PI / 2;
  cuff.position.x = -0.25;
  holder.add(cuff);
  const ribbon = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), basicMat(OATH.main, 0.5, true));
  ribbon.scale.set(3.4, 0.35, 0.6);
  ribbon.position.x = -0.8;
  holder.add(ribbon);
  return holder;
}

// The ribbon of light it sheds while it flies.
export function gauntletTrail(fx: VfxSystem, x: number, z: number): void {
  fx.particles.spawn({
    x: x + (Math.random() - 0.5) * 0.2,
    y: 1.0 + (Math.random() - 0.5) * 0.15,
    z: z + (Math.random() - 0.5) * 0.2,
    life: 0.35,
    size0: 0.4,
    size1: 0.1,
    color0: OATH.glow,
    color1: OATH.main,
    alpha0: 0.7,
    alpha1: 0,
    sprite: SPRITE.glow,
  });
}

// The challenge landing: a clang of steel and a crimson ring at the feet of
// the one it strikes, the mark of the Sworn.
export function gauntletImpact(fx: VfxSystem, x: number, z: number): void {
  fx.sparkBurst(x, 1.1, z, STEEL, 7, 6, { life: 0.3, size: 0.3, gravity: 16 });
  fx.glowFlash(x, 1.1, z, 1.5, OATH.glow, 0.2);
  fx.rings.spawn(x, z, 1.4, OATH.main, 420, { alpha: 0.75 });
  fx.schedule(120, () => fx.rings.spawn(x, z, 1.0, OATH.glow, 360, { alpha: 0.5 }));
}

// The Oathfield raised: the ground breaks where the stones come up, dust
// and gravel thrown along the ring, a crimson flash at its heart.
export function oathfieldRise(fx: VfxSystem, x: number, z: number, radius = 5): void {
  fx.onShake(0.25);
  fx.glowFlash(x, 1.0, z, 2.4, OATH.glow, 0.22);
  fx.lightPulse(x, z, OATH.main, 10, 420);
  fx.rings.spawn(x, z, radius, OATH.main, 520, { alpha: 0.7 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = x + Math.cos(a) * radius;
    const pz = z + Math.sin(a) * radius;
    fx.schedule(i * 30, () => {
      fx.debris.burst(px, pz, STONE, 3, { speed: 3, up: 7, size: 0.18 });
      fx.smokePuffs(px, pz, 0xb09878, 2, 0.8);
    });
  }
}
