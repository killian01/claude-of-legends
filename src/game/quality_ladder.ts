// How finely a match is drawn on this device, stepped down while the
// frames come too slowly and back up once they come with room to spare.
// Laptops with a weak integrated GPU drew a whole match at 20 to 28 frames
// a second (the seat reports, 2026-10-05): every desktop drew the same
// fixed quality, its screen's pixel ratio with antialiasing and shadows,
// and nothing gave way. Measured on a GPU that rasterizes on the CPU, the
// draw is fill bound and the knobs, by what they buy for what they cost
// the eye, come in this order: fewer pixels (a ratio of 1 instead of 1.25
// draws in 0.70 of the time, 0.75 in about half), then the sun's shadows
// left out of the ground's shading (0.87 on the planet, about 0.9 on the
// Star Orchard, and no relink when it is the objects that stop receiving
// them). Those two change mid-match without a hitch, so they are the
// ladder's rungs; what can only change with a new context (the
// antialiasing, the effects' lights) waits for the next match
// (quality_memory.ts). A step from 1.3 to 1.25 would buy too little to
// take; the floor, 0.75 on a desktop, is soft but reads.
//
// A step down is a trial: kept only when the frame rate rose with it,
// going a rung further while it did not and every frame still took the
// same two or three refreshes (a screen that waits for its refresh shows
// nothing until a frame fits under one refresh fewer), otherwise undone
// and not tried again for a while, so a page held back by its scripts
// rather than its pixels is left as it was. A step back up
// comes after a spell with room to spare, or minutes on end with no
// window short (a page that holds its rung at 0.9 of the screen's rate
// is not left there), and is a trial too: undone at its first short
// window, kept after half a minute without one. One undone, or one kept
// and given up soon after, holds the next back longer each time: the
// ladder settles rather than swings. The screen's rate is never
// assumed: a browser hands requestAnimationFrame the time of the screen's
// refresh, so every interval is a whole number of refreshes and their
// common divisor is the refresh, however slow the frames; the best rate
// seen counts too. Frames that all take two refreshes on a 60 Hz screen
// read as a 30 Hz screen's would, so the rate the page read off its
// lighter frames (frame_rate.ts), or remembered, stands when the read is a
// whole fraction of it. Nothing faster than 60 frames a second is chased.
//
// Pure: the renderer feeds it each drawn frame's time and applies the rung
// it answers (src/render/renderer.ts).

// One rung: the canvas's pixels per CSS pixel, and whether the ground
// shows the sun's shadows.
export interface Rung {
  ratio: number;
  shadows: boolean;
}

// The ratios a ladder steps through below the device's own, best first.
export const RATIO_STEPS: readonly number[] = [2, 1.75, 1.5, 1.25, 1, 0.85, 0.75];
// A step draws at least this much finer than the one above it, or it is
// skipped: a step from 1.3 to 1.25 would buy nothing.
const STEP_MIN = 0.92;
// The lowest ratios: a desktop's 0.75 is soft but reads; a phone's screen
// is small enough that 1 is as low as it goes.
export const DESK_RATIO_FLOOR = 0.75;
export const PHONE_RATIO_FLOOR = 1;

// The rungs from the device's own ratio (`top`) down to `floor`, and a
// last one at the floor without shadows.
export function ladderRungs(top: number, floor: number): Rung[] {
  const rungs: Rung[] = [{ ratio: top, shadows: true }];
  for (const ratio of RATIO_STEPS) {
    if (ratio < floor) break;
    if (ratio <= rungs[rungs.length - 1]!.ratio * STEP_MIN) rungs.push({ ratio, shadows: true });
  }
  rungs.push({ ratio: rungs[rungs.length - 1]!.ratio, shadows: false });
  return rungs;
}

export interface LadderRules {
  // The fastest rate worth giving pixels for, whatever the screen does.
  capHz: number;
  // A window under this share of the target rate is short; one at or over
  // `roomShare` has room to spare.
  shortShare: number;
  roomShare: number;
  // A window closes after this much drawing and this many frames.
  windowMs: number;
  windowFrames: number;
  // Short windows in a row before a step down; windows with room in a row
  // before a step up, or windows in a row none of them short (a page that
  // holds its rung short of room for minutes on end).
  sustainWindows: number;
  recoverWindows: number;
  calmWindows: number;
  // A step down is judged on the median of this many windows, after one
  // left for the change itself; kept when the rate rose by `gain`, tried
  // a rung further while it did not and every frame still took the same
  // two or three refreshes.
  trialWindows: number;
  gain: number;
  // An undone step down is not tried again for this long, twice as long
  // after each further one.
  downHoldMs: number;
  // No step up this soon after a step down was kept. A step up is a trial
  // too: after the window left for the change, undone at its first short
  // window, kept after `upTrialWindows` none of them short. One undone, or
  // a step down kept within `swingMs` of one kept, is a bounce: the next
  // step up is held back for `upHoldMs`, twice as long after each further
  // bounce.
  upAfterDownMs: number;
  upTrialWindows: number;
  upHoldMs: number;
  swingMs: number;
  // Frames whose own script takes this share of their interval are held
  // back by the script, which fewer pixels do not help.
  scriptShare: number;
}

