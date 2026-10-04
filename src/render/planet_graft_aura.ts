// A Heartwood on the Wanderseed (CONTEXT.md: Graft): the champion carrying
// one stands in a slow glowing aura of the Graft's color, a ring at its
// feet and a soft veil around its body, for everyone who sees it; its
// nameplate carries the Graft's mark too (heartwoodIcon, drawn by the
// renderer over the plate). Mounted by PlanetMarks beside the Grace's
// shimmer, which hands it how to stand a mark on the ground; the stage
// hands it the champions in sight that carry one, where the renderer draws
// them.

import * as THREE from 'three';
import { GRAFTS } from '../sim/content/grafts';
import type { Vec3 } from '../sim/geo';

// At most this many auras at once.
export const MAX_AURAS = 16;
const VEIL_R = 1.05;
const VEIL_H = 2.2;
const PULSE_HZ = 0.7;

// A champion carrying a Heartwood, as the stage hands it.
export interface HeartwoodNote {
  unitId: number;
  graft: string;
  at: Vec3;
}

// The Graft's color, a soft violet when it names none.
export function heartwoodColor(graft: string): number {
  return GRAFTS[graft]?.color ?? 0xb98af0;
}

// The aura's opacity at `nowMs`: a slow breath between 0.18 and 0.32.
export function auraOpacity(nowMs: number): number {
  return 0.25 + 0.07 * Math.sin((nowMs / 1000) * PULSE_HZ * 2 * Math.PI);
}

// The plate's mark: a small disc of the Graft's color with its initial.
export function heartwoodIcon(graft: string): THREE.Sprite | null {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const color = `#${heartwoodColor(graft).toString(16).padStart(6, '0')}`;
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = 'rgba(8, 10, 20, 0.9)';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText((GRAFTS[graft]?.name ?? graft).charAt(0).toUpperCase(), 32, 34);
  const material = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.7, 0.7, 1);
  return sprite;
}

interface Aura {
  veil: THREE.Mesh;
  ring: THREE.Mesh;
}

export class PlanetGraftAura {
  readonly group = new THREE.Group();
  private readonly veilGeo: THREE.CylinderGeometry;
  private readonly ringGeo: THREE.RingGeometry;
  private readonly pool: Aura[] = [];

  constructor(
    // A mark standing on the ground at p, its up the normal there, lifted
    // and scaled (PlanetMarks.standing).
    private readonly standing: (p: Vec3, lift: number, scale: number) => THREE.Matrix4,
  ) {
    this.group.name = 'planet-graft-aura';
    this.veilGeo = new THREE.CylinderGeometry(VEIL_R, VEIL_R * 0.7, VEIL_H, 18, 1, true);
    this.veilGeo.translate(0, VEIL_H / 2, 0);
    this.ringGeo = new THREE.RingGeometry(VEIL_R * 0.8, VEIL_R * 1.2, 32);
    this.ringGeo.rotateX(-Math.PI / 2);
  }

  private take(i: number): Aura {
    const have = this.pool[i];
    if (have) return have;
    const mat = (): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
    const a: Aura = {
      veil: new THREE.Mesh(this.veilGeo, mat()),
      ring: new THREE.Mesh(this.ringGeo, mat()),
    };
    for (const m of [a.veil, a.ring]) {
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
    }
    this.pool.push(a);
    return a;
  }

  // One frame: the champions in sight carrying a Heartwood.
  update(notes: readonly HeartwoodNote[], nowMs: number): void {
    const opacity = auraOpacity(nowMs);
    const shown = notes.slice(0, MAX_AURAS);
    for (const [i, n] of shown.entries()) {
      const a = this.take(i);
      const color = heartwoodColor(n.graft);
      for (const m of [a.veil, a.ring]) {
        const material = m.material as THREE.MeshBasicMaterial;
        material.color.setHex(color);
        m.visible = true;
      }
      (a.veil.material as THREE.MeshBasicMaterial).opacity = opacity;
      (a.ring.material as THREE.MeshBasicMaterial).opacity = opacity * 1.8;
      a.veil.matrix.copy(this.standing(n.at, 0, 1));
      a.ring.matrix.copy(this.standing(n.at, 0.08, 1));
    }
    for (let i = shown.length; i < this.pool.length; i++) {
      this.pool[i]!.veil.visible = false;
      this.pool[i]!.ring.visible = false;
    }
  }

  dispose(): void {
    for (const a of this.pool) {
      this.group.remove(a.veil, a.ring);
      (a.veil.material as THREE.Material).dispose();
      (a.ring.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
    this.veilGeo.dispose();
    this.ringGeo.dispose();
  }
}
