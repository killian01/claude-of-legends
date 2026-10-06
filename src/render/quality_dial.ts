// The quality ladder (src/game/quality_ladder.ts) at work on a renderer:
// what the context is made with (the lean level, quality_memory.ts), the
// rung each drawn frame asks for applied to the canvas and the scene, the
// browser's memory kept for the next match, and the seat report told how
// finely the match is drawn (src/game/drawn_quality.ts).
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
import {
  DESK_RATIO_FLOOR,
  ladderRungs,
  PHONE_RATIO_FLOOR,
  QualityLadder,
  type Rung,
} from '../game/quality_ladder';
import {
  afterMatch,
  type LadderMode,
  LEAN_LEVELS,
  LEANEST,
  type Lean,
  matchStart,
  type QualityMemory,
  readQualityMemory,
  writeQualityMemory,
} from '../game/quality_memory';
import type { DrawnQualityWire } from '../net/protocol';

// A match's first seconds are not judged: the terrain uploads, programs
// link, the camera settles.
export const SETTLE_MS = 10_000;
// After a hidden tab comes back, or the planet's drop ends.
export const RESUME_SETTLE_MS = 4000;
// While the shadows are off, objects added since are swept this often.
const SWEEP_FRAMES = 60;
// The memory is written on every change of rung and at least this often,
// so a closed tab loses little of what its match learned.
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
  private readonly start: number;
  private readonly ladder: QualityLadder;
  private readonly pinned: boolean;
  private readonly mode: LadderMode;
  private readonly atStart: QualityMemory;
  private host: DialHost | null = null;
  private applied = -1;
  private shadowsOff = false;
  private sinceSweep = 0;
  private savedRung = -1;
  private savedAt = Number.NEGATIVE_INFINITY;
  private readonly source = (): DrawnQualityWire => this.wire();

  constructor(setup: DialSetup) {
    this.mode = setup.mode;
    this.top = setup.top;
    this.rungs = ladderRungs(setup.top, setup.phone ? PHONE_RATIO_FLOOR : DESK_RATIO_FLOOR);
    this.pinned = setup.pin !== null;
    this.atStart = this.pinned ? { hz: null, modes: {} } : readQualityMemory();
    const start =
      setup.pin === 'full'
        ? { index: 0, lean: 0 }
        : setup.pin === 'low'
          ? { index: this.rungs.length - 1, lean: LEANEST }
          : matchStart(this.atStart.modes[this.mode], this.rungs);
    this.leanLevel = start.lean;
    this.start = start.index;
    this.ladder = new QualityLadder(this.rungs, {
      index: start.index,
      known: [screenRefresh(), this.atStart.hz].filter((hz) => hz !== null),
      settleUntil: setup.now + SETTLE_MS,
    });
  }

  // What the context is made with.
  get lean(): Lean {
    return LEAN_LEVELS[this.leanLevel]!;
  }

  get rung(): Rung {
    return this.ladder.rung;
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
    if (!this.pinned) {
      const before = this.ladder.index;
      this.ladder.frame(at, scriptMs);
      if (this.ladder.index !== before) this.apply();
      if (this.ladder.settled !== this.savedRung || at - this.savedAt >= SAVE_EVERY_MS) {
        this.save(at);
      }
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
    if (!this.pinned && this.host) this.save(this.savedAt);
    reportQuality(null, this.source);
    this.host = null;
  }

  private apply(): void {
    const host = this.host;
    if (!host) return;
    const index = this.ladder.index;
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
    this.savedRung = this.ladder.settled;
    this.savedAt = at;
    // The screen's refresh as the page's frames have read it, the menus'
    // light ones among them, or as the match's mixed ones did; never the
    // match's cadence alone, which a slower screen would show as well.
    const seen = Math.max(screenRefresh() ?? 0, this.ladder.refreshRead ?? 0);
    const memory: QualityMemory = {
      hz: seen > 0 ? seen : this.atStart.hz,
      modes: {
        ...this.atStart.modes,
        [this.mode]: afterMatch(this.atStart.modes[this.mode], {
          rungs: this.rungs,
          start: this.start,
          settled: this.ladder.settled,
          deepest: this.ladder.deepest,
          judgedMs: this.ladder.judgedMs,
          lean: this.leanLevel,
        }),
      },
    };
    writeQualityMemory(memory);
  }

  private wire(): DrawnQualityWire {
    const canvas = this.host?.gl.domElement;
    return {
      step: this.ladder.index,
      lean: this.leanLevel,
      ratio: this.rungs[this.ladder.index]!.ratio,
      w: canvas?.width ?? 0,
      h: canvas?.height ?? 0,
      shadows: this.rungs[this.ladder.index]!.shadows,
    };
  }
}
