// How finely a match is drawn on this device, stepped down while the
// frames come far too slowly and back up once there is room for it.
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
// The ladder is for those machines and leaves every other alone: a page
// drawing three quarters of its target rate or more (45 frames a second
// on a 60 Hz screen) is playable, and a step taken for nothing costs more
// than it buys. A step down is a trial. It begins when the median of the
// last eight one-second windows is under that line, both its middle
// windows (four short and four long are a change of pace, not a pace),
// and is set against a before: those eight windows' median when they were
// measured whatever they showed (the first eight after a settling, a trial
// or a change of pace), else four more windows on the same rung, still
// under the line by their median, since windows that crossed under it
// lean low for having been the ones that did. Two windows are left for
// the change, and the step gains when the slowest but one of the next
// eight draws 1.15 times the before. The rung it left is then drawn again
// for four windows: the step is kept only while that rung is still short,
// reads as it did before within the same 1.15, and the step still gains
// over it, so a fight that ends, or another that begins, during the trial
// is not taken for the step's gain. A step undone holds the next trial
// back a while, twice as long after each, so a page held back by its
// scripts rather than its pixels is left as it was. A trial that gained
// nothing while every frame still took the same two or three refreshes
// goes one rung further, never more: a screen that waits for its refresh
// shows nothing until a frame fits under one refresh fewer.
//
// A step kept is on probation: as soon as its rung holds the line, the
// rung above is drawn again for eight windows, twice at most, and the step
// is given back when that rung is no longer short (its upper middle window
// on the line); until then the step's time counts on the rung it came
// from. Otherwise a step back up comes after three minutes on a rung whose
// last eight windows hold the line, both middle windows, and is kept when
// the eight windows above hold it too; a step up given up within three
// minutes of being kept is a rung hovering about the line, and the ladder
// stays where it is for the rest of the match (a step over a slowdown to
// under half the line is no hover). A match started below the top, where
// the last one left it (quality_memory.ts), first draws the top again for
// eight windows after its settling, and stays there when their median
// holds the line: a machine that got faster, or a step remembered for a
// slowdown, costs the next match a few seconds. One slow frame in a second
// is a hitch, not the second's rate; slow frames one after another are a
// stall until they have lasted three seconds, and then a new pace: the
// window that spans the change is left out, and the four after it are a
// step down's before at once.
//
// The screen's rate is never assumed: a browser hands
// requestAnimationFrame the time of the screen's refresh, so every
// interval is a whole number of refreshes and their common divisor is the
// refresh, however slow the frames; the best rate seen counts too. Frames
// that all take two refreshes on a 60 Hz screen read as a 30 Hz screen's
// would, so the rate the page read off its lighter frames (frame_rate.ts),
// or remembered, stands when the read is a whole fraction of it. Nothing
// faster than 60 frames a second is chased.
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
  // A window, or a median of them, under this share of the target rate
  // is short.
  shortShare: number;
  // A window closes after this much drawing and this many frames.
  windowMs: number;
  windowFrames: number;
  // The windows a median is taken over (under the line when both its
  // middle windows are, on or over it when both are), the fresh ones a
  // step down may be set against and the ones the rung it left is drawn
  // again for, and the windows left for a change before a trial counts
  // its own.
  medianWindows: number;
  freshWindows: number;
  changeWindows: number;
  // A step down is kept when the median rose by this much.
  gain: number;
  // Windows on a rung before a step up, its median holding the line.
  calmWindows: number;
  // An undone step down, or step up, holds the next one of its kind back
  // this long, twice as long after each further one.
  downHoldMs: number;
  upHoldMs: number;
  // A step up given up within this long of being kept is a hover, unless
  // the step down was over a slowdown to under this share of the line.
  hoverMs: number;
  deepShare: number;
  // Frames whose own script takes this share of their interval are held
  // back by the script, which fewer pixels do not help.
  scriptShare: number;
}

export const LADDER_RULES: LadderRules = {
  capHz: 60,
  shortShare: 0.75,
  windowMs: 1000,
  windowFrames: 4,
  medianWindows: 8,
  freshWindows: 4,
  changeWindows: 2,
  gain: 1.15,
  calmWindows: 180,
  downHoldMs: 180_000,
  upHoldMs: 300_000,
  hoverMs: 180_000,
  deepShare: 0.5,
  scriptShare: 0.75,
};

// The judged time a match's start is weighed over: a step down from the
// top within it says the top did not hold from the start, and a match
// judged less long says too little to remember (quality_memory.ts).
export const EVIDENCE_MS = 180_000;

