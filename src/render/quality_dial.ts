// The quality ladder (src/game/quality_ladder.ts) at work on a renderer:
// what the context is made with (the lean level, quality_memory.ts), the
// rung each drawn frame asks for applied to the canvas and the scene, what
// the match leaves for the next one kept in the browser's memory, and the
// seat report told how finely the match is drawn
// (src/game/drawn_quality.ts).
//
// A rung changes two things, neither of which relinks a program or stalls
// a frame: the canvas's pixel ratio (the drawing buffer reallocated once,
// the effects' particles rescaled with it so they keep their size on the
// screen), and whether the ground receives the sun's shadows. Three hands
// receiveShadow to its programs as a uniform and skips the shadow map's
// taps when it is false; with no object receiving them the shadow pass
// has nobody to draw for and is stopped too. Leaving the sun's castShadow
// off instead would buy a little more and relink every lit program, a
// second's stall on a weak GPU.

import type * as THREE from 'three';
import { reportQuality } from '../game/drawn_quality';
import { screenRefresh } from '../game/frame_rate';
import type { LadderPin } from '../game/map_quality';
import { QualityLadder } from '../game/quality_ladder';
import {
  afterMatch,
  type LadderMode,
  LEAN_LEVELS,
  LEANEST,
  type Lean,
  type ModeMemory,
  type QualityMemory,
  readQualityMemory,
  writeQualityMemory,
} from '../game/quality_memory';
import type { DrawnQualityWire } from '../net/protocol';

// One rung: the canvas's pixels per CSS pixel, and the ground's shadows.
export interface Rung {
  ratio: number;
  shadows: boolean;
}

// The ratios below the device's own, a step at least this much finer than
// the last (1.3 to 1.25 buys nothing), and the floors: a desktop's soft
// but readable, a phone's small screen's 1.
export const RATIO_STEPS: readonly number[] = [2, 1.75, 1.5, 1.25, 1, 0.85, 0.75];
const STEP_MIN = 0.92;
export const DESK_RATIO_FLOOR = 0.75;
export const PHONE_RATIO_FLOOR = 1;

// The rungs from `top` down to `floor`, and the floor without shadows.
export function ladderRungs(top: number, floor: number): Rung[] {
  const rungs: Rung[] = [{ ratio: top, shadows: true }];
  for (const ratio of RATIO_STEPS) {
    if (ratio < floor) break;
    if (ratio <= rungs[rungs.length - 1]!.ratio * STEP_MIN) rungs.push({ ratio, shadows: true });
  }
  rungs.push({ ratio: rungs[rungs.length - 1]!.ratio, shadows: false });
  return rungs;
}

// A match's first seconds are not judged: the terrain uploads, programs
// link, the camera settles.
export const SETTLE_MS = 10_000;
// After a hidden tab comes back, or the planet's drop ends.
export const RESUME_SETTLE_MS = 4000;
// While the shadows are off, objects added since are swept this often.
const SWEEP_FRAMES = 60;
// The memory is written this often and when the match ends, so a closed
// tab loses little of what its match learned.
const SAVE_EVERY_MS = 30_000;

// The objects that stopped receiving shadows, to give them back.
const RECEIVED = 'qualityReceived';

// The scene's receivers stop (false) or start again (true) receiving the
// sun's shadows; answers how many changed.
export function receiveShadows(scene: THREE.Object3D, on: boolean): number {
  let changed = 0;
  scene.traverse((o) => {
    if (on) {
      if (o.userData[RECEIVED] !== true) return;
      delete o.userData[RECEIVED];
      o.receiveShadow = true;
      changed++;
    } else if (o.receiveShadow) {
      o.receiveShadow = false;
      o.userData[RECEIVED] = true;
      changed++;
    }
  });
  return changed;
}

export interface DialSetup {
  mode: LadderMode;
  // The device's own ratio (map_quality.ts renderQualityFor).
  top: number;
  phone: boolean;
  // The address's ?quality=, if any.
  pin: LadderPin | null;
  now: number;
}

// What the dial changes on the renderer, handed over once the scene is
// built.
export interface DialHost {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  // The canvas's ratio changed: the particles follow.
  onRatio(ratio: number): void;
}

export class QualityDial {
  readonly rungs: readonly Rung[];
  readonly top: number;
  readonly leanLevel: number;
  private readonly start: ModeMemory;
  // Read by the tests that play matches through the dial.
  readonly ladder: QualityLadder;
  // The rung ?quality= holds the match on; null when the ladder steps it.
  private readonly pinned: number | null;
  private readonly mode: LadderMode;
  private readonly atStart: QualityMemory;
  private host: DialHost | null = null;
  private applied = -1;
  private shadowsOff = false;
  private sinceSweep = 0;
  private savedAt = Number.NEGATIVE_INFINITY;
  private readonly source = (): DrawnQualityWire => this.wire();

