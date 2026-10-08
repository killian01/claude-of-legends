// The own champion drawn where it is going (ADR 0028). Online, an order
// reaches the server half a round trip after the click and its effect
// comes back half a trip later, so the champion used to answer a click a
// round trip late: a third of a second on a far connection. The client keeps the orders it sent and draws its champion
// as the server will have it once they land: every frame it re-walks the
// newest state the server told for the time an order sent now would land
// at, the orders still on their way applied when each lands, with the
// path search and the walking step the sim itself runs
// (src/sim/pathfind.ts, src/sim/movement.ts).
//
// Display only. The server decides everything, the mirror world keeps
// the server's position for every rule that reads one, and what the
// prediction got wrong (a push between bodies, a stun it could not know)
// is eased out on screen rather than jumped, unless the server moved the
// champion farther than any walk could (a recall home, a blink).
//
// The clock is handed in, so a test drives it frame by frame.

import { hypot } from '../sim/exact';
import { stepMovement } from '../sim/movement';
import type { NavGrid } from '../sim/navgrid';
import { findPath } from '../sim/pathfind';
import { DT, type Vec2 } from '../sim/types';

// What the newest snapshot says of the own champion's walk.
export interface SelfState {
  // The snapshot's match time, seconds.
  time: number;
  pos: Vec2;
  // The path it still has to walk.
  path: readonly Vec2[];
  // Its speed once nothing holds it in place (SelfSnap ms).
  speed: number;
  // The match time until which it cannot walk: a root or a stun, or a
  // cast's windup, which plants the caster.
  stillUntil: number;
  // The unit it is set on attacking: it walks into range and stops there.
  chaseId: number | null;
  range: number;
  radius: number;
  // Nothing to predict: dead, carried by a dash, the match over, or a
  // server that does not tell the walk. The server's position is drawn.
  off: boolean;
  // The number of the last order the server applied, and the match time
  // it applied it (SelfSnap ack, ackAt).
  ack: number;
  ackAt: number;
}

// Where an attacked unit stands, as the mirror world has it.
export interface ChaseTarget {
  x: number;
  z: number;
  radius: number;
}

// The champion as it is drawn this frame, and the way it walks; heading
// is null while it stands.
export interface DrawnSelf {
  x: number;
  z: number;
  heading: Vec2 | null;
}

// What an order does to the walk, as the sim would do it.
export type WalkEffect =
  | { kind: 'walk'; path: Vec2[] }
  | { kind: 'chase'; targetId: number; path: Vec2[] }
  | { kind: 'stop' }
  // A cast whose windup plants the caster (src/sim/combat/casting.ts): its
  // path is dropped and it stands until the windup resolves.
  | { kind: 'windup'; seconds: number };

interface Pending {
  seq: number;
  sentAt: number;
  effect: WalkEffect | null;
}

interface Walker {
  pos: Vec2;
  path: Vec2[];
  chaseId: number | null;
  stillUntil: number;
  heading: Vec2 | null;
}

// Before the first order is answered, the round trip a land is assumed
// at: about the server's distance from most of Europe, doubled.
export const RTT_GUESS_MS = 120;
// How much of a new measurement of when orders land moves the estimate.
export const LAND_BLEND = 0.25;
// The furthest ahead of the newest state the champion is drawn. A stall
// in the connection keeps the server walking, so the walk goes on, but
// not forever.
export const LEAD_MAX_S = 2;
// How fast a correction is eased out: about two thirds of it in this
// many milliseconds.
export const EASE_MS = 120;
// A correction past this is a move the server made (a recall home, a
// blink, a respawn), shown as the jump it is.
export const SNAP_M = 4;
// Orders kept while their answers are awaited; the oldest go first.
export const PENDING_MAX = 64;

const copy = (p: Vec2): Vec2 => ({ x: p.x, z: p.z });

