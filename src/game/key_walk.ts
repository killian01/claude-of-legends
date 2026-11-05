// Walking with the arrow keys, for a player whose hands stay on the
// keyboard. W A S D are spells, the attack-move, the stop and a sigil here,
// so the arrows are the keys that walk: held, they keep the champion going
// the way they point on screen, up being up whatever the camera shows. The
// walk is the click's own move order, toward the ground a little ahead of
// the champion on screen, given again every KEY_WALK_REPEAT_S while held so
// it keeps leading; letting every arrow go stops. Pure: the keys as the
// browser names them, wall seconds, and screen points.

export interface ScreenDir {
  x: number;
  y: number;
}

// Screen directions, y down as the page's.
const ARROW_DIRS: Readonly<Record<string, ScreenDir>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

// Seconds between two move orders while an arrow stays held.
export const KEY_WALK_REPEAT_S = 0.25;
// How far ahead of the champion on screen the walk aims, in CSS pixels:
// beyond what a quarter second covers, so the walk never stalls between
// two orders.
export const KEY_WALK_LEAD_PX = 140;

export function isWalkKey(key: string): boolean {
  return key in ARROW_DIRS;
}

export type KeyWalkStep = { kind: 'walk'; dir: ScreenDir } | { kind: 'stop' } | null;

export class KeyWalk {
  private held = new Set<string>();
  private lastAt = Number.NEGATIVE_INFINITY;
  private lastDir: ScreenDir | null = null;
  private walking = false;

  press(key: string): void {
    if (isWalkKey(key)) this.held.add(key);
  }

  release(key: string): void {
    this.held.delete(key);
  }

  // The window lost the keyboard: no keyup will come for what was held.
  releaseAll(): void {
    this.held.clear();
  }

  // Where the held arrows point together, one unit long; null when none
  // are held or they cancel out.
  dir(): ScreenDir | null {
    let x = 0;
    let y = 0;
    for (const k of this.held) {
      const d = ARROW_DIRS[k];
      if (!d) continue;
      x += d.x;
      y += d.y;
    }
    if (x === 0 && y === 0) return null;
    const n = x !== 0 && y !== 0 ? Math.SQRT1_2 : 1;
    return { x: x * n, y: y * n };
  }

  // What to order at `now` (seconds), called every frame: a walk the
  // moment the arrows change and again every KEY_WALK_REPEAT_S, one stop
  // once they are all let go, else nothing.
  step(now: number): KeyWalkStep {
    const dir = this.dir();
    if (!dir) {
      this.lastDir = null;
      if (!this.walking) return null;
      this.walking = false;
      return { kind: 'stop' };
    }
    const turned = !this.lastDir || this.lastDir.x !== dir.x || this.lastDir.y !== dir.y;
    if (!turned && now - this.lastAt < KEY_WALK_REPEAT_S) return null;
    this.lastAt = now;
    this.lastDir = dir;
    this.walking = true;
    return { kind: 'walk', dir };
  }
}

// The screen point the walk aims at, from where the champion stands.
export function keyWalkAim(feet: ScreenDir, dir: ScreenDir): ScreenDir {
  return { x: feet.x + dir.x * KEY_WALK_LEAD_PX, y: feet.y + dir.y * KEY_WALK_LEAD_PX };
}