  constructor(setup: DialSetup) {
    this.mode = setup.mode;
    this.top = setup.top;
    this.rungs = ladderRungs(setup.top, setup.phone ? PHONE_RATIO_FLOOR : DESK_RATIO_FLOOR);
    this.pinned = setup.pin === null ? null : setup.pin === 'low' ? this.rungs.length - 1 : 0;
    this.atStart = readQualityMemory();
    this.start =
      setup.pin === null
        ? (this.atStart.modes[this.mode] ?? { lean: 0, played: 0 })
        : { lean: setup.pin === 'low' ? LEANEST : 0, played: 0 };
    this.leanLevel = this.start.lean;
    // This page's own frames tell this screen best: a browser that holds
    // every page at 30 (a battery saver) shows it there.
    this.ladder = new QualityLadder(
      this.rungs.length,
      screenRefresh() ?? this.atStart.hz,
      setup.now + SETTLE_MS,
    );
  }

  // What the context is made with.
  get lean(): Lean {
    return LEAN_LEVELS[this.leanLevel]!;
  }

  // The rung drawn on.
  get index(): number {
    return this.pinned ?? this.ladder.index;
  }

  get rung(): Rung {
    return this.rungs[this.index]!;
  }

  // The scene is built: the starting rung applied to it, and the seat
  // report pointed here.
  attach(host: DialHost): void {
    this.host = host;
    this.apply();
    reportQuality(this.source);
  }

  // A frame drawn at `at` (requestAnimationFrame's time), its script
  // having taken `scriptMs`.
  frame(at: number, scriptMs: number): void {
    if (!this.host) return;
    if (this.pinned === null) {
      if (this.ladder.frame(at, scriptMs) !== this.applied) this.apply();
      if (at - this.savedAt >= SAVE_EVERY_MS) this.save(at);
    }
    if (this.shadowsOff && ++this.sinceSweep >= SWEEP_FRAMES) {
      this.sinceSweep = 0;
      receiveShadows(this.host.scene, false);
    }
  }

  // A frame not drawn (a hold, a lost picture, the planet's drop).
  gap(): void {
    this.ladder.gap();
  }

  // The view changed under the ladder: nothing judged for a few seconds.
  pause(now: number): void {
    this.ladder.pause(now + RESUME_SETTLE_MS);
  }

  dispose(): void {
    if (this.pinned === null && this.host) this.save(this.savedAt);
    reportQuality(null, this.source);
    this.host = null;
  }

  private apply(): void {
    const host = this.host;
    if (!host) return;
    const index = this.index;
    if (index === this.applied) return;
    this.applied = index;
    const rung = this.rungs[index]!;
    if (host.gl.getPixelRatio() !== rung.ratio) {
      host.gl.setPixelRatio(rung.ratio);
      host.onRatio(rung.ratio);
    }
    const off = !rung.shadows;
    if (off !== this.shadowsOff) {
      this.shadowsOff = off;
      this.sinceSweep = 0;
      receiveShadows(host.scene, !off);
      host.gl.shadowMap.autoUpdate = !off;
      host.gl.shadowMap.needsUpdate = !off;
    }
  }

  private save(at: number): void {
    this.savedAt = at;
    // The screen's refresh as the page's frames have read it, the menus'
    // light ones among them, or as the match's mixed ones did; never the
    // match's cadence alone, which a slower screen would show as well.
    const seen = Math.max(screenRefresh() ?? 0, this.ladder.refreshRead ?? 0);
    const memory: QualityMemory = {
      hz: seen > 0 ? seen : this.atStart.hz,
      modes: {
        ...this.atStart.modes,
        [this.mode]: afterMatch({
          start: this.start,
          judgedMs: this.ladder.judgedMs,
          topMs: this.ladder.topMs,
          topShare: this.ladder.topShare,
        }),
      },
    };
    writeQualityMemory(memory);
  }

  private wire(): DrawnQualityWire {
    const canvas = this.host?.gl.domElement;
    return {
      step: this.index,
      lean: this.leanLevel,
      ratio: this.rung.ratio,
      w: canvas?.width ?? 0,
      h: canvas?.height ?? 0,
      shadows: this.rung.shadows,
    };
  }
}