export class SelfPredictor {
  private seq = 0;
  private pending: Pending[] = [];
  private state: SelfState | null = null;
  // When an order lands, in match milliseconds less the client clock at
  // its sending: measured from the answers, guessed before the first.
  private landMs: number | null = null;
  private guessMs = 0;
  private lastAck = 0;
  private ease: Vec2 = { x: 0, z: 0 };
  private easedAt = 0;
  private drawing = false;

  constructor(
    private readonly nav: NavGrid,
    private readonly targetOf: (id: number) => ChaseTarget | null,
  ) {}

  // The match time an order sent at `now` lands at.
  landsAt(now: number): number {
    return (now + (this.landMs ?? this.guessMs)) / 1000;
  }

  // The orders, each answering the number it goes up the wire with. The
  // path is searched from where the champion is drawn walking, as the
  // server will search it from where its champion stands when the order
  // lands.
  move(to: Vec2, now: number): number {
    const from = this.raw(now)?.pos ?? this.state?.pos;
    return this.note({ kind: 'walk', path: from ? findPath(this.nav, from, to) : [] }, now);
  }

  chase(targetId: number, now: number): number {
    const from = this.raw(now)?.pos ?? this.state?.pos;
    const target = this.targetOf(targetId);
    const path = from && target ? findPath(this.nav, from, target) : [];
    return this.note({ kind: 'chase', targetId, path }, now);
  }

  stop(now: number): number {
    return this.note({ kind: 'stop' }, now);
  }

  // A cast: `windup` when it will plant the caster, null when it changes
  // nothing of the walk (it still carries a number, so the answer tells
  // when orders land).
  cast(windup: number | null, now: number): number {
    return this.note(
      windup !== null && windup > 0 ? { kind: 'windup', seconds: windup } : null,
      now,
    );
  }

  private note(effect: WalkEffect | null, now: number): number {
    this.seq += 1;
    this.pending.push({ seq: this.seq, sentAt: now, effect });
    if (this.pending.length > PENDING_MAX) this.pending.shift();
    return this.seq;
  }

  // A snapshot arrived. The drawn champion does not jump with it: what
  // the new state moves of the walk is taken into the ease and worked
  // out over the next frames.
  observe(state: SelfState, now: number): void {
    const before = this.drawing ? this.raw(now) : null;
    if (state.ack > this.lastAck) {
      const answered = this.pending.find((p) => p.seq === state.ack);
      if (answered) {
        const sample = state.ackAt * 1000 - answered.sentAt;
        this.landMs =
          this.landMs === null ? sample : this.landMs + (sample - this.landMs) * LAND_BLEND;
      }
      this.lastAck = state.ack;
    } else if (state.ack < this.lastAck) {
      // The seat's record started over (a seat taken back): what the old
      // record never answered will not be answered now.
      this.pending = [];
      this.lastAck = state.ack;
    }
    this.pending = this.pending.filter((p) => p.seq > state.ack);
    this.state = state;
    // The snapshot left the server half a trip ago and an order sent now
    // arrives half a trip on.
    this.guessMs = state.time * 1000 - now + RTT_GUESS_MS;
    const after = this.raw(now);
    if (before && after) {
      this.ease = {
        x: this.ease.x + before.pos.x - after.pos.x,
        z: this.ease.z + before.pos.z - after.pos.z,
      };
      if (hypot(this.ease.x, this.ease.z) > SNAP_M) this.ease = { x: 0, z: 0 };
    }
  }

  // Where to draw the champion at `now`, or null to draw the server's own
  // position.
  drawnAt(now: number): DrawnSelf | null {
    const raw = this.raw(now);
    const state = this.state;
    if (!raw || !state) {
      this.drawing = false;
      this.ease = { x: 0, z: 0 };
      return null;
    }
    if (!this.drawing) {
      // Taking over from the server's position (the first snapshot, a
      // respawn, a dash landed): start where it stands and ease ahead.
      this.drawing = true;
      this.easedAt = now;
      this.ease = { x: state.pos.x - raw.pos.x, z: state.pos.z - raw.pos.z };
      if (hypot(this.ease.x, this.ease.z) > SNAP_M) this.ease = { x: 0, z: 0 };
    }
    const k = Math.exp(-Math.max(0, now - this.easedAt) / EASE_MS);
    this.easedAt = now;
    this.ease = { x: this.ease.x * k, z: this.ease.z * k };
    return { x: raw.pos.x + this.ease.x, z: raw.pos.z + this.ease.z, heading: raw.heading };
  }

