// The forests' camp bodies as figures (CONTEXT.md: Spinecrest,
// Brackenlings, Barkmaw; content/camps.ts), built like the creatures': a
// few flat-shaded primitives, so the three kinds read apart from across
// a corridor. The Spinecrest a squat amber-jade prowler with a ridge of
// thorns; a Brackenling small and quick, a fern crest over a mossy body;
// the Barkmaw bulk in bark, a wide dark maw with two pale tusks and moss
// on its back. A Blender model can replace any of them without touching
// the sim.

import * as THREE from 'three';
import type { CampKind } from '../sim/content/camps';
import type { Unit } from '../sim/unit';

export interface CampFigure {
  holder: THREE.Group;
  barY: number;
}

function flat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function spinecrest(holder: THREE.Group): CampFigure {
  const hide = flat(0x8a6a3f);
  const thorns = flat(0x4a6a45);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.65, 0), hide);
  body.position.y = 0.65;
  body.scale.set(1.1, 0.85, 1.25);
  holder.add(body);
  for (let i = 0; i < 3; i++) {
    const thorn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 4), thorns);
    thorn.position.set(0, 1.1, -0.35 + i * 0.35);
    thorn.rotation.x = -0.3;
    holder.add(thorn);
  }
  return { holder, barY: 1.9 };
}

function brackenling(holder: THREE.Group): CampFigure {
  const moss = flat(0x5f7a3a);
  const fern = flat(0x8fc45a);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), moss);
  body.position.y = 0.4;
  body.scale.set(1, 0.8, 1.2);
  holder.add(body);
  for (let i = 0; i < 3; i++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.55, 3), fern);
    frond.position.set((i - 1) * 0.14, 0.9, -0.1);
    frond.rotation.x = -0.45 + i * 0.1;
    frond.rotation.z = (i - 1) * 0.3;
    holder.add(frond);
  }
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), flat(0xf4e6a0));
    eye.position.set(side * 0.17, 0.5, 0.42);
    holder.add(eye);
  }
  return { holder, barY: 1.25 };
}

function barkmaw(holder: THREE.Group): CampFigure {
  const bark = flat(0x5a3f26);
  const maw = flat(0x1e1410);
  const tusk = flat(0xe8dcc0);
  const moss = flat(0x4f7a3a);
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), bark);
  body.position.y = 1.05;
  body.scale.set(1.3, 1.0, 1.4);
  holder.add(body);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.7), maw);
  jaw.position.set(0, 0.7, 1.15);
  holder.add(jaw);
  for (const side of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 5), tusk);
    t.position.set(side * 0.55, 0.95, 1.4);
    t.rotation.x = -0.9;
    holder.add(t);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.8, 5), bark);
    leg.position.set(side * 0.8, 0.4, 0.3);
    holder.add(leg);
  }
  for (let i = 0; i < 3; i++) {
    const patch = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), moss);
    patch.position.set((i - 1) * 0.55, 1.95, -0.5 + (i % 2) * 0.5);
    patch.scale.set(1, 0.5, 1);
    holder.add(patch);
  }
  return { holder, barY: 2.7 };
}

export function buildCampMesh(u: Readonly<Unit>, holder: THREE.Group): CampFigure {
  const kind: CampKind = u.campKind ?? 'spinecrest';
  if (kind === 'brackenlings') return brackenling(holder);
  if (kind === 'barkmaw') return barkmaw(holder);
  return spinecrest(holder);
}

// The health bar's width over a camp body: the Barkmaw's is a team
// body's, a Brackenling's a minion's.
export function campBarWidth(u: Readonly<Unit>): number {
  if (u.campKind === 'barkmaw') return 2.2;
  if (u.campKind === 'brackenlings') return 1.0;
  return 1.5;
}
