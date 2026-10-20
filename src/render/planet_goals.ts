// A bout's goals on the Wanderseed (ADR 0035, the closed set of goal
// primitives: a circle, a carrier, a target), drawn by the engine for every
// kind from the shape alone, so a kind brings no drawing of its own: on the
// planet and on the globe (the same marks, in sphere coordinates, turned
// with it), and on the minimap (planet_minimap.ts paints goalDots). A
// circle is a ring of its radius on the ground with a tall column at its
// heart; a carrier a ring at the holder's feet and a short column over it;
// a target a ring with a column, ringed twice. The color says who holds
// it: the viewer gold, another seat red, nobody the light's pale blue. The
// primitives come from the snapshot's tf block (net/thornfray_client.ts
// boutLineOf), their holder a unit id.

import * as THREE from 'three';
import type { WireGoal } from '../net/goal_wire';
import type { Vec3 } from '../sim/geo';

export const MAX_GOALS = 8;
export const GOAL_SELF = 0xffd35a;
export const GOAL_OTHER = 0xff5a4a;
export const GOAL_NONE = 0xbfe0ff;

export interface GoalLook {
  color: number;
  // The column over it, meters; and a second ring for a target.
  column: number;
  double: boolean;
}

// How a goal is drawn, from its shape and its holder alone.
export function goalLook(
  goal: Pick<WireGoal, 'shape' | 'holder'>,
  selfId: number | null,
): GoalLook {
  const color = goal.holder === null ? GOAL_NONE : goal.holder === selfId ? GOAL_SELF : GOAL_OTHER;
  if (goal.shape === 'carrier') return { color, column: 4, double: false };
  return { color, column: 14, double: goal.shape === 'target' };
}

// The minimap's dot for a goal: its point, its radius in meters and its
// color as CSS.
export interface GoalDot {
  at: Vec3;
  radius: number;
  color: string;
  ring: boolean;
}

export function goalDots(goals: readonly WireGoal[], selfId: number | null): GoalDot[] {
  return goals.slice(0, MAX_GOALS).map((g) => {
    const look = goalLook(g, selfId);
    return {
      at: g.at,
      radius: g.radius,
      color: `#${look.color.toString(16).padStart(6, '0')}`,
      ring: g.shape !== 'carrier',
    };
  });
}

interface Mark {
  ring: THREE.Mesh;
  outer: THREE.Mesh;
  column: THREE.Mesh;
}

export class PlanetGoals {
  readonly group = new THREE.Group();
  private readonly ringGeo: THREE.RingGeometry;
  private readonly columnGeo: THREE.CylinderGeometry;
  private readonly pool: Mark[] = [];

  constructor(
    // A mark standing on the ground at p, its up the normal there, lifted
    // and scaled (PlanetMarks.standing).
    private readonly standing: (p: Vec3, lift: number, scale: number) => THREE.Matrix4,
  ) {
    this.group.name = 'planet-goals';
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 48);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.columnGeo = new THREE.CylinderGeometry(0.35, 0.6, 1, 12, 1, true);
    this.columnGeo.translate(0, 0.5, 0);
    // The first mark stands ready, hidden: its programs link with the
    // planet's before its first frame.
    this.take(0);
  }

  private take(i: number): Mark {
    const have = this.pool[i];
    if (have) return have;
    const mat = (): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
    const m: Mark = {
      ring: new THREE.Mesh(this.ringGeo, mat()),
      outer: new THREE.Mesh(this.ringGeo, mat()),
      column: new THREE.Mesh(this.columnGeo, mat()),
    };
    for (const mesh of [m.ring, m.outer, m.column]) {
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
    }
    this.pool.push(m);
    return m;
  }

  // One frame: the bout's goals, the viewer's unit for the holder's color.
  update(goals: readonly WireGoal[], selfId: number | null, nowMs: number): void {
    const shown = goals.slice(0, MAX_GOALS);
    const pulse = 0.55 + 0.2 * Math.sin((nowMs / 1000) * 2.2 * Math.PI);
    for (const [i, g] of shown.entries()) {
      const m = this.take(i);
      const look = goalLook(g, selfId);
      for (const mesh of [m.ring, m.outer, m.column]) {
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(look.color);
      }
      const r = Math.max(0.5, g.radius);
      m.ring.matrix.copy(this.standing(g.at, 0.1, r));
      (m.ring.material as THREE.MeshBasicMaterial).opacity = pulse;
      m.ring.visible = true;
      m.outer.visible = look.double;
      if (look.double) {
        m.outer.matrix.copy(this.standing(g.at, 0.12, r * 1.35));
        (m.outer.material as THREE.MeshBasicMaterial).opacity = pulse * 0.6;
      }
      const column = this.standing(g.at, 0, 1);
      column.multiply(new THREE.Matrix4().makeScale(1, look.column, 1));
      m.column.matrix.copy(column);
      (m.column.material as THREE.MeshBasicMaterial).opacity = 0.35;
      m.column.visible = true;
    }
    for (let i = shown.length; i < this.pool.length; i++) {
      const m = this.pool[i]!;
      m.ring.visible = false;
      m.outer.visible = false;
      m.column.visible = false;
    }
  }

  dispose(): void {
    for (const m of this.pool) {
      this.group.remove(m.ring, m.outer, m.column);
      for (const mesh of [m.ring, m.outer, m.column]) {
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.pool.length = 0;
    this.ringGeo.dispose();
    this.columnGeo.dispose();
  }
}
