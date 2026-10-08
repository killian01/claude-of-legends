// The left thumb's stick (CONTEXT.md: Thumb stick): the phone's way to
// walk, in the manner of every MOBA built for a phone. A touch that lands
// in the left part of the screen is the stick: its base appears under the
// finger, the finger's offset from it is the direction, and the champion
// walks that way for as long as the thumb stays out of the dead zone at
// the middle. Lifting the thumb halts.
//
// Pure: a state machine over pointer events, with no DOM and no sim, so
// tests/thumb_stick.test.ts can drive it event by event. touch.ts feeds it
// and reads it every frame; the order itself is boot.ts's business
// (onThumbMove), where the sim's own rules apply. Movement is an
// intention outside the decision budget (ADR 0003), so a stick that speaks
// every tick costs nobody anything and gives no throughput a bot lacks.

import { dot, offset, onSphere } from '../sim/geo';
import type { Vec2 } from '../sim/types';

// How far the knob travels from the base, in CSS pixels: the ring a thumb
// sweeps comfortably without the wrist moving.
export const STICK_RADIUS = 60;
// Inside this, the thumb is resting, not steering.
export const STICK_DEAD = 10;
// Where a touch is the stick: the left part of the screen, below the strip
// the score and the clock occupy. Fractions of the viewport.
export const STICK_ZONE_X = 0.45;
export const STICK_ZONE_TOP = 0.14;

export interface Viewport {
  width: number;
  height: number;
}

// The thumb's direction on screen, unit length, with how far out it sits
// (0 at the dead zone's edge, 1 at the ring).
export interface StickVector {
  x: number;
  y: number;
  k: number;
}

export function inStickZone(x: number, y: number, viewport: Viewport): boolean {
  return x < viewport.width * STICK_ZONE_X && y > viewport.height * STICK_ZONE_TOP;
}

export class ThumbStick {
  private id: number | null = null;
  private cx = 0;
  private cy = 0;
  private x = 0;
  private y = 0;

  get active(): boolean {
    return this.id !== null;
  }

  // Where the base sits: under the finger that started the touch.
  get center(): Vec2 {
    return { x: this.cx, z: this.cy };
  }

  // Where the knob is drawn: the finger, held to the ring.
  get knob(): Vec2 {
    const dx = this.x - this.cx;
    const dy = this.y - this.cy;
    const d = Math.hypot(dx, dy);
    if (d <= STICK_RADIUS) return { x: this.x, z: this.y };
    return { x: this.cx + (dx / d) * STICK_RADIUS, z: this.cy + (dy / d) * STICK_RADIUS };
  }

  // Claims the touch when it lands in the zone and no finger holds the
  // stick already; a second finger there is left to the other gestures.
  down(id: number, x: number, y: number, viewport: Viewport): boolean {
    if (this.id !== null || !inStickZone(x, y, viewport)) return false;
    this.id = id;
    this.cx = x;
    this.cy = y;
    this.x = x;
    this.y = y;
    return true;
  }

  // True when the pointer is the stick's; the caller then keeps it away
  // from the tap and pan gestures.
  move(id: number, x: number, y: number): boolean {
    if (this.id !== id) return false;
    this.x = x;
    this.y = y;
    return true;
  }

  up(id: number): boolean {
    if (this.id !== id) return false;
    this.id = null;
    return true;
  }

  // The direction the thumb points, or null while it rests in the dead
  // zone (or nothing holds the stick).
  vector(): StickVector | null {
    if (this.id === null) return null;
    const dx = this.x - this.cx;
    const dy = this.y - this.cy;
    const d = Math.hypot(dx, dy);
    if (d < STICK_DEAD) return null;
    const k = Math.min(1, (d - STICK_DEAD) / (STICK_RADIUS - STICK_DEAD));
    return { x: dx / d, y: dy / d, k };
  }
}

// How the stick becomes orders. The champion is sent a few meters ahead
// along the thumb's direction: far enough that it never arrives and
// stops between two resends, near enough that a wall ahead stops it at
// the wall rather than pathing round the world. The order is resent when
// the thumb has turned, and on a keep-alive otherwise, which is a handful
// of messages a second against the server's cap of sixty.
export const STICK_LEAD_M = 4;
export const STICK_RESEND_MS = 250;
// The turn that is worth a fresh order: about seven degrees.
export const STICK_TURN_RAD = 0.12;

export interface StickOrder {
  x: number;
  z: number;
  // On the planet the direction is a tangent vector with y (geo.ts).
  y?: number;
  at: number;
}

export function shouldResend(last: StickOrder | null, dir: Vec2, now: number): boolean {
  if (last === null) return true;
  if (now - last.at >= STICK_RESEND_MS) return true;
  const dot = Math.max(
    -1,
    Math.min(1, last.x * dir.x + last.z * dir.z + (last.y ?? 0) * (dir.y ?? 0)),
  );
  return Math.acos(dot) >= STICK_TURN_RAD;
}

// The point the order names: ahead along the direction, held inside the
// map so the edge of the world is never asked for.
// On the planet: along the great circle, a sphere with no edge to keep to.
export function leadPoint(self: Vec2, dir: Vec2, lead: number, mapSize: number): Vec2 {
  if (onSphere(self) && dir.y !== undefined) return offset(self, dir, lead);
  const clamp = (v: number): number => Math.max(0, Math.min(mapSize, v));
  return { x: clamp(self.x + dir.x * lead), z: clamp(self.z + dir.z * lead) };
}

// The attack the player gave last, by the attack button or a tap or click
// on an enemy, which the stick keeps while it points that way.
export interface AttackHold {
  targetId: number;
}

// How far toward the target the thumb has to point to keep the attack:
// anywhere toward or sideways of it.
export const STICK_YIELD_DOT = 0;

// Whether the stick yields to the attack held: an attack given, its target
// in sight (toTarget, the direction toward it from the champion), and the
// thumb pointing toward or sideways of it. While it yields the stick sends
// nothing, so its keep-alive no longer turns the attack into a walk (a
// phone's 31 attack orders landed 96 damage, its target left at 99%);
// pointed away, the walk goes at once.
export function stickYields(hold: AttackHold | null, dir: Vec2, toTarget: Vec2 | null): boolean {
  return hold !== null && toTarget !== null && dot(dir, toTarget) >= STICK_YIELD_DOT;
}