export const LADDER_RULES: LadderRules = {
  capHz: 60,
  shortShare: 0.85,
  roomShare: 0.95,
  windowMs: 1000,
  windowFrames: 6,
  sustainWindows: 3,
  recoverWindows: 20,
  calmWindows: 180,
  trialWindows: 3,
  gain: 1.1,
  downHoldMs: 180_000,
  upAfterDownMs: 60_000,
  upTrialWindows: 30,
  upHoldMs: 300_000,
  swingMs: 120_000,
  scriptShare: 0.75,
};

// An interval this many times the usual one is a stall, a hidden tab or a
// frame the renderer skipped, not the frame rate, and never under this;
// unless this many come in a row: then the frames are that slow now.
const STALL_FACTOR = 4;
const STALL_MIN_MS = 250;
const STALLS_IN_A_ROW = 3;
// A window's longest interval, when it is this many times the window's
// median, is a hitch (a program linking, a collection) and left out of its
// rate: one slow frame is not a slow second. Frames a refresh or two late
// are well under it, and only the one is left out.
const HITCH_FACTOR = 4;
// A divisor of the intervals is searched down to a refresh this short.
const FASTEST_REFRESH_MS = 1000 / 250;
const MAX_DIVISOR = 8;
// How far a browser's clock may round a frame's time (one that hands over
// whole milliseconds, and its jitter).
const ROUNDING_MS = 1.5;
// Frames under this share of the refresh read off their intervals took
// more refreshes some times than others: the read is the refresh itself.
const CLEAR_SHARE = 0.95;

// Whether `ratio` is a whole number, one or more, give or take a tenth.
function wholeTimes(ratio: number): boolean {
  return ratio >= 0.9 && Math.abs(ratio - Math.round(ratio)) <= 0.1;
}

