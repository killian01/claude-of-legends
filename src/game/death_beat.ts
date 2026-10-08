// The Death beat in Respawn (CONTEXT.md: Death beat): while the champion
// waits to come back, the camera is on whoever took it down whenever the
// mirror knows where they stand (their body in the world, or the point a
// mark shows on every globe), and holds on where the champion fell
// otherwise; on the return it is the champion's again. Pure: the death,
// the clock and what the mirror knows in; the shot out, which game/boot.ts
// hands the renderer (Renderer.watchUnit, lookAtPoint, recenterCamera)
// through BeatCamera.
//
// A dead champion sees nothing (src/sim/vision.ts), so the killer's body
// leaves the mirror on the snapshot that tells the death: the beat reads
// only what the wire carries anyway, and the fog is the server's as ever.

import type { SnapRoyale } from '../net/royale_wire';
import type { Vec3 } from '../sim/geo';
import { MARK_SHOWN_S } from '../sim/royale/types';
import type { IWorld } from '../world_api';

// How long the camera keeps the killer's last known point once it is lost
// (a mark's show ends, the body steps out of what the mirror holds) before
// it goes back to where the champion fell: a flicker is no cut.
export const BEAT_KEEP_S = 1;

// What the camera does this tick:
// - 'self': it follows the champion (standing, or its body where it fell);
// - 'killer': it follows the killer's body, as the world draws it;
// - 'point': it looks at the killer's last known point (a mark's).
export type BeatShot =
  | { kind: 'self' }
  | { kind: 'killer'; unitId: number }
  | { kind: 'point'; unitId: number; at: Vec3 };

// What the mirror knows of the killer this tick.
export interface BeatSight {
  time: number;
  // The champion is down (its wait).
  dead: boolean;
  // The killer's body in the mirror, standing; null when it is not there.
  body: Vec3 | null;
  // The point a mark of the killer shows on the globe now; null when none.
  shown: Vec3 | null;
}

export function sameShot(a: BeatShot, b: BeatShot): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'self') return true;
  if (b.kind === 'self' || a.unitId !== b.unitId) return false;
  if (a.kind === 'point' && b.kind === 'point') {
    return a.at.x === b.at.x && a.at.y === b.at.y && a.at.z === b.at.z;
  }
  return true;
}

export class DeathBeat {
  // Who took the champion down this wait; null for the Dusk, a creature,
  // a fall of its own, or while it stands.
  private by: number | null = null;
  private lastKnown: { at: Vec3; time: number } | null = null;
  private wasDead = false;

  constructor(readonly selfId: number) {}

  // The killer the beat looks for, while the champion waits.
  get killer(): number | null {
    return this.by;
  }

  // A death of the snapshot: the champion's own names who took it down
  // (a champion's id; 0 or its own id for the Dusk and the world).
  fell(unitId: number, killerId: number, killerIsChampion: boolean): void {
    if (unitId !== this.selfId) return;
    const champion = killerIsChampion && killerId !== 0 && killerId !== unitId;
    this.by = champion ? killerId : null;
    this.lastKnown = null;
  }

  // Once per world tick: the shot. The killer is forgotten on the return,
  // not before: a death's note and the fallen body may come a tick apart.
  step(s: BeatSight): BeatShot {
    const returned = this.wasDead && !s.dead;
    this.wasDead = s.dead;
    if (!s.dead) {
      if (returned) {
        this.by = null;
        this.lastKnown = null;
      }
      return { kind: 'self' };
    }
    const id = this.by;
    if (id === null) return { kind: 'self' };
    if (s.body) {
      this.lastKnown = { at: s.body, time: s.time };
      return { kind: 'killer', unitId: id };
    }
    if (s.shown) {
      this.lastKnown = { at: s.shown, time: s.time };
      return { kind: 'point', unitId: id, at: s.shown };
    }
    const kept = this.lastKnown;
    if (kept && s.time - kept.time <= BEAT_KEEP_S) {
      return { kind: 'point', unitId: id, at: kept.at };
    }
    this.lastKnown = null;
    return { kind: 'self' };
  }
}

// Where the globe shows a champion now, as the mode's block tells it: the
// latest of its marks still in its show (an Ablaze run, the Lodestar, the
// Wrath, a slayer), else the score leader's point while shown; null when
// nothing shows it.
export function shownPoint(
  r: Pick<SnapRoyale, 'mk' | 'leader'> | null,
  unitId: number,
  time: number,
): Vec3 | null {
  let best: { at: Vec3; shownAt: number } | null = null;
  for (const m of r?.mk ?? []) {
    if (m[0] !== unitId) continue;
    const since = time - m[5];
    if (since < -0.5 || since > MARK_SHOWN_S) continue;
    if (!best || m[5] > best.shownAt) best = { at: { x: m[2], y: m[3], z: m[4] }, shownAt: m[5] };
  }
  if (best) return best.at;
  const at = r?.leader?.i === unitId ? r.leader.at : undefined;
  return at ? { x: at[0], y: at[1], z: at[2] } : null;
}

// The camera as the beat moves it (render/renderer.ts).
export interface BeatLens {
  watchUnit(id: number | null): void;
  lookAtPoint(x: number, z: number, y?: number): void;
  recenterCamera(): void;
}

// A death as the world tick tells it (game/boot.ts KillNote).
export interface BeatKill {
  unitId: number;
  killerId: number;
  // The killer's seat name, which only a champion's death carries.
  kn?: string;
}

// The beat on a match's camera: each world tick, the shot the beat
// decides, handed to the lens only when it changes; and at the return,
// the camera back on the champion whatever it was doing (a pan in the
// wait included).
export class BeatCamera {
  private readonly beat: DeathBeat;
  private shot: BeatShot = { kind: 'self' };
  private dead = false;

  constructor(
    private readonly world: Pick<IWorld, 'units' | 'time' | 'royaleView'>,
    private readonly lens: BeatLens,
    selfId: number,
  ) {
    this.beat = new DeathBeat(selfId);
  }

  tick(kills: readonly BeatKill[]): void {
    const world = this.world;
    const beat = this.beat;
    for (const k of kills) {
      const champion = k.kn !== undefined || world.units.get(k.killerId)?.kind === 'champion';
      beat.fell(k.unitId, k.killerId, champion);
    }
    const dead = world.units.get(beat.selfId)?.dead === true;
    const id = beat.killer;
    const body = id !== null ? world.units.get(id) : undefined;
    const shot = beat.step({
      time: world.time,
      dead,
      body: body && !body.dead && body.pos.y !== undefined ? (body.pos as Vec3) : null,
      shown: id !== null ? shownPoint(world.royaleView?.() ?? null, id, world.time) : null,
    });
    const returned = this.dead && !dead;
    this.dead = dead;
    if (sameShot(shot, this.shot) && !returned) return;
    this.shot = shot;
    if (shot.kind === 'killer') {
      this.lens.watchUnit(shot.unitId);
      this.lens.recenterCamera();
    } else if (shot.kind === 'point') {
      this.lens.watchUnit(null);
      this.lens.lookAtPoint(shot.at.x, shot.at.z, shot.at.y);
    } else {
      this.lens.watchUnit(null);
      this.lens.recenterCamera();
    }
  }
}