  // The newest state walked forward to when an order sent now lands, the
  // orders still unanswered applied as each lands.
  private raw(now: number): { pos: Vec2; heading: Vec2 | null } | null {
    const s = this.state;
    if (!s || s.off) return null;
    const horizon = Math.min(Math.max(this.landsAt(now), s.time), s.time + LEAD_MAX_S);
    const w: Walker = {
      pos: copy(s.pos),
      path: s.path.map(copy),
      chaseId: s.chaseId,
      stillUntil: s.stillUntil,
      heading: null,
    };
    let t = s.time;
    for (const p of this.pending) {
      const at = Math.max(t, (p.sentAt + (this.landMs ?? this.guessMs)) / 1000);
      if (at > horizon) break;
      this.walk(w, s, t, at);
      t = at;
      applyEffect(w, p.effect, at);
    }
    this.walk(w, s, t, horizon);
    return { pos: w.pos, heading: w.heading };
  }

  // The sim's walk from `from` to `to`, tick-sized steps: nothing while
  // held in place, into range of the attacked unit and no further, along
  // the path otherwise, stopped where a step would cross what cannot be
  // walked (the sim's strict navigation).
  private walk(w: Walker, s: SelfState, from: number, to: number): void {
    let t = from;
    while (to - t > 1e-9) {
      if (t < w.stillUntil) {
        t = Math.min(to, w.stillUntil);
        w.heading = null;
        continue;
      }
      const dt = Math.min(DT, to - t);
      if (w.chaseId !== null) {
        const target = this.targetOf(w.chaseId);
        if (!target) {
          w.chaseId = null;
          w.path = [];
        } else {
          const edge = hypot(target.x - w.pos.x, target.z - w.pos.z) - s.radius - target.radius;
          if (edge <= s.range) {
            // In range: it stands and strikes.
            w.path = [];
            w.heading = null;
            return;
          }
          if (this.nav.lineOfWalk(w.pos, target)) w.path = [{ x: target.x, z: target.z }];
        }
      }
      if (w.path.length === 0) {
        w.heading = null;
        return;
      }
      const before = copy(w.pos);
      stepMovement(w, dt, s.speed);
      if (!this.nav.lineOfWalk(before, w.pos)) {
        w.pos = before;
        w.path = [];
      }
      const hx = w.pos.x - before.x;
      const hz = w.pos.z - before.z;
      w.heading = hx !== 0 || hz !== 0 ? { x: hx, z: hz } : null;
      t += dt;
    }
  }
}

function applyEffect(w: Walker, effect: WalkEffect | null, at: number): void {
  if (!effect) return;
  switch (effect.kind) {
    case 'walk':
      w.path = effect.path.map(copy);
      w.chaseId = null;
      return;
    case 'chase':
      w.path = effect.path.map(copy);
      w.chaseId = effect.targetId;
      return;
    case 'stop':
      w.path = [];
      w.chaseId = null;
      return;
    case 'windup':
      w.path = [];
      w.stillUntil = Math.max(w.stillUntil, at + effect.seconds);
      return;
  }
}

// The path a snapshot carries as x, z pairs, back into points.
export function pathOfPairs(pairs: readonly number[] | undefined): Vec2[] {
  const out: Vec2[] = [];
  if (!pairs) return out;
  for (let i = 0; i + 1 < pairs.length; i += 2) out.push({ x: pairs[i]!, z: pairs[i + 1]! });
  return out;
}