// The screen's refresh in Hz read off frame intervals, each a whole
// number of refreshes give or take a tenth of one, nine in ten of them
// at least; null when no divisor fits. The shortest intervals are
// averaged before the search and the refresh is the time they span over
// the refreshes they count, so a clock that rounds to the millisecond
// (16 and 17 for 60 Hz) reads true.
export function refreshHz(intervals: readonly number[]): number | null {
  if (intervals.length < 4) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const from = sorted[Math.floor(sorted.length * 0.05)]!;
  const low = sorted.filter((x) => x >= from && x <= from + ROUNDING_MS);
  const shortest = low.reduce((a, b) => a + b, 0) / low.length;
  for (let k = 1; k <= MAX_DIVISOR; k++) {
    const p = shortest / k;
    if (p < FASTEST_REFRESH_MS) break;
    let fit = 0;
    let spanned = 0;
    let refreshes = 0;
    for (const x of intervals) {
      if (!wholeTimes(x / p)) continue;
      fit++;
      spanned += x;
      refreshes += Math.round(x / p);
    }
    if (fit >= intervals.length * 0.9) return (1000 * refreshes) / spanned;
  }
  return null;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// Frames a second over a window's intervals, its hitch left out.
function windowRate(intervals: readonly number[]): number {
  const sum = intervals.reduce((a, b) => a + b, 0);
  const longest = Math.max(...intervals);
  const hitch = longest > HITCH_FACTOR * median(intervals) ? longest : 0;
  return (1000 * (intervals.length - (hitch > 0 ? 1 : 0))) / (sum - hitch);
}

export interface LadderStart {
  // The rung to start on.
  index: number;
  // The screen's rate known before the match: read off the page's own
  // frames, its menus' light ones among them (frame_rate.ts), else
  // remembered from an earlier match; null for none.
  known: number | null;
  // Until when nothing is judged: a match's first seconds load and link.
  settleUntil: number;
}

export class QualityLadder {
  private current: number;
  private lastAt: number | null = null;
  // The usual interval, for telling a stall, and the stalls in a row.
  private usual: number | null = null;
  private stalls = 0;
  private sum = 0;
  private frames = 0;
  private scripts: number[] = [];
  private intervals: number[] = [];
  private settleUntil: number;
  private bestHz = 0;
  private refresh: number | null = null;
  private read: number | null = null;
  private readonly known: number | null;
  private shortRun: number[] = [];
  private roomRun = 0;
  private calmRun = 0;
  private trial: { from: number; before: number; seen: number; rates: number[] } | null = null;
  private upTrial: { from: number; seen: number } | null = null;
  private downHeldUntil = Number.NEGATIVE_INFINITY;
  private downFails = 0;
  private upHeldUntil = Number.NEGATIVE_INFINITY;
  private bounces = 0;
  private downAt = Number.NEGATIVE_INFINITY;
  private upKeptAt = Number.NEGATIVE_INFINITY;
  // The deepest rung a step down kept this match (null for none), how
  // long the match was judged, and how much of that below the top.
  private deepestKept: number | null = null;
  private judged = 0;
  private below = 0;

  constructor(
    private readonly rungs: readonly Rung[],
    start: LadderStart,
    private readonly rules: LadderRules = LADDER_RULES,
  ) {
    this.current = Math.max(0, Math.min(rungs.length - 1, start.index));
    this.known = start.known !== null && start.known > 0 ? start.known : null;
    this.settleUntil = start.settleUntil;
  }

  get index(): number {
    return this.current;
  }

  get rung(): Rung {
    return this.rungs[this.current]!;
  }

  // The rung the ladder stands on outside a trial: what is worth
  // remembering for the next match.
  get settled(): number {
    return (this.trial ?? this.upTrial)?.from ?? this.current;
  }

  get deepest(): number | null {
    return this.deepestKept;
  }

  // Milliseconds of drawing judged so far (past the settling), and those
  // settled below the top.
  get judgedMs(): number {
    return this.judged;
  }

  get belowMs(): number {
    return this.below;
  }

  // The screen's rate as best known: the refresh read off the intervals
  // (else the one known), or the best rate seen when it is higher.
  get screenHz(): number | null {
    const hz = Math.max(this.bestHz, this.refresh ?? this.known ?? 0);
    return hz > 0 ? hz : null;
  }

  // The refresh read off windows whose frames came slower than it, some
  // taking more refreshes than others: the screen's own, worth keeping.
  // Null while every window's frames took the same refreshes each, which
  // a screen as fast as the frames would show as well.
  get refreshRead(): number | null {
    return this.read;
  }

  // A frame drawn at `at` (the refresh's time requestAnimationFrame
  // handed over), its own script having taken `scriptMs`; answers the
  // rung to draw the next one on.
  frame(at: number, scriptMs?: number): number {
    const last = this.lastAt;
    this.lastAt = at;
    if (last === null) return this.current;
    const dt = at - last;
    if (!(dt > 0)) return this.current;
    if (this.usual !== null && dt > Math.max(STALL_MIN_MS, STALL_FACTOR * this.usual)) {
      if (++this.stalls < STALLS_IN_A_ROW) return this.current;
      this.usual = null;
    }
    this.stalls = 0;
    this.usual = this.usual === null ? Math.min(dt, 1000) : this.usual * 0.9 + dt * 0.1;
    this.sum += dt;
    this.frames++;
    this.intervals.push(dt);
    if (scriptMs !== undefined && scriptMs >= 0) this.scripts.push(scriptMs / dt);
    if (this.sum < this.rules.windowMs || this.frames < this.rules.windowFrames) {
      return this.current;
    }
    const fps = windowRate(this.intervals);
    const script = this.scripts.length > 0 ? median(this.scripts) : 0;
    const hz = refreshHz(this.intervals);
    const spent = this.sum;
    this.sum = 0;
    this.frames = 0;
    this.scripts = [];
    this.intervals = [];
    if (hz !== null) this.heard(hz, fps);
    this.bestHz = Math.max(this.bestHz, fps);
    if (at < this.settleUntil) return this.current;
    this.judged += spent;
    if (this.settled > 0) this.below += spent;
    this.judge(fps, script, at);
    return this.current;
  }

  // A window's frames came at `fps`, their intervals whole numbers of a
  // refresh at `hz`. Frames that all take two refreshes on a 60 Hz screen
  // read 30, as a 30 Hz screen's would: the rate known before the match
  // stands when the read is a whole fraction of it; when it is not (60 on
  // a 50 Hz panel), the known one was another screen's.
  private heard(hz: number, fps: number): void {
    if (fps < CLEAR_SHARE * hz) this.read = Math.max(this.read ?? 0, hz);
    const known = this.known;
    const rate = known !== null && known > hz && wholeTimes(known / hz) ? known : hz;
    this.refresh = Math.max(this.refresh ?? 0, rate);
  }

  // A frame the renderer did not draw: the next interval does not count.
  gap(): void {
    this.lastAt = null;
  }

  // The view changed under the ladder (a hidden tab back, the planet's
  // drop over): the window so far and the usual interval are dropped and
  // nothing is judged until `until`, a trial in progress starting its
  // count again.
  pause(until: number): void {
    this.lastAt = null;
    this.usual = null;
    this.stalls = 0;
    this.sum = 0;
    this.frames = 0;
    this.scripts = [];
    this.intervals = [];
    this.runsOver();
    this.settleUntil = Math.max(this.settleUntil, until);
    if (this.trial) {
      this.trial.seen = 0;
      this.trial.rates = [];
    }
    if (this.upTrial) this.upTrial.seen = 0;
  }

  private runsOver(): void {
    this.shortRun = [];
    this.roomRun = 0;
    this.calmRun = 0;
  }

  // A step up that did not hold: the next one waits longer.
  private bounce(at: number): void {
    this.upHeldUntil = at + this.rules.upHoldMs * 2 ** this.bounces;
    this.bounces++;
  }

  private judge(fps: number, script: number, at: number): void {
    const r = this.rules;
    const target = Math.min(r.capHz, this.screenHz ?? r.capHz);
    if (this.trial) {
      const trial = this.trial;
      trial.seen++;
      // The first window after a step carries the change itself.
      if (trial.seen === 1) return;
      trial.rates.push(fps);
      if (trial.rates.length < r.trialWindows) return;
      const after = median(trial.rates);
      // No gain, every frame still taking the same two or three refreshes
      // of the rate aimed for: a screen that waits for its refresh shows
      // nothing until a frame fits under one refresh fewer, so the next
      // rung down is tried against the same rate, as far as the last.
      // Slower frames cross a refresh with any rung's gain.
      const refreshes = target / after;
      const waiting = refreshes >= 1.5 && refreshes < 3.5 && wholeTimes(refreshes);
      if (after < trial.before * r.gain && waiting && this.current < this.rungs.length - 1) {
        this.current++;
        trial.seen = 0;
        trial.rates = [];
        return;
      }
      this.trial = null;
      this.runsOver();
      if (after >= trial.before * r.gain) {
        // Back down soon after a step up was kept: the ladder swung.
        if (at - this.upKeptAt < r.swingMs) this.bounce(at);
        this.downFails = 0;
        this.downAt = at;
        this.deepestKept = Math.max(this.deepestKept ?? 0, this.current);
        // Still short on the new rung: its windows count toward the next.
        if (trial.rates.every((x) => x < r.shortShare * target)) this.shortRun = trial.rates;
        return;
      }
      // The pixels were not what held it back: undone, left alone.
      this.current = trial.from;
      this.downHeldUntil = at + r.downHoldMs * 2 ** this.downFails;
      this.downFails++;
      return;
    }
    const short = fps < r.shortShare * target;
    if (this.upTrial) {
      const up = this.upTrial;
      up.seen++;
      if (up.seen === 1) return;
      if (short) {
        // Short again: back down where it stood, and up later.
        this.current = up.from;
        this.bounce(at);
      } else if (up.seen <= r.upTrialWindows) {
        return;
      } else {
        this.upKeptAt = at;
      }
      this.upTrial = null;
      this.runsOver();
      return;
    }
    this.shortRun = short ? [...this.shortRun, fps] : [];
    this.roomRun = fps >= r.roomShare * target ? this.roomRun + 1 : 0;
    this.calmRun = short ? 0 : this.calmRun + 1;
    if (this.shortRun.length >= r.sustainWindows) {
      const before = median(this.shortRun);
      this.shortRun = [];
      if (this.current >= this.rungs.length - 1 || at < this.downHeldUntil) return;
      // Held back by its own script: fewer pixels would not help.
      if (script >= r.scriptShare) return;
      this.trial = { from: this.current, before, seen: 0, rates: [] };
      this.current++;
      this.runsOver();
      return;
    }
    if (
      (this.roomRun >= r.recoverWindows || this.calmRun >= r.calmWindows) &&
      this.current > 0 &&
      at >= this.upHeldUntil &&
      at - this.downAt >= r.upAfterDownMs
    ) {
      this.upTrial = { from: this.current, seen: 0 };
      this.current--;
      this.runsOver();
    }
  }
}
