// The per-spell VFX catalog: authored visuals keyed by the cosmetic vfx tag
// ('championId_KEY'). Anything not listed falls back to the school-derived
// generics, so coverage never breaks while identity lands incrementally
// (the woc declining-claim pattern). Data-as-code: this table is the art.

import * as THREE from 'three';
import type { SfxName } from '../../game/sfx';
import { SPRITE } from './sprites';
import type { VfxSystem } from './system';

export interface SchoolColors {
  main: number;
  glow: number;
}

// Every hook is optional; the renderer runs the generic instead when a hook
// is absent. Positions are world-space ground coordinates.
export interface SpellVisual {
  // Replace the default projectile mesh. Set holder.userData.stretch =
  // false to opt out of the renderer's generic bolt stretch.
  projectile?: (radius: number, colors: SchoolColors) => THREE.Object3D;
  // Per-frame while the projectile flies.
  projectileTick?: (
    fx: VfxSystem,
    x: number,
    z: number,
    dtMs: number,
    colors: SchoolColors,
    nowMs: number,
    holder: THREE.Object3D,
  ) => void;
  // Fired where the projectile despawned.
  impact?: (fx: VfxSystem, x: number, z: number, colors: SchoolColors) => void;
  // Fired at the caster on a visible instant cast; dir points at the aim.
  castFx?: (
    fx: VfxSystem,
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    colors: SchoolColors,
  ) => void;
  // Replace the default zone mesh; hostile tells the viewer's foes apart.
  zone?: (radius: number, colors: SchoolColors, hostile: boolean) => THREE.Object3D;
  // Per-frame while the zone lives; holder is the mesh this entry built.
  zoneTick?: (
    fx: VfxSystem,
    holder: THREE.Object3D,
    x: number,
    z: number,
    radius: number,
    ageMs: number,
    colors: SchoolColors,
    dtMs: number,
  ) => void;
  // Fired when a delayed zone detonates.
  detonate?: (fx: VfxSystem, x: number, z: number, radius: number, colors: SchoolColors) => void;
  // Per-frame at the caster while a windup charges; progress runs 0 to 1.
  windupTick?: (
    fx: VfxSystem,
    x: number,
    z: number,
    progress: number,
    colors: SchoolColors,
    dtMs: number,
  ) => void;
  // Fired when a windup resolves (dash windups land here).
  release?: (
    fx: VfxSystem,
    fromX: number,
    fromZ: number,
    aimX: number,
    aimZ: number,
    colors: SchoolColors,
  ) => void;
  // Sound played by the renderer when the windup resolves, distance
  // attenuated like combat sfx (a rifle shot banging at release).
  releaseSfx?: SfxName;
}

// ---------------------------------------------------------------- generics

export function genericImpact(fx: VfxSystem, x: number, z: number, colors: SchoolColors): void {
  fx.glowFlash(x, 1, z, 1.6, colors.glow, 0.22);
  fx.sparkBurst(x, 0.9, z, colors.main, 7, 6, { life: 0.4, size: 0.4 });
  fx.rings.spawn(x, z, 1.2, colors.main, 380, { alpha: 0.5 });
}

export function genericDetonate(
  fx: VfxSystem,
  x: number,
  z: number,
  radius: number,
  colors: SchoolColors,
): void {
  fx.glowFlash(x, 1, z, radius * 1.2, colors.glow, 0.3);
  fx.sparkBurst(x, 0.8, z, colors.main, 14, 9, { life: 0.5 });
  fx.rings.spawn(x, z, radius * 1.15, colors.main, 520);
  fx.schedule(140, () => fx.rings.spawn(x, z, radius * 1.35, colors.glow, 460, { alpha: 0.5 }));
  fx.lightPulse(x, z, colors.main, 14, 400);
  fx.onShake(0.2);
}

export function genericWindupTick(
  fx: VfxSystem,
  x: number,
  z: number,
  progress: number,
  colors: SchoolColors,
): void {
  // Sparks pulled inward, tightening as the cast fills.
  const r = 2 - progress * 0.9;
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2;
    fx.particles.spawn({
      x: x + Math.cos(a) * r,
      y: 0.4 + Math.random() * 1.4,
      z: z + Math.sin(a) * r,
      vx: -Math.cos(a) * 6,
      vy: 0.6,
      vz: -Math.sin(a) * 6,
      life: 0.26,
      size0: 0.34,
      size1: 0.1,
      color0: colors.glow,
      alpha0: 0.9,
      sprite: SPRITE.fleck,
    });
  }
  fx.glowFlash(x, 1.5, z, 0.8 + progress * 1.6, colors.glow, 0.09);
}