// An interval this many times the usual one is a stall, a hidden tab or a
// frame the renderer skipped, not the frame rate, and never under this;
// unless stalls come one after another for this long, no frame of the
// usual length between them: then the frames are that slow now. Programs
// linking for the spells a fight shows first stall a few frames in a row,
// a second at most.
const STALL_FACTOR = 4;
const STALL_MIN_MS = 250;
const STALL_RUN_MS = 3000;
// A step down kept is on probation this many windows at most while its
// rung does not hold the line, longer than a fight, and the rung above is
// drawn again this many times at most.
const PROBATION_WINDOWS = 30;
const PROBATION_LOOKS = 2;
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

// The middle values of `xs`, the lower and the upper (the same one for an
// odd count), and their mean.
function middle(xs: readonly number[]): { low: number; high: number; median: number } {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const low = s[s.length % 2 === 1 ? mid : mid - 1]!;
  const high = s[mid]!;
  return { low, high, median: (low + high) / 2 };
}

const median = (xs: readonly number[]): number => middle(xs).median;

// The slowest of `xs` but one.
function steady(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(1, s.length - 1)]!;
}

// Frames a second over a window's intervals, its hitch left out.
function windowRate(intervals: readonly number[]): number {
  const sum = intervals.reduce((a, b) => a + b, 0);
  const longest = Math.max(...intervals);
  const hitch = longest > HITCH_FACTOR * median(intervals) ? longest : 0;
  return (1000 * (intervals.length - (hitch > 0 ? 1 : 0))) / (sum - hitch);
}

export interface LadderStart {
  // The rung to start on: below the top, the top is tried first.
  index: number;
  // The screen's rate known before the match: read off the page's own
  // frames, its menus' light ones among them (frame_rate.ts), else
  // remembered from an earlier match; null for none.
  known: number | null;
  // Until when nothing is judged: a match's first seconds load and link.
  settleUntil: number;
}

// A step on trial: down, up, the rung above drawn again for a step on
// probation, or the top tried at the start of a match begun below it;
// from which rung, the median a step down is set against, the windows
// seen since the change and the rates of those after the ones left for
// it, whether a step down that gained nothing went a rung further, the
// judged time and the time it began at, and, for a step down that gained,
// the rung it gained on and that rung's windows while the rung it left is
// drawn again.
interface Trial {
  kind: 'down' | 'up' | 'look' | 'probe';
  from: number;
  before: number;
  seen: number;
  rates: number[];
  walked: boolean;
  judged: number;
  at: number;
  gained: { to: number; rates: number[] } | null;
}

// The start probe: none (started at the top), due at the first judged
// window, on, or over, the top held or not.
type Probe = 'none' | 'due' | 'on' | 'held' | 'failed';

export class QualityLadder {
  private current: number;
  private lastAt: number | null = null;
  // The usual interval, for telling a stall, how long the stalls in a
  // row have lasted, and whether the window in progress spans a run of
  // them taken for the new pace.
  private usual: number | null = null;
  private stalled = 0;
  private paced = false;
  private sum = 0;
  private frames = 0;
  private scripts: number[] = [];
  private intervals: number[] = [];
  private settleUntil: number;
  private bestHz = 0;
  private refresh: number | null = null;
  private read: number | null = null;
  private readonly known: number | null;
  // The last judged windows' rates outside a trial, the fresh ones
  // measured since they crossed under the line (null while none are),
  // and the windows judged on the rung since the ladder came to it.
  private recent: number[] = [];
  private fresh: number[] | null = null;
  private calm = 0;
  // The recent windows were measured since they were last emptied, none
  // of them picked by a crossing yet.
  private unpicked = true;
  // A step down on probation: the rung it came from, the windows and the
  // looks it has left, and whether the top had fallen early before it.
  private probation: { from: number; left: number; looks: number; early: boolean } | null = null;
  private trial: Trial | null = null;
  private downHeldUntil = Number.NEGATIVE_INFINITY;
  private downFails = 0;
  private upHeldUntil = Number.NEGATIVE_INFINITY;
  private upFails = 0;
  // When a step up was last kept; one given up soon after holds the
  // ladder where it is for the rest of the match.
  private upKeptAt = Number.NEGATIVE_INFINITY;
  private upsOver = false;
  private probe: Probe;
  // A step down from the top kept within the first judged minutes.
  private droppedEarly = false;
  // The milliseconds judged on each rung the ladder stood on.
  private readonly spent: number[];

  constructor(
    private readonly rungs: readonly Rung[],
    start: LadderStart,
    private readonly rules: LadderRules = LADDER_RULES,
  ) {
    this.current = Math.max(0, Math.min(rungs.length - 1, start.index));
    this.known = start.known !== null && start.known > 0 ? start.known : null;
    this.settleUntil = start.settleUntil;
    this.spent = rungs.map(() => 0);
    this.probe = this.current > 0 ? 'due' : 'none';
  }

