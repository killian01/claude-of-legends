// Per-ability projectile and zone visuals driven by the cosmetic vfx tag:
// the school color derives from the ability's own effect record (the same
// derivation family as the HUD icons) and the shape from its cast spec, so
// every skillshot and zone reads as ITS spell instead of a team-colored
// blob. Auto attacks carry no tag and keep the small team bolt.

import * as THREE from 'three';
import type { CastSpec } from '../sim/combat/casting';
import { SIGILS } from '../sim/content/sigils';
import type { Projectile } from '../sim/projectiles';
import type { Zone } from '../sim/zones';
import type { IWorld } from '../world_api';

interface School {
  main: number;
  glow: number;
}

const SCHOOLS: Readonly<Record<string, School>> = {
  arcane: { main: 0x9a6cf0, glow: 0xcdb2ff },
  steel: { main: 0xe07a4a, glow: 0xffb28a },
  life: { main: 0x7ad05a, glow: 0xc8ff9a },
  control: { main: 0xe8c145, glow: 0xffe9a0 },
  wind: { main: 0x54c8d8, glow: 0xaef2f8 },
  fire: { main: 0xef8a3c, glow: 0xffc07a },
};

// The school color for a cast spec, for one-shot cast flashes (instant
// abilities have no projectile or zone to carry their identity).
export function schoolColorOf(spec: CastSpec): { main: number; glow: number } {
  return schoolOf(spec);
}

function schoolOf(spec: CastSpec): School {
  const json = JSON.stringify(spec);
  const has = (w: string): boolean => json.includes(`"${w}"`);
  if (has('dot') || has('burn')) return SCHOOLS.fire!;
  if (has('heal') || has('shield')) return SCHOOLS.life!;
  if (has('stun') || has('taunt') || has('knockback') || has('pull')) return SCHOOLS.control!;
  if (spec.kind === 'dash' || has('haste')) return SCHOOLS.wind!;
  if (json.includes('adRatio')) return SCHOOLS.steel!;
  return SCHOOLS.arcane!;
}

// 'championId_KEY' or 'sigil_id' back to the cast spec it came from.
function resolveSpec(vfx: string | null, world: IWorld): CastSpec | null {
  if (!vfx) return null;
  if (vfx.startsWith('sigil_')) return SIGILS[vfx.slice(6)]?.spec ?? null;
  const sep = vfx.lastIndexOf('_');
  if (sep <= 0) return null;
  const key = vfx.slice(sep + 1);
  if (key !== 'Q' && key !== 'W' && key !== 'E' && key !== 'R') return null;
  return world.championDef(vfx.slice(0, sep))?.abilities[key].spec ?? null;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.32)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  glowTex = new THREE.CanvasTexture(canvas);
  return glowTex;
}

// The renderer orients projectiles along +x and stretches the whole holder
// while they fly, so the core is authored pointing down +x.
export function buildProjectileMesh(
  p: Readonly<Projectile>,
  world: IWorld,
  teamLight: number,
): THREE.Object3D {
  const spec = resolveSpec(p.vfx, world);
  if (!spec) {
    return new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.25, p.radius), 10, 8),
      new THREE.MeshLambertMaterial({
        color: teamLight,
        emissive: teamLight,
        emissiveIntensity: 0.5,
      }),
    );
  }
  const school = schoolOf(spec);
  const holder = new THREE.Group();
  const r = Math.max(0.32, p.radius * 0.85);
  const coreMat = new THREE.MeshLambertMaterial({
    color: school.main,
    emissive: school.main,
    emissiveIntensity: 0.8,
    flatShading: true,
  });
  // VFX skip tone mapping so school colors stay saturated instead of
  // washing out to white under ACES.
  coreMat.toneMapped = false;
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(r), coreMat);
  core.scale.set(2.1, 0.8, 0.8);
  holder.add(core);
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: school.glow,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.85,
  });
  glowMat.toneMapped = false;
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(r * 5);
  holder.add(glow);
  return holder;
}

// Zones: a school-colored fill, a glowing rim, and a slow ring of marks
// (the renderer spins holder.userData.marks each frame).
export function buildZoneMesh(z: Readonly<Zone>, world: IWorld, teamColor: number): THREE.Object3D {
  const spec = resolveSpec(z.vfx, world);
  if (!spec) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(z.radius, z.radius, 0.15, 24),
      new THREE.MeshLambertMaterial({ color: teamColor, transparent: true, opacity: 0.3 }),
    );
    return mesh;
  }
  const school = schoolOf(spec);
  const holder = new THREE.Group();
  const fillMat = new THREE.MeshBasicMaterial({
    color: school.main,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  fillMat.toneMapped = false;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(z.radius, 28), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.1;
  holder.add(fill);
  const rimMat = new THREE.MeshBasicMaterial({ color: school.main });
  rimMat.toneMapped = false;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(z.radius, 0.13, 6, 36), rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.12;
  holder.add(rim);
  const marks = new THREE.Group();
  const markMat = new THREE.MeshBasicMaterial({ color: school.glow });
  markMat.toneMapped = false;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const mark = new THREE.Mesh(new THREE.TetrahedronGeometry(0.22), markMat);
    mark.position.set(Math.cos(a) * z.radius * 0.82, 0.22, Math.sin(a) * z.radius * 0.82);
    marks.add(mark);
  }
  holder.add(marks);
  holder.userData.marks = marks;
  return holder;
}