// ------------------------------------------------------------- mesh helpers

function basicMat(color: number, opacity: number, additive = false): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.toneMapped = false;
  return mat;
}

function flatRing(
  rIn: number,
  rOut: number,
  color: number,
  opacity: number,
  y: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 48), basicMat(color, opacity));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

function flatDisc(r: number, color: number, opacity: number, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 40), basicMat(color, opacity));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  return mesh;
}

// A warning telegraph for delayed zones: a dark contrast band under a hard
// colored rim (readable even on the glowing river), a faint fill, and a
// sweep disc the zoneTick grows with the fuse (the area must be readable
// the instant it appears; the sweep says how long is left).
function telegraphZone(radius: number, rimColor: number, sweepColor: number): THREE.Group {
  const holder = new THREE.Group();
  holder.add(flatRing(radius - 0.52, radius + 0.14, 0x0a0a0a, 0.55, 0.09));
  const rim = flatRing(radius - 0.34, radius, rimColor, 0.95, 0.1);
  holder.add(rim);
  holder.add(flatDisc(radius, rimColor, 0.14, 0.08));
  const sweep = flatDisc(radius, sweepColor, 0.34, 0.11);
  sweep.scale.setScalar(0.01);
  holder.add(sweep);
  holder.userData.rim = rim;
  holder.userData.sweep = sweep;
  return holder;
}

function pulseRim(holder: THREE.Object3D, ageMs: number, urgency: number): void {
  const rim = holder.userData.rim as THREE.Mesh | undefined;
  if (!rim) return;
  const mat = rim.material as THREE.MeshBasicMaterial;
  // Never dip low: the pulse is a heartbeat, not a fade (readability rule).
  mat.opacity = 0.82 + 0.18 * Math.sin(ageMs * (0.008 + urgency * 0.02));
}

function growSweep(holder: THREE.Object3D, progress: number): void {
  const sweep = holder.userData.sweep as THREE.Mesh | undefined;
  sweep?.scale.setScalar(Math.max(0.01, Math.min(1, progress)));
}

// ------------------------------------------------------------- the catalog

const FIRE = { main: 0xff7a2a, glow: 0xffc07a };
const EARTH = { main: 0xc89a58, glow: 0xe8d0a0 };
const WATER = { main: 0x4aa8e8, glow: 0xbfe8ff };
const FROST = { main: 0x9fd8ff, glow: 0xe8f6ff };
const SHADOW = { main: 0x9a5df0, glow: 0xd0b2ff };
const VERDANT = { main: 0x7ad05a, glow: 0xc8ff9a };
const GOLD = { main: 0xffd94a, glow: 0xfff0b0 };

// A rifle bullet: a slim bright tracer with a thin additive sheath,
// authored along X (the flight axis) with its own proportions. Used for
// Vesk's auto bolts and his Q.
export function buildBulletMesh(color: number): THREE.Object3D {
  const holder = new THREE.Group();
  holder.userData.stretch = false;
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.3),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
  );
  (core.material as THREE.MeshBasicMaterial).toneMapped = false;
  core.scale.set(2.6, 0.22, 0.22);
  holder.add(core);
  const sheath = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), basicMat(color, 0.4, true));
  sheath.scale.set(3.4, 0.4, 0.4);
  holder.add(sheath);
  return holder;
}

