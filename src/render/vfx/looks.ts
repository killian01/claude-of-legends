// The look interpreter: one spell look (src/sim/spell_look.ts, data) read
// into the same SpellVisual hooks the authored catalog writes by hand
// (catalog.ts, code). Every word of the vocabulary is drawn here out of
// the pooled primitives, so a look can never do anything the catalog
// could not, and a champion that did not exist when this client was built
// still gets a spell of its own instead of the school-derived generic.
//
// Partial by design: a look that names only an impact yields a visual
// with only an impact hook, and the renderer keeps the generic for every
// hook that is absent. Every number is clamped here as well as validated
// server-side, because a look also arrives inside a saved replay.

import * as THREE from 'three';
import { LOOK_BOUNDS, type LookBurst, type LookMark, type SpellLook } from '../../sim/spell_look';
import type { SchoolColors, SpellVisual } from './catalog';
import { basicMat, flatDisc, flatRing } from './shapes';
import { SPRITE } from './sprites';
import type { VfxSystem } from './system';

function clamp(v: number | undefined, lo: number, hi: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.max(lo, Math.min(hi, v));
}

function scaleOf(b: LookBurst): number {
  return clamp(b.scale, LOOK_BOUNDS.scale.min, LOOK_BOUNDS.scale.max, 1);
}

function densityOf(b: LookBurst): number {
  return clamp(b.density, LOOK_BOUNDS.density.min, LOOK_BOUNDS.density.max, 0.6);
}

// ------------------------------------------------------------- projectiles

function orbMesh(radius: number, colors: SchoolColors): THREE.Object3D {
  const holder = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.85, 12, 10),
    basicMat(colors.glow, 1),
  );
  holder.add(core);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.5, 10, 8),
    basicMat(colors.main, 0.35, true),
  );
  holder.add(halo);
  holder.userData.stretch = false;
  return holder;
}

function shardMesh(radius: number, colors: SchoolColors): THREE.Object3D {
  const holder = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(radius * 1.1, 0),
    basicMat(colors.glow, 1),
  );
  core.scale.set(0.55, 0.55, 2.1);
  holder.add(core);
  const edge = new THREE.Mesh(
    new THREE.OctahedronGeometry(radius * 1.35, 0),
    basicMat(colors.main, 0.3, true),
  );
  edge.scale.set(0.7, 0.7, 2.3);
  holder.add(edge);
  holder.userData.stretch = false;
  return holder;
}

function bladeMesh(radius: number, colors: SchoolColors): THREE.Object3D {
  const holder = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 3.4, radius * 1.1),
    basicMat(colors.glow, 0.95, true),
  );
  blade.rotation.x = -Math.PI / 2;
  holder.add(blade);
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.6, radius * 0.22, radius * 0.22),
    basicMat(colors.main, 1),
  );
  holder.add(spine);
  holder.userData.stretch = false;
  return holder;
}

function starMesh(radius: number, colors: SchoolColors): THREE.Object3D {
  const holder = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius * 0.7, 0),
    basicMat(colors.glow, 1),
  );
  holder.add(core);
  for (let i = 0; i < 2; i++) {
    const spike = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 3.2, radius * 0.5),
      basicMat(colors.main, 0.7, true),
    );
    spike.rotation.z = (i * Math.PI) / 2;
    holder.add(spike);
  }
  holder.userData.stretch = false;
  return holder;
}

function moteMesh(radius: number, colors: SchoolColors): THREE.Object3D {
  const holder = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.4, 8, 6), basicMat(0xffffff, 1));
  holder.add(core);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 2.2, 10, 8),
    basicMat(colors.glow, 0.22, true),
  );
  holder.add(halo);
  holder.userData.stretch = false;
  return holder;
}

const BODIES = {
  orb: orbMesh,
  shard: shardMesh,
  blade: bladeMesh,
  star: starMesh,
  mote: moteMesh,
} as const;

// The trail spends a fixed budget per second rather than per frame: a
// projectile alive for three seconds must not cost three times a short
// one's particles at 144 Hz.
const TRAIL_EVERY_MS = 45;