  get index(): number {
    return this.current;
  }

  get rung(): Rung {
    return this.rungs[this.current]!;
  }

  // A step is on trial: the rung drawn is not yet the ladder's.
  get trying(): boolean {
    return this.trial !== null;
  }

  // The rung the ladder stands on outside a trial and a step's probation:
  // what is worth remembering for the next match.
  get settled(): number {
    return this.probation?.from ?? this.trial?.from ?? this.current;
  }

  // Milliseconds of drawing judged on each rung the ladder stood on (past
  // the settling and the start probe, a trial's and a probation's on the
  // rung it was tried from), and in all.
  get spentMs(): readonly number[] {
    return [...this.spent];
  }

  get judgedMs(): number {
    return this.spent.reduce((a, b) => a + b, 0);
  }

  // The top did not hold early in the match: the start probe gave it up,
  // or a step down from it was kept within the first judged minutes.
  get fellEarly(): boolean {
    return this.probe === 'failed' || this.droppedEarly;
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
      this.stalled += dt;
      if (this.stalled < STALL_RUN_MS) return this.current;
      this.usual = null;
      this.paced = true;
    }
    this.stalled = 0;
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
    const paced = this.paced;
    this.sum = 0;
    this.frames = 0;
    this.scripts = [];
    this.intervals = [];
    this.paced = false;
    if (hz !== null) this.heard(hz, fps);
    this.bestHz = Math.max(this.bestHz, fps);
    if (at < this.settleUntil) return this.current;
    if (this.probe === 'due') {
      this.probe = 'on';
      this.begin('probe', 0, at);
      return this.current;
    }
    if (this.probe !== 'on') this.spent[this.settled]! += spent;
    this.judge(fps, script, at, paced);
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
    this.stalled = 0;
    this.paced = false;
    this.sum = 0;
    this.frames = 0;
    this.scripts = [];
    this.intervals = [];
    this.recent = [];
    this.fresh = null;
    this.calm = 0;
    this.unpicked = true;
    this.settleUntil = Math.max(this.settleUntil, until);
    if (this.trial) {
      this.trial.seen = 0;
      this.trial.rates = [];
    }
  }

  private judge(fps: number, script: number, at: number, paced: boolean): void {
    const r = this.rules;
    const target = Math.min(r.capHz, this.screenHz ?? r.capHz);
    const line = r.shortShare * target;
    const trial = this.trial;
    if (trial) {
      // The first windows after a step carry the change itself; one that
      // spans a change of pace is neither pace.
      if (++trial.seen <= r.changeWindows || paced) return;
      trial.rates.push(fps);
      const needed = trial.gained ? r.freshWindows : r.medianWindows;
      if (trial.rates.length >= needed) this.decide(trial, target, at);
      return;
    }
    const down =
      this.current < this.rungs.length - 1 &&
      at >= this.downHeldUntil &&
      // Held back by its own script: fewer pixels would not help.
      script < r.scriptShare;
    if (paced) {
      // Stalls for three seconds on end: the windows before them were
      // another pace, and the next ones are weighed at once.
      this.recent = [];
      this.calm = 0;
      this.unpicked = true;
      this.fresh = down ? [] : null;
      return;
    }
    this.recent.push(fps);
    if (this.recent.length > r.medianWindows) this.recent.shift();
    this.calm++;
    if (this.fresh) {
      this.fresh.push(fps);
      if (this.fresh.length < r.freshWindows) return;
      const before = median(this.fresh);
      this.fresh = null;
      if (before < line && down) this.begin('down', before, at);
      return;
    }
    const up = this.current > 0 && !this.upsOver;
    const probation = this.probation;
    if (probation && --probation.left <= 0) this.probation = null;
    if (
      this.probation &&
      up &&
      this.calm >= r.freshWindows &&
      median(this.recent.slice(-r.freshWindows)) >= line
    ) {
      // The step's rung holds the line: the rung above is drawn again.
      this.begin('look', 0, at);
      return;
    }
    const mid = this.recent.length >= r.medianWindows ? middle(this.recent) : null;
    const unpicked = this.unpicked && mid !== null;
    if (mid !== null) this.unpicked = false;
    if (mid !== null && mid.high < line && down) {
      // Windows measured whatever they showed are a fair before; ones
      // that crossed under the line lean low, and fresh ones are measured.
      if (unpicked) this.begin('down', mid.median, at);
      else this.fresh = [];
    } else if (
      this.calm >= r.calmWindows &&
      mid !== null &&
      mid.low >= line &&
      up &&
      at >= this.upHeldUntil
    ) {
      this.begin('up', 0, at);
    }
  }

  private begin(kind: Trial['kind'], before: number, at: number): void {
    const judged = this.judgedMs;
    this.trial = {
      kind,
      from: this.current,
      before,
      seen: 0,
      rates: [],
      walked: false,
      judged,
      at,
      gained: null,
    };
    this.current = kind === 'down' ? this.current + 1 : kind === 'probe' ? 0 : this.current - 1;
    this.recent = [];
    this.fresh = null;
    this.calm = 0;
    this.unpicked = true;
  }

  // A trial's windows are in: kept, looked back on, a rung further, or
  // undone.
  private decide(trial: Trial, target: number, at: number): void {
    const r = this.rules;
    const line = r.shortShare * target;
    const mid = middle(trial.rates);
    if (trial.kind === 'probe') {
      this.trial = null;
      if (mid.median >= line) {
        this.probe = 'held';
        this.recent = trial.rates;
        this.upKeptAt = at;
      } else {
        this.probe = 'failed';
        this.current = trial.from;
      }
      return;
    }
    if (trial.kind === 'up' || trial.kind === 'look') {
      this.trial = null;
      const probation = this.probation;
      // A step up is kept when the rung above holds the line; a step on
      // probation is given back when the rung above is no longer short.
      if (trial.kind === 'look' ? mid.high >= line : mid.low >= line) {
        if (probation) this.droppedEarly = probation.early;
        this.probation = null;
        this.recent = trial.rates;
        this.upKeptAt = at;
        this.upFails = 0;
        return;
      }
      this.current = trial.from;
      if (trial.kind === 'look' && probation && --probation.looks > 0) {
        probation.left = PROBATION_WINDOWS;
        return;
      }
      this.probation = null;
      this.upHeldUntil = at + r.upHoldMs * 2 ** this.upFails;
      this.upFails++;
      return;
    }
    const gained = trial.gained;
    if (gained) {
      // The rung it left, drawn again: still short, and the step still
      // gaining over it, the step is the gain; on the line, the slowdown
      // is over.
      const back = mid.median;
      const same = Math.max(back, trial.before) < r.gain * Math.min(back, trial.before);
      if (back < line && same && steady(gained.rates) >= back * r.gain) {
        this.current = gained.to;
        this.kept(trial, gained.rates, line);
      } else {
        this.undone(trial, at);
      }
      return;
    }
    const after = steady(trial.rates);
    if (after >= trial.before * r.gain) {
      // The step, or a slowdown that ended during the trial: the rung it
      // left is drawn again to tell.
      trial.gained = { to: this.current, rates: trial.rates };
      this.current = trial.from;
      trial.seen = 0;
      trial.rates = [];
      return;
    }
    // A step down that gained nothing, every frame still taking the same
    // two or three refreshes of the rate aimed for: a screen that waits
    // for its refresh shows nothing until a frame fits under one refresh
    // fewer, so the next rung down is tried against the same median, once.
    // Slower frames cross a refresh with any rung's gain.
    const refreshes = target / after;
    const waiting = refreshes >= 1.5 && refreshes < 3.5 && wholeTimes(refreshes);
    if (!trial.walked && waiting && this.current < this.rungs.length - 1) {
      this.current++;
      trial.walked = true;
      trial.seen = 0;
      trial.rates = [];
      return;
    }
    this.undone(trial, at);
  }

  // A step down kept, on probation, its windows the new rung's: still
  // short, the next one comes at once.
  private kept(trial: Trial, rates: number[], line: number): void {
    const r = this.rules;
    this.trial = null;
    this.recent = rates;
    this.unpicked = true;
    this.calm = 0;
    this.probation = {
      from: trial.from,
      left: PROBATION_WINDOWS,
      looks: PROBATION_LOOKS,
      early: this.droppedEarly,
    };
    this.downFails = 0;
    if (trial.from === 0 && trial.judged < EVIDENCE_MS) this.droppedEarly = true;
    // A step up given up this soon after it was kept: the rung above
    // hovers about the line.
    if (trial.at - this.upKeptAt < r.hoverMs && trial.before >= r.deepShare * line) {
      this.upsOver = true;
    }
  }

  // Not what held it back, or not room enough: undone, and the next one
  // waits.
  private undone(trial: Trial, at: number): void {
    this.trial = null;
    this.current = trial.from;
    this.downHeldUntil = at + this.rules.downHoldMs * 2 ** this.downFails;
    this.downFails++;
  }
}