export const SPELL_VFX: Readonly<Record<string, SpellVisual>> = {
  // Dain R: a comet called down on a telegraphed zone. The rock falls in at
  // an angle for the whole fuse, then the impact layers flash, shockwaves,
  // shrapnel, a fire pillar, smoke, and a scorch that outlives the fight.
  dain_R: {
    zone: (radius, _colors, hostile) => {
      const holder = telegraphZone(radius, hostile ? 0xff5a3a : 0xffa53e, 0xff8a4a);
      const rock = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.95, 0),
        new THREE.MeshLambertMaterial({
          color: 0x3a2a24,
          emissive: 0xff5a20,
          emissiveIntensity: 1,
          flatShading: true,
        }),
      );
      rock.add(core);
      rock.position.y = 40;
      holder.add(rock);
      holder.userData.rock = rock;
      return holder;
    },
    zoneTick: (fx, holder, x, z, _radius, ageMs, _colors, _dtMs) => {
      // The fuse is 1.3 s (playtest round 2) and the rock now falls from
      // the stratosphere: twice the comet deserves twice the sky.
      const p = Math.min(1, ageMs / 1300);
      pulseRim(holder, ageMs, p);
      growSweep(holder, p);
      const rock = holder.userData.rock as THREE.Group | undefined;
      if (!rock) return;
      const fall = 1 - (1 - p) ** 2;
      rock.position.set(9 * (1 - fall), 0.7 + 42 * (1 - fall), 0);
      rock.rotation.x += 0.11;
      rock.rotation.y += 0.07;
      // Ember wake behind the falling rock.
      for (let i = 0; i < 2; i++) {
        fx.particles.spawn({
          x: x + rock.position.x + (Math.random() - 0.5) * 0.7,
          y: rock.position.y + (Math.random() - 0.5) * 0.7,
          z: z + (Math.random() - 0.5) * 0.7,
          vy: 1.5,
          life: 0.4,
          size0: 1.4,
          size1: 0.3,
          color0: 0xffc07a,
          color1: 0xff5a20,
          alpha0: 0.9,
          sprite: SPRITE.glow,
        });
      }
    },
    detonate: (fx, x, z, radius) => {
      fx.glowFlash(x, 1.4, z, 11, 0xffffff, 0.18);
      fx.glowFlash(x, 1.4, z, 9, FIRE.glow, 0.5);
      fx.sparkBurst(x, 0.8, z, FIRE.main, 30, 14, { life: 0.7, gravity: 20, size: 0.8 });
      fx.debris.burst(x, z, 0x4a3228, 14, { speed: 8, up: 12 });
      fx.rings.spawn(x, z, radius * 1.25, FIRE.main, 750, { width: 0.3 });
      fx.schedule(140, () => fx.rings.spawn(x, z, radius * 1.6, FIRE.glow, 700, { alpha: 0.7 }));
      fx.schedule(300, () => fx.rings.spawn(x, z, radius, 0xffffff, 520, { alpha: 0.5 }));
      fx.pillars.spawn(x, z, radius * 0.7, 9, 0xff9a4a, 750, 0.5);
      fx.decals.spawn(x, z, radius * 1.1, 'scorch', 9000, { alpha: 0.9 });
      fx.smokePuffs(x, z, 0x8a6a52, 8, radius * 0.7);
      fx.lightPulse(x, z, 0xff8a3a, 40, 600);
      fx.onShake(0.55);
    },
  },

  // Korrath R: a true leap now (kits-v2, speed 14 in korrath.ts), so the
  // release kicks takeoff dust and the earthbreak itself waits out the
  // flight: rock shrapnel, cracked earth, a staggered double ring at the
  // moment the mountain actually lands.
  korrath_R: {
    windupTick: (fx, x, z, progress) => {
      genericWindupTick(fx, x, z, progress, EARTH);
    },
    release: (fx, fromX, fromZ, aimX, aimZ) => {
      fx.sparkBurst(fromX, 0.5, fromZ, 0xb9a888, 8, 6, { life: 0.35, gravity: 16 });
      fx.smokePuffs(fromX, fromZ, 0xb09878, 3, 1.2);
      const flightMs = (Math.hypot(aimX - fromX, aimZ - fromZ) / 14) * 1000;
      fx.schedule(flightMs, () => {
        fx.glowFlash(aimX, 1, aimZ, 5, EARTH.glow, 0.26);
        fx.sparkBurst(aimX, 0.6, aimZ, 0xd8b890, 18, 9, { life: 0.5, gravity: 24 });
        fx.debris.burst(aimX, aimZ, 0x6a5a48, 14, { speed: 8, up: 11 });
        fx.rings.spawn(aimX, aimZ, 3.4, EARTH.main, 520);
        fx.schedule(150, () => fx.rings.spawn(aimX, aimZ, 4.4, EARTH.glow, 480, { alpha: 0.55 }));
        fx.decals.spawn(aimX, aimZ, 3.2, 'cracks', 6500, { alpha: 0.8 });
        fx.pillars.spawn(aimX, aimZ, 1.6, 5, 0xd8b06a, 460, 0.24);
        fx.smokePuffs(aimX, aimZ, 0xb09878, 5, 2.2);
        fx.lightPulse(aimX, aimZ, 0xe8c886, 20, 420);
        fx.onShake(0.5);
      });
    },
  },

  // Torv Q (kits-v2): a real plowing charge (speed 13 in torv.ts). Gravel
  // and dust march along the path in time with the run; the landing burst
  // fires where and when the horn actually arrives.
  torv_Q: {
    release: (fx, fromX, fromZ, aimX, aimZ) => {
      const dx = aimX - fromX;
      const dz = aimZ - fromZ;
      const len = Math.hypot(dx, dz) || 1;
      const flightMs = (len / 13) * 1000;
      const steps = Math.max(2, Math.round(len / 1.6));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        fx.schedule(flightMs * t, () => {
          const px = fromX + dx * t;
          const pz = fromZ + dz * t;
          fx.debris.burst(px, pz, 0x6a5a48, 3, { speed: 4, up: 7, size: 0.14 });
          fx.smokePuffs(px, pz, 0xb09878, 2, 0.8);
        });
      }
      fx.schedule(flightMs, () => {
        fx.sparkBurst(aimX, 0.7, aimZ, EARTH.main, 10, 8, { life: 0.4, gravity: 22 });
        fx.debris.burst(aimX, aimZ, 0x6a5a48, 6, { speed: 6, up: 9, size: 0.16 });
        fx.rings.spawn(aimX, aimZ, 2.4, EARTH.main, 440, { alpha: 0.6 });
        fx.onShake(0.25);
      });
    },
  },

  // Vesk autos: rifle rounds. A slim golden tracer, unmistakably a bullet,
  // never the generic team orb the minions share.
  vesk_A: {
    projectile: () => buildBulletMesh(GOLD.main),
    impact: (fx, x, z) => {
      fx.sparkBurst(x, 1.0, z, GOLD.main, 6, 5, { life: 0.25, size: 0.3 });
      fx.glowFlash(x, 1.1, z, 1.0, 0xfff0b0, 0.12);
    },
  },

  // Vesk Q: a piercing rifle round. A supersonic tracer, not a magic orb;
  // the release is the muzzle flash.
  vesk_Q: {
    release: (fx, fromX, fromZ) => {
      fx.glowFlash(fromX, 1.4, fromZ, 1.5, 0xfff0b0, 0.1);
    },
    releaseSfx: 'gunshot',
    projectile: () => buildBulletMesh(GOLD.main),
    impact: (fx, x, z) => {
      fx.sparkBurst(x, 1.1, z, GOLD.main, 10, 8, { life: 0.3, size: 0.3 });
      fx.glowFlash(x, 1.2, z, 1.6, 0xfff0b0, 0.14);
    },
  },

  // Vesk R: the map-crossing shot. The charge converges on the rifle, the
  // tracer is a meter-long golden lance shedding sonic rings, the hit is a
  // gold detonation.
  vesk_R: {
    windupTick: (fx, x, z, progress) => {
      genericWindupTick(fx, x, z, progress, GOLD);
      fx.glowFlash(x, 1.3, z, 0.6 + progress * 2.2, 0xfff0b0, 0.08);
    },
    releaseSfx: 'gunshot',
    projectile: () => {
      const holder = new THREE.Group();
      holder.userData.stretch = false;
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.5),
        new THREE.MeshBasicMaterial({ color: 0xfff0b0 }),
      );
      (core.material as THREE.MeshBasicMaterial).toneMapped = false;
      core.scale.set(7, 0.5, 0.5);
      holder.add(core);
      const sheath = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.62),
        basicMat(0xffd94a, 0.4, true),
      );
      sheath.scale.set(8.5, 0.9, 0.9);
      holder.add(sheath);
      return holder;
    },
    projectileTick: (fx, x, z, _dtMs, _colors, nowMs, holder) => {
      const last = (holder.userData.lastRingAt as number | undefined) ?? 0;
      if (nowMs - last > 150) {
        holder.userData.lastRingAt = nowMs;
        fx.rings.spawn(x, z, 1.7, 0xffd94a, 360, { alpha: 0.35, width: 0.3 });
      }
      fx.particles.spawn({
        x: x + (Math.random() - 0.5) * 0.4,
        y: 1.2,
        z: z + (Math.random() - 0.5) * 0.4,
        life: 0.28,
        size0: 0.8,
        size1: 0.15,
        color0: 0xfff0b0,
        color1: 0xffd94a,
        alpha0: 0.9,
        sprite: SPRITE.spark,
        rot: Math.PI / 2,
      });
    },
    impact: (fx, x, z) => {
      fx.glowFlash(x, 1.2, z, 6, 0xfff0b0, 0.28);
      fx.sparkBurst(x, 1, z, GOLD.main, 22, 12, { life: 0.55 });
      fx.rings.spawn(x, z, 3.4, GOLD.main, 520);
      fx.schedule(120, () => fx.rings.spawn(x, z, 4.6, GOLD.glow, 480, { alpha: 0.5 }));
      fx.pillars.spawn(x, z, 1.2, 6, 0xffe08a, 460, 0.3);
      fx.decals.spawn(x, z, 1.8, 'scorch', 5000, { alpha: 0.6 });
      fx.lightPulse(x, z, 0xffd94a, 24, 420);
      fx.onShake(0.35);
    },
  },

  // Maera R: a wall of water. The crest is a real curved shell, the wake
  // sprays droplets, and the hit is a foaming splash.
  maera_R: {
    windupTick: (fx, x, z, progress) => {
      genericWindupTick(fx, x, z, progress, WATER);
    },
    projectile: () => {
      const holder = new THREE.Group();
      holder.userData.stretch = false;
      const crest = new THREE.Mesh(
        new THREE.CylinderGeometry(2, 2.3, 1.9, 20, 1, true, Math.PI / 2 - 1, 2),
        basicMat(0x5ab8e8, 0.5),
      );
      crest.position.set(-1.1, 0.95, 0);
      holder.add(crest);
      const foam = new THREE.Mesh(
        new THREE.CylinderGeometry(2.05, 2.2, 0.5, 20, 1, true, Math.PI / 2 - 1, 2),
        basicMat(0xbfe8ff, 0.7, true),
      );
      foam.position.set(-1.1, 1.9, 0);
      holder.add(foam);
      return holder;
    },
    projectileTick: (fx, x, z) => {
      for (let i = 0; i < 2; i++) {
        fx.particles.spawn({
          x: x + (Math.random() - 0.5) * 2.6,
          y: 1.6 + Math.random() * 0.8,
          z: z + (Math.random() - 0.5) * 2.6,
          vy: 2.5,
          life: 0.4,
          size0: 0.5,
          size1: 0.15,
          color0: 0xbfe8ff,
          alpha0: 0.8,
          sprite: SPRITE.fleck,
          gravity: 12,
        });
      }
    },
    impact: (fx, x, z) => {
      fx.glowFlash(x, 1, z, 4.5, WATER.glow, 0.26);
      fx.sparkBurst(x, 0.7, z, 0x8fd8ff, 20, 8, { life: 0.6, gravity: 24, up: 9 });
      fx.rings.spawn(x, z, 3.2, WATER.main, 560);
      fx.schedule(140, () => fx.rings.spawn(x, z, 4.2, WATER.glow, 500, { alpha: 0.5 }));
      fx.lightPulse(x, z, 0x6ac9e8, 16, 380);
      fx.onShake(0.3);
    },
  },

  // Elowen R: a whiteout. Snow orbits the eye of the storm, wind streaks
  // tear along the rim, and the ground frosts over while it holds.
  elowen_R: {
    zone: (radius) => {
      const holder = new THREE.Group();
      holder.add(flatDisc(radius, 0x9fd8ff, 0.16, 0.09));
      holder.add(flatRing(radius - 0.5, radius + 0.12, 0x0a1420, 0.5, 0.1));
      const rim = flatRing(radius - 0.34, radius, 0xbfe8ff, 0.7, 0.11);
      holder.add(rim);
      holder.userData.rim = rim;
      return holder;
    },
    zoneTick: (fx, holder, x, z, radius, ageMs, _colors, _dtMs) => {
      pulseRim(holder, ageMs, 0.2);
      if (!holder.userData.frosted) {
        holder.userData.frosted = true;
        fx.decals.spawn(x, z, radius * 0.95, 'frost', 4600, { alpha: 0.55 });
      }
      // The tempest's teeth: a lightning strike inside the storm every
      // beat, with its own flash, ground ring, and thunder kick.
      const lastBolt = (holder.userData.lastBolt as number | undefined) ?? -9999;
      if (ageMs - lastBolt > 850) {
        holder.userData.lastBolt = ageMs;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * radius * 0.7;
        const sx = x + Math.cos(a) * r;
        const sz = z + Math.sin(a) * r;
        fx.bolts.spawn(
          new THREE.Vector3(sx + (Math.random() - 0.5) * 3, 15, sz + (Math.random() - 0.5) * 3),
          new THREE.Vector3(sx, 0.2, sz),
          0xdff2ff,
          340,
          0.18,
          0.16,
        );
        fx.glowFlash(sx, 1.2, sz, 5, 0xdff2ff, 0.22);
        fx.rings.spawn(sx, sz, 1.8, 0xbfe8ff, 450, { alpha: 0.8 });
        fx.sparkBurst(sx, 0.6, sz, 0xdff2ff, 8, 8, { life: 0.35 });
        fx.lightPulse(sx, sz, 0xbfe8ff, 26, 300);
        fx.onShake(0.14);
      }
      // Orbiting snow: tangential velocity around the eye.
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = radius * (0.25 + Math.random() * 0.7);
        const sp = 5 + Math.random() * 4;
        fx.particles.spawn({
          x: x + Math.cos(a) * r,
          y: 0.3 + Math.random() * 2.4,
          z: z + Math.sin(a) * r,
          vx: -Math.sin(a) * sp - Math.cos(a) * 1.2,
          vy: 0.7,
          vz: Math.cos(a) * sp - Math.sin(a) * 1.2,
          life: 0.7,
          size0: 0.3,
          size1: 0.12,
          color0: 0xffffff,
          color1: 0x9fd8ff,
          alpha0: 0.85,
          sprite: SPRITE.fleck,
        });
      }
      // Wind shear: a fast streak along the rim now and then.
      if (Math.random() < 0.25) {
        const a = Math.random() * Math.PI * 2;
        fx.particles.spawn({
          x: x + Math.cos(a) * radius * 0.85,
          y: 1 + Math.random() * 1.2,
          z: z + Math.sin(a) * radius * 0.85,
          vx: -Math.sin(a) * 11,
          vz: Math.cos(a) * 11,
          life: 0.3,
          size0: 1.5,
          size1: 0.4,
          color0: 0xe8f6ff,
          alpha0: 0.5,
          sprite: SPRITE.spark,
          rot: -a,
        });
      }
      const pulseAt = (holder.userData.lastPulse as number | undefined) ?? 0;
      if (ageMs - pulseAt > 750) {
        holder.userData.lastPulse = ageMs;
        fx.rings.spawn(x, z, radius, FROST.main, 700, { alpha: 0.3, width: 0.22 });
      }
    },
  },

  // Ashvyn R: an eclipse overhead and a storm of arrows under it, each
  // visible as a falling streak with a violet spark where it lands.
  ashvyn_R: {
    zone: (radius, _colors, hostile) => {
      const holder = new THREE.Group();
      holder.add(flatRing(radius - 0.46, radius + 0.12, 0x0a0a14, 0.55, 0.09));
      holder.add(flatRing(radius - 0.34, radius, hostile ? 0xc06ae8 : 0x9a5df0, 0.85, 0.1));
      holder.add(flatDisc(radius, 0x3a2050, 0.2, 0.08));
      const cloud = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.95, 36),
        basicMat(0x1c1030, 0.55),
      );
      cloud.rotation.x = Math.PI / 2;
      cloud.position.y = 7;
      holder.add(cloud);
      const corona = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.95, radius * 1.12, 36),
        basicMat(0xc06ae8, 0.5, true),
      );
      corona.rotation.x = Math.PI / 2;
      corona.position.y = 7;
      holder.add(corona);
      return holder;
    },
    zoneTick: (fx, _holder, x, z, radius) => {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius * 0.9;
        fx.particles.spawn({
          x: x + Math.cos(a) * r,
          y: 6.6,
          z: z + Math.sin(a) * r,
          vy: -30,
          life: 0.21,
          size0: 1.5,
          size1: 1.1,
          color0: 0xd0b2ff,
          alpha0: 0.9,
          sprite: SPRITE.spark,
        });
      }
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius * 0.9;
        fx.particles.spawn({
          x: x + Math.cos(a) * r,
          y: 0.15,
          z: z + Math.sin(a) * r,
          vy: 2.5,
          life: 0.3,
          size0: 0.4,
          size1: 0.1,
          color0: 0x9a5df0,
          alpha0: 0.85,
          sprite: SPRITE.fleck,
          gravity: 10,
        });
      }
    },
  },

  // Sylra R: the overgrowth telegraphs, spores drift up, then the ground
  // erupts in thorns that root everything still inside.
  sylra_R: {
    zone: (radius, _colors, hostile) => {
      const holder = telegraphZone(radius, hostile ? 0xff7a4a : 0x7ad05a, 0x9aff7a);
      return holder;
    },
    zoneTick: (fx, holder, x, z, radius, ageMs) => {
      const p = Math.min(1, ageMs / 1250);
      pulseRim(holder, ageMs, p);
      growSweep(holder, p);
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        fx.particles.spawn({
          x: x + Math.cos(a) * r,
          y: 0.2,
          z: z + Math.sin(a) * r,
          vy: 1.8 + Math.random(),
          life: 0.5,
          size0: 0.28,
          size1: 0.1,
          color0: 0xc8ff9a,
          alpha0: 0.8,
          sprite: SPRITE.fleck,
        });
      }
    },
    detonate: (fx, x, z, radius) => {
      fx.glowFlash(x, 1, z, 6, VERDANT.glow, 0.28);
      fx.sparkBurst(x, 0.6, z, VERDANT.main, 20, 9, { life: 0.6, up: 11 });
      fx.debris.burst(x, z, 0x2e5a28, 11, { speed: 6, up: 10, size: 0.2 });
      fx.rings.spawn(x, z, radius * 1.1, VERDANT.main, 560);
      fx.schedule(130, () => fx.rings.spawn(x, z, radius * 1.3, VERDANT.glow, 500, { alpha: 0.5 }));
      fx.pillars.spawn(x, z, radius * 0.5, 6, 0x9aff7a, 520, 0.28);
      fx.decals.spawn(x, z, radius, 'cracks', 6000, { alpha: 0.7 });
      fx.lightPulse(x, z, 0x7ad05a, 20, 440);
      fx.onShake(0.3);
    },
  },

  // Torv R: the faultline tears the ground open along its whole path:
  // cracks and rubble stay behind the wavefront.
  torv_R: {
    projectile: () => {
      const holder = new THREE.Group();
      holder.userData.stretch = false;
      const rockMat = new THREE.MeshLambertMaterial({ color: 0x7a6852, flatShading: true });
      for (const [ox, oz, h] of [
        [0.35, 0, 1.5],
        [-0.25, 0.55, 1.1],
        [-0.25, -0.55, 1.2],
      ] as const) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.42, h, 5), rockMat);
        spike.position.set(ox, h / 2 - 1.1, oz);
        spike.rotation.z = -0.25;
        holder.add(spike);
      }
      return holder;
    },
    projectileTick: (fx, x, z, _dtMs, _colors, nowMs, holder) => {
      const last = (holder.userData.lastCrackAt as number | undefined) ?? 0;
      if (nowMs - last > 240) {
        holder.userData.lastCrackAt = nowMs;
        fx.decals.spawn(x, z, 1.3, 'cracks', 3600, { alpha: 0.75 });
        fx.debris.burst(x, z, 0x6a5a48, 3, { speed: 4, up: 8, size: 0.16 });
      }
      fx.particles.spawn({
        x: x + (Math.random() - 0.5) * 1.4,
        y: 0.3,
        z: z + (Math.random() - 0.5) * 1.4,
        vy: 3 + Math.random() * 2,
        life: 0.4,
        size0: 0.5,
        size1: 0.15,
        color0: 0xd8c0a0,
        alpha0: 0.7,
        sprite: SPRITE.fleck,
        gravity: 14,
      });
    },
    impact: (fx, x, z) => {
      fx.glowFlash(x, 0.9, z, 4, EARTH.glow, 0.24);
      fx.sparkBurst(x, 0.6, z, EARTH.main, 14, 9, { life: 0.5, gravity: 22 });
      fx.debris.burst(x, z, 0x6a5a48, 9, { speed: 7, up: 10 });
      fx.rings.spawn(x, z, 3, EARTH.main, 520);
      fx.decals.spawn(x, z, 2.2, 'cracks', 6000, { alpha: 0.8 });
      fx.lightPulse(x, z, 0xd8b06a, 16, 380);
      fx.onShake(0.4);
    },
  },

  // Fenn R (kits-v2): the crouch gathers shadow, then he blurs down the
  // line; violet shear flashes march along the path in time with the dash
  // (speed 14 in fenn.ts) and the arrival snaps a ring where he lands.
  fenn_R: {
    windupTick: (fx, x, z, progress) => {
      genericWindupTick(fx, x, z, progress, SHADOW);
    },
    release: (fx, fromX, fromZ, aimX, aimZ) => {
      const dx = aimX - fromX;
      const dz = aimZ - fromZ;
      const len = Math.hypot(dx, dz) || 1;
      const flightMs = (len / 14) * 1000;
      const steps = Math.max(3, Math.round(len / 1.4));
      fx.glowFlash(fromX, 1.2, fromZ, 2.4, SHADOW.main, 0.2);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        fx.schedule(flightMs * t, () => {
          const px = fromX + dx * t;
          const pz = fromZ + dz * t;
          fx.glowFlash(px, 1.2, pz, 1.6, 0xd0b2ff, 0.12);
          fx.sparkBurst(px, 1.1, pz, SHADOW.main, 5, 7, {
            life: 0.28,
            size: 0.55,
            sprite: SPRITE.spark,
            gravity: 2,
          });
        });
      }
      fx.schedule(flightMs, () => {
        fx.rings.spawn(aimX, aimZ, 2, SHADOW.main, 400, { alpha: 0.6 });
        fx.lightPulse(aimX, aimZ, SHADOW.main, 12, 320);
      });
    },
  },

  // Rhoka R: the frenzy ignites in a red nova around the body.
  rhoka_R: {
    castFx: (fx, x, z) => {
      fx.glowFlash(x, 1.2, z, 3.4, 0xff8a6a, 0.26);
      fx.sparkBurst(x, 1, z, 0xe8443a, 16, 8, { life: 0.5 });
      fx.rings.spawn(x, z, 3, 0xe8443a, 480);
      fx.pillars.spawn(x, z, 1, 4.5, 0xff6a4a, 420, 0.26);
      fx.lightPulse(x, z, 0xe8443a, 14, 380);
      fx.onShake(0.15);
    },
  },

  // Dain E (kits-v2): the fists ignite. Embers climb the body, the hands
  // snap alight one after the other; nothing flies anywhere until he swings.
  dain_E: {
    castFx: (fx, x, z) => {
      fx.glowFlash(x, 1.2, z, 2.2, FIRE.glow, 0.24);
      fx.rings.spawn(x, z, 1.4, FIRE.main, 380, { alpha: 0.6 });
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.45 + Math.random() * 0.4;
        fx.particles.spawn({
          x: x + Math.cos(a) * r,
          y: 0.35 + Math.random() * 0.8,
          z: z + Math.sin(a) * r,
          vx: Math.cos(a) * 0.6,
          vy: 2.4 + Math.random() * 1.6,
          vz: Math.sin(a) * 0.6,
          life: 0.5,
          size0: 0.4,
          size1: 0.12,
          color0: 0xffc07a,
          color1: 0xff5a20,
          alpha0: 0.95,
          sprite: SPRITE.glow,
        });
      }
      fx.schedule(90, () => fx.glowFlash(x + 0.45, 1.1, z, 0.9, 0xffe0a0, 0.16));
      fx.schedule(190, () => fx.glowFlash(x - 0.45, 1.1, z, 0.9, 0xffe0a0, 0.16));
      fx.lightPulse(x, z, FIRE.main, 10, 320);
    },
  },

  // Korrath W (kits-v2): the maul hits the ground at his feet and a dust
  // seam races downrange to where the rampart rises (the wall itself gets
  // its rise and crumble in the renderer's wall tracking).
  korrath_W: {
    castFx: (fx, x, z, dirX, dirZ) => {
      fx.sparkBurst(x, 0.4, z, 0xd8b890, 10, 6, { life: 0.4, gravity: 20 });
      fx.debris.burst(x, z, 0x6a5a48, 6, { speed: 5, up: 8, size: 0.16 });
      fx.rings.spawn(x, z, 1.8, EARTH.main, 420, { alpha: 0.6 });
      for (let i = 1; i <= 4; i++) {
        fx.schedule(i * 45, () => {
          fx.smokePuffs(x + dirX * i * 1.5, z + dirZ * i * 1.5, 0xb09878, 2, 0.7);
        });
      }
      fx.onShake(0.18);
    },
  },

  // Dain W: the cinder guard flares up around the body.
  dain_W: {
    castFx: (fx, x, z) => {
      fx.rings.spawn(x, z, 2.6, FIRE.main, 460, { alpha: 0.6 });
      fx.sparkBurst(x, 0.8, z, 0xff8a3a, 10, 5, { life: 0.5, up: 6 });
      fx.glowFlash(x, 1.2, z, 2.4, FIRE.glow, 0.2);
    },
  },

  // Torv E: a stomp that kicks dust and gravel.
  torv_E: {
    castFx: (fx, x, z) => {
      fx.rings.spawn(x, z, 3.2, EARTH.main, 480, { alpha: 0.6 });
      fx.debris.burst(x, z, 0x6a5a48, 6, { speed: 5, up: 8, size: 0.16 });
      fx.smokePuffs(x, z, 0xb09878, 4, 1.8);
      fx.onShake(0.18);
    },
  },

  // Elowen E: a blink; mist bursts at both ends of the step.
  elowen_E: {
    castFx: (fx, x, z, dirX, dirZ) => {
      fx.smokePuffs(x, z, 0xbfe8ff, 4, 0.9);
      fx.glowFlash(x, 1.2, z, 2, FROST.glow, 0.18);
      fx.schedule(90, () => {
        const tx = x + dirX * 4;
        const tz = z + dirZ * 4;
        fx.smokePuffs(tx, tz, 0xbfe8ff, 4, 0.9);
        fx.glowFlash(tx, 1.2, tz, 2, FROST.glow, 0.18);
      });
    },
  },
};

export function spellVisualOf(tag: string | null): SpellVisual | null {
  if (!tag) return null;
  return SPELL_VFX[tag] ?? null;
}