function trailTick(
  trail: string,
  fx: VfxSystem,
  x: number,
  z: number,
  colors: SchoolColors,
  nowMs: number,
  holder: THREE.Object3D,
): void {
  const last = (holder.userData.trailAt as number | undefined) ?? 0;
  if (nowMs - last < TRAIL_EVERY_MS) return;
  holder.userData.trailAt = nowMs;
  const jitter = (): number => (Math.random() - 0.5) * 0.4;
  switch (trail) {
    case 'sparks':
      fx.particles.spawn({
        x: x + jitter(),
        y: 1 + jitter() * 0.5,
        z: z + jitter(),
        vy: 0.6,
        life: 0.28,
        size0: 0.26,
        size1: 0.04,
        color0: 0xffffff,
        color1: colors.main,
        alpha0: 0.9,
        alpha1: 0,
        sprite: SPRITE.fleck,
        drag: 2,
      });
      break;
    case 'smoke':
      fx.particles.spawn({
        x: x + jitter(),
        y: 1,
        z: z + jitter(),
        vy: 0.9,
        life: 0.7,
        size0: 0.4,
        size1: 1.2,
        color0: colors.main,
        alpha0: 0.3,
        alpha1: 0,
        sprite: SPRITE.smoke,
        rot: Math.random() * 6.28,
        rotVel: 0.6,
        drag: 1,
      });
      break;
    case 'embers':
      fx.particles.spawn({
        x: x + jitter(),
        y: 1 + jitter(),
        z: z + jitter(),
        vy: 1.4 + Math.random(),
        life: 0.6,
        size0: 0.2,
        size1: 0.05,
        color0: colors.glow,
        color1: colors.main,
        alpha0: 1,
        alpha1: 0,
        sprite: SPRITE.spark,
        gravity: -2,
        drag: 1.4,
      });
      break;
    case 'ribbon':
      fx.particles.spawn({
        x,
        y: 1,
        z,
        life: 0.34,
        size0: 0.55,
        size1: 0.12,
        color0: colors.glow,
        color1: colors.main,
        alpha0: 0.75,
        alpha1: 0,
        sprite: SPRITE.glow,
      });
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------ bursts

function markGround(fx: VfxSystem, x: number, z: number, r: number, mark: LookMark): void {
  if (mark === 'none' || mark === undefined) return;
  fx.decals.spawn(x, z, r, mark, 9000, { alpha: 0.7 });
}

// One burst word, drawn at (x, z) around a natural radius: the impact
// radius for a projectile, the zone radius for a detonation.
function drawBurst(
  cfg: LookBurst,
  fx: VfxSystem,
  x: number,
  z: number,
  radius: number,
  colors: SchoolColors,
): void {
  const s = scaleOf(cfg);
  const d = densityOf(cfg);
  const r = Math.max(0.4, radius * s);
  switch (cfg.shape) {
    case 'flash':
      fx.glowFlash(x, 1, z, r * 1.5, colors.glow, 0.24);
      fx.lightPulse(x, z, colors.main, 10 * s, 320);
      break;
    case 'spray':
      fx.glowFlash(x, 1, z, r, colors.glow, 0.2);
      fx.sparkBurst(x, 0.9, z, colors.main, Math.round(4 + 16 * d), 5 + 4 * s, {
        life: 0.45,
        size: 0.4 * s,
      });
      break;
    case 'ring':
      fx.glowFlash(x, 1, z, r, colors.glow, 0.18);
      fx.rings.spawn(x, z, r * 1.2, colors.main, 380, { alpha: 0.6 });
      if (d > 0.4) {
        fx.schedule(120, () => fx.rings.spawn(x, z, r * 1.6, colors.glow, 420, { alpha: 0.4 }));
      }
      break;
    case 'pillar':
      fx.pillars.spawn(x, z, r * 0.8, 5 + 3 * s, colors.main, 520, 0.34);
      fx.glowFlash(x, 1.4, z, r, colors.glow, 0.26);
      fx.sparkBurst(x, 0.8, z, colors.glow, Math.round(3 + 12 * d), 3, {
        life: 0.7,
        up: 9,
        size: 0.34,
      });
      break;
    case 'shatter':
      fx.glowFlash(x, 1, z, r, colors.glow, 0.2);
      fx.debris.burst(x, z, colors.main, Math.round(3 + 14 * d), { speed: 6 * s, size: 0.2 * s });
      fx.rings.spawn(x, z, r, colors.main, 340, { alpha: 0.45 });
      break;
    case 'bloom':
      fx.glowFlash(x, 1.1, z, r * 1.3, colors.glow, 0.42);
      fx.rings.spawn(x, z, r * 0.9, colors.glow, 620, { alpha: 0.35, width: 0.5 });
      for (let i = 0; i < Math.round(2 + 10 * d); i++) {
        const a = Math.random() * Math.PI * 2;
        fx.particles.spawn({
          x: x + Math.cos(a) * r * 0.5,
          y: 0.4,
          z: z + Math.sin(a) * r * 0.5,
          vy: 1.6 + Math.random(),
          life: 0.8,
          size0: 0.3 * s,
          size1: 0.7 * s,
          color0: colors.glow,
          color1: colors.main,
          alpha0: 0.8,
          alpha1: 0,
          sprite: SPRITE.glow,
          drag: 1.4,
        });
      }
      break;
    case 'wave':
      fx.rings.spawn(x, z, r * 1.5, colors.main, 460, { alpha: 0.7, width: 0.4 });
      fx.glowFlash(x, 0.7, z, r * 1.8, colors.glow, 0.2);
      fx.schedule(90, () => fx.rings.spawn(x, z, r * 2.1, colors.glow, 500, { alpha: 0.3 }));
      break;
    default:
      break;
  }
  if (cfg.smoke) fx.smokePuffs(x, z, colors.main, Math.round(2 + 6 * d), r * 0.8);
  if (cfg.mark) markGround(fx, x, z, r, cfg.mark);
  const shake = clamp(cfg.shake, LOOK_BOUNDS.shake.min, LOOK_BOUNDS.shake.max, 0);
  if (shake > 0) fx.onShake(shake);
}

// ------------------------------------------------------------------- zones

function zoneMesh(look: SpellLook, radius: number, colors: SchoolColors): THREE.Object3D {
  const holder = new THREE.Group();
  const floor = look.zone?.floor ?? 'disc';
  const edge = look.zone?.edge ?? 'soft';
  switch (floor) {
    case 'disc':
      holder.add(flatDisc(radius, colors.main, 0.24, 0.08));
      break;
    case 'ring':
      holder.add(flatRing(radius * 0.68, radius, colors.main, 0.34, 0.08));
      break;
    case 'runes': {
      holder.add(flatDisc(radius, colors.main, 0.12, 0.07));
      // Marks around an inner circle, each a short bar pointing outward:
      // a rune ring reads at a glance from the match camera, where any
      // actual glyph would be four pixels of mud.
      const runes = new THREE.Group();
      const count = 8;
      for (let i = 0; i < count; i++) {
        const mark = new THREE.Mesh(
          new THREE.PlaneGeometry(radius * 0.26, radius * 0.06),
          basicMat(colors.glow, 0.85),
        );
        const a = (i / count) * Math.PI * 2;
        mark.rotation.set(-Math.PI / 2, 0, -a);
        mark.position.set(Math.cos(a) * radius * 0.72, 0.11, Math.sin(a) * radius * 0.72);
        runes.add(mark);
      }
      holder.add(runes);
      holder.userData.runes = runes;
      break;
    }
    case 'pool':
      holder.add(flatDisc(radius, colors.main, 0.42, 0.07));
      holder.add(flatDisc(radius * 0.72, colors.glow, 0.24, 0.09));
      break;
    case 'storm':
      holder.add(flatDisc(radius, colors.main, 0.18, 0.07));
      holder.add(flatRing(radius * 0.9, radius, colors.glow, 0.5, 0.1));
      break;
  }
  const rimColor = edge === 'jagged' ? colors.glow : colors.main;
  const rimAlpha = edge === 'hard' ? 0.95 : edge === 'jagged' ? 0.7 : 0.4;
  const rim = flatRing(radius * 0.94, radius, rimColor, rimAlpha, 0.12);
  holder.add(rim);
  holder.userData.rim = rim;
  return holder;
}

const ZONE_TICK_EVERY_MS = 90;

function zoneTicker(look: SpellLook): SpellVisual['zoneTick'] {
  const motion = look.zone?.motion ?? 'still';
  if (motion === 'still') return undefined;
  return (fx, holder, x, z, radius, ageMs, colors, dtMs) => {
    if (motion === 'swirl') {
      holder.rotation.y += (dtMs / 1000) * 0.8;
      const runes = holder.userData.runes as THREE.Object3D | undefined;
      if (runes) runes.rotation.y -= (dtMs / 1000) * 1.6;
      return;
    }
    if (motion === 'pulse') {
      const rim = holder.userData.rim as THREE.Mesh | undefined;
      if (rim) {
        const mat = rim.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.5 + 0.35 * Math.sin(ageMs * 0.006);
      }
      return;
    }
    // rain: drops falling inside the area, on their own clock so the
    // frame rate never changes how heavy the weather is.
    const last = (holder.userData.rainAt as number | undefined) ?? 0;
    if (ageMs - last < ZONE_TICK_EVERY_MS) return;
    holder.userData.rainAt = ageMs;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    fx.particles.spawn({
      x: x + Math.cos(a) * r,
      y: 4.5,
      z: z + Math.sin(a) * r,
      vy: -9,
      life: 0.5,
      size0: 0.22,
      size1: 0.1,
      color0: colors.glow,
      color1: colors.main,
      alpha0: 0.9,
      alpha1: 0.2,
      sprite: SPRITE.fleck,
    });
  };
}

// ------------------------------------------------------------------ windup

function windupTicker(motion: string): SpellVisual['windupTick'] {
  return (fx, x, z, progress, colors) => {
    // The windup hook is per-frame; the gather spends on its own clock.
    fx.glowFlash(x, 1.5, z, 0.7 + progress * 1.5, colors.glow, 0.09);
    if (motion === 'none') return;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      if (motion === 'orbit') {
        const r = 1.7;
        fx.particles.spawn({
          x: x + Math.cos(a) * r,
          y: 0.8 + Math.random() * 1.2,
          z: z + Math.sin(a) * r,
          vx: -Math.sin(a) * 5,
          vz: Math.cos(a) * 5,
          life: 0.3,
          size0: 0.3,
          size1: 0.08,
          color0: colors.glow,
          alpha0: 0.9,
          sprite: SPRITE.fleck,
        });
        continue;
      }
      if (motion === 'rise') {
        fx.particles.spawn({
          x: x + Math.cos(a) * 1.2,
          y: 0.1,
          z: z + Math.sin(a) * 1.2,
          vy: 3.5 + Math.random() * 2,
          life: 0.4,
          size0: 0.26,
          size1: 0.06,
          color0: colors.glow,
          color1: colors.main,
          alpha0: 0.95,
          sprite: SPRITE.spark,
          gravity: -3,
        });
        continue;
      }
      // gather: pulled inward, tightening as the cast fills.
      const r = 2 - progress * 0.9;
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
  };
}

// --------------------------------------------------------------- the visual

// The look read into hooks. Only the parts the look declares appear, so
// everything it leaves out keeps the generic the renderer already draws.
export function lookVisual(look: SpellLook): SpellVisual {
  const vis: SpellVisual = {};
  const body = look.projectile?.body;
  if (body && body !== 'bolt') {
    const build = BODIES[body];
    const bodyScale = clamp(
      look.projectile?.scale,
      LOOK_BOUNDS.scale.min,
      LOOK_BOUNDS.scale.max,
      1,
    );
    vis.projectile = (radius, colors) => build(radius * bodyScale, colors);
  }
  const trail = look.projectile?.trail ?? 'none';
  const spin = clamp(look.projectile?.spin, LOOK_BOUNDS.spin.min, LOOK_BOUNDS.spin.max, 0);
  if (trail !== 'none' || spin !== 0) {
    vis.projectileTick = (fx, x, z, dtMs, colors, nowMs, holder) => {
      if (spin !== 0) holder.rotation.z += spin * (dtMs / 1000) * Math.PI * 2;
      if (trail !== 'none') trailTick(trail, fx, x, z, colors, nowMs, holder);
    };
  }
  if (look.impact) {
    const cfg = look.impact;
    vis.impact = (fx, x, z, colors) => drawBurst(cfg, fx, x, z, 1.4, colors);
  }
  if (look.cast) {
    const cfg = look.cast;
    vis.castFx = (fx, x, z, _dirX, _dirZ, colors) => drawBurst(cfg, fx, x, z, 1.6, colors);
  }
  if (look.detonate) {
    const cfg = look.detonate;
    vis.detonate = (fx, x, z, radius, colors) => drawBurst(cfg, fx, x, z, radius, colors);
  }
  if (look.zone) {
    vis.zone = (radius, colors) => zoneMesh(look, radius, colors);
    const tick = zoneTicker(look);
    if (tick) vis.zoneTick = tick;
  }
  if (look.windup) vis.windupTick = windupTicker(look.windup.motion);
  return vis;
}
