// A bout's goal primitives on the wire (ADR 0035, the closed set: a circle,
// a carrier, a target): the server writes each one a seat sees into its
// snapshot's tf block (server/thornfray_snapshot.ts), the client reads it
// back. Its holder rides as the champion's unit id, as the observation
// names it (ObsRoyale.bout.goals), never as a seat index. Pure, so both
// ends share it and a test round-trips every shape.

import type { GoalShape } from '../sim/content/bouts/types';
import type { Vec3 } from '../sim/geo';
import type { SnapGoal } from './royale_wire';

const GOAL_SHAPES: ReadonlySet<string> = new Set<GoalShape>(['circle', 'carrier', 'target']);

const round2 = (v: number): number => Math.round(v * 100) / 100;

// A goal as either end holds it: its shape, where it stands, its radius,
// and the unit id of the champion holding it.
export interface WireGoal {
  shape: GoalShape;
  at: Vec3;
  radius: number;
  holder: number | null;
}

export function goalOnWire(g: WireGoal): SnapGoal {
  return [g.shape, round2(g.at.x), round2(g.at.y), round2(g.at.z), round2(g.radius), g.holder];
}

// A goal off the wire, or null for anything that is not one: a shape
// outside the closed set, a coordinate that is not a finite number, a
// holder that is not a unit id.
export function goalOffWire(w: unknown): WireGoal | null {
  if (!Array.isArray(w) || w.length !== 6) return null;
  const [shape, x, y, z, radius, holder] = w as unknown[];
  if (typeof shape !== 'string' || !GOAL_SHAPES.has(shape)) return null;
  const finite = [x, y, z, radius].every((v) => typeof v === 'number' && Number.isFinite(v));
  if (!finite || (radius as number) < 0) return null;
  if (holder !== null && !(typeof holder === 'number' && Number.isInteger(holder))) return null;
  return {
    shape: shape as GoalShape,
    at: { x: x as number, y: y as number, z: z as number },
    radius: radius as number,
    holder: holder as number | null,
  };
}
