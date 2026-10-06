// How finely a match is drawn on this device: stepped down while the frames
// come far too slowly, back up once there is room. Laptops with a weak
// integrated GPU drew whole matches at 20 to 28 frames a second (the seat
// reports, 2026-10-05). Fill bound, the knobs come in this order: fewer
// pixels (a ratio of 1 instead of 1.25 draws in 0.70 of the time), then the
// sun's shadows left out of the ground (about 0.9). Both change mid-match
// without a hitch, so they are the rungs (quality_dial.ts); what only a new
// context changes waits for the next match (quality_memory.ts).
//
// Small on purpose: a step taken over a slowdown that passed is given back
// by the next trial up and never carries over, rather than ruled out. Every
// match starts on the top rung and draws it 20 judged seconds first; the
// top's windows are what the next match's lean is weighed on. Under three
// quarters of the target (45 frames a second on a 60 Hz screen) by the
// median of the last eight one-second windows, four fresh windows are
// measured, since windows that crossed lean low; still under, the rung
// below is tried and kept when the median of eight windows after a change
// of two draws 1.15 times the fresh one. A lower rung that then draws nine
// tenths of the target, or no longer 1.15 times what its step was weighed
// against, tries at once the rung its step came from, kept when it holds
// three quarters. A failed step holds the next of its kind back, twice as
// long after each, never past a ceiling.
//
// A browser hands requestAnimationFrame the refresh's time, so frames that
// all take two refreshes on a 60 Hz screen read as a 30 Hz screen's would
// (frame_rate.ts): the rate known before the match stands over a whole
// fraction of it. Nothing faster than 60 is chased. Pure: quality_dial.ts
// feeds it every frame drawn.

import { refreshHz, wholeTimes } from './frame_rate';

export const LADDER_RULES = {
  capHz: 60, // the fastest rate worth pixels
  windowMs: 1000, // a window's least drawing
  windowFrames: 4, // and frames
  lineShare: 0.75, // of the target: under it, short
  roomShare: 0.9, // a lower rung drawing this has room above it
  medianWindows: 8, // a median's windows, and a trial's
  freshWindows: 4, // measured after a crossing, and a walked rung's trial
  changeWindows: 2, // left for a change of rung
  gain: 1.15, // a step down kept draws this many times its before
  startMs: 20_000, // judged on the top before a step down from it
  downHoldMs: 45_000, // after a step down undone or given back, doubling
  downHoldMostMs: 180_000,
  upHoldMs: 20_000, // after a step up undone, doubling
  upHoldMostMs: 300_000,
  scriptShare: 0.75, // frames this much script are not held back by pixels
  topQuantile: 0.9, // the top's share: nine windows in ten at it or under
};

// One slow frame in a window is a hitch, left out of its rate; slow frames
// one after another are stalls, not counted until a run of them has lasted
// three seconds, and then the new pace.
const STALL_FACTOR = 4; // times the usual interval
const STALL_MIN_MS = 250;
const STALL_RUN_MS = 3000;
const HITCH_FACTOR = 4; // times the window's median interval
// Frames under this share of the refresh read took more refreshes some
// times than others: the read is the screen's own.
const CLEAR_SHARE = 0.95;

// The middle value, or the mean of the two middle ones.
export function median(xs: readonly number[]): number {
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

// The hold after `fails` failed steps of its kind.
const hold = (first: number, most: number, fails: number) => Math.min(most, first * 2 ** fails);

// A step on trial: its way, the rung it left, what a step down is weighed
// against, the windows since the change, the rates after the ones left for
// it, and whether it went a rung further.
interface Trial {
  down: boolean;
  from: number;
  before: number;
  seen: number;
  rates: number[];
  walked: boolean;
}

export class QualityLadder {
  private current = 0;
  private lastAt: number | null = null;
  private usual: number | null = null;
  private stalled = 0;
  private intervals: number[] = [];
  private scripts: number[] = [];
  private bestHz = 0;
  private refresh: number | null = null;
  // The rung's last windows outside a trial, the fresh ones, the trial, and
  // the steps down kept, the last undone first.
  private recent: number[] = [];
  private fresh: number[] | null = null;
  private trial: Trial | null = null;
  private readonly steps: { from: number; before: number }[] = [];
  private downHeldUntil = Number.NEGATIVE_INFINITY;
  private downFails = 0;
  private heldBefore = 0;
  private upHeldUntil = Number.NEGATIVE_INFINITY;
  private upFails = 0;
  // The top's windows as shares of the target.
  private readonly topShares: number[] = [];
  // Judged in all and on the top; the refresh read off frames some of which
  // took more refreshes than others, the screen's own, worth remembering.
  judgedMs = 0;
  topMs = 0;
  refreshRead: number | null = null;

  // `rungs` from the top; `known`: the screen's rate before the match
  // (frame_rate.ts, else remembered); nothing judged before `settleUntil`.
  constructor(
    private readonly rungs: number,
    private readonly known: number | null,
    private settleUntil: number,
  ) {}

  // The rung to draw on, 0 the top, of the dial's `rungs`.
  get index(): number {
    return this.current;
  }

  // A step on trial, and the rung the ladder stands on outside it.
  get trying(): boolean {
    return this.trial !== null;
  }

  get settled(): number {
    return this.trial?.from ?? this.current;
  }

  // The top's windows as shares of the target, nine in ten of them at this
  // or under: under 0.6 the top drew far too slowly all along
  // (quality_memory.ts), not for a fight or three that filled most of its
  // windows while the ladder stood a rung down between them.
  get topShare(): number | null {
    const s = [...this.topShares].sort((a, b) => a - b);
    return s.length > 0 ? s[Math.floor(s.length * LADDER_RULES.topQuantile)]! : null;
  }

  // The screen's rate: the refresh read (else known), or the best seen.
  get screenHz(): number | null {
    const hz = Math.max(this.bestHz, this.refresh ?? this.known ?? 0);
    return hz > 0 ? hz : null;
  }

  // A frame shown at `at`, its script having taken `scriptMs`; answers the
  // rung to draw the next one on.
  frame(at: number, scriptMs?: number): number {
    const r = LADDER_RULES;
    const dt = this.lastAt === null ? 0 : at - this.lastAt;
    this.lastAt = at;
    if (!(dt > 0)) return this.current;
    if (this.usual !== null && dt > Math.max(STALL_MIN_MS, STALL_FACTOR * this.usual)) {
      this.stalled += dt;
      if (this.stalled < STALL_RUN_MS) return this.current;
      this.usual = null;
    }
    this.stalled = 0;
    this.usual = this.usual === null ? Math.min(dt, 1000) : this.usual * 0.9 + dt * 0.1;
    this.intervals.push(dt);
    if (scriptMs !== undefined && scriptMs >= 0) this.scripts.push(scriptMs / dt);
    const ms = this.intervals.reduce((a, b) => a + b, 0);
    if (ms < r.windowMs || this.intervals.length < r.windowFrames) return this.current;
    const fps = windowRate(this.intervals);
    const script = this.scripts.length > 0 ? median(this.scripts) : 0;
    const hz = refreshHz(this.intervals);
    this.intervals = [];
    this.scripts = [];
    if (hz !== null) {
      // The rate known stands over a whole fraction of it; else (60 known,
      // 50 read) it was another screen's.
      if (fps < CLEAR_SHARE * hz) this.refreshRead = Math.max(this.refreshRead ?? 0, hz);
      const k = this.known;
      const rate = k !== null && k > hz && wholeTimes(k / hz) ? k : hz;
      this.refresh = Math.max(this.refresh ?? 0, rate);
    }
    this.bestHz = Math.max(this.bestHz, fps);
    if (at >= this.settleUntil) this.judge(fps, script, at, ms);
    return this.current;
  }

  // A frame the renderer did not draw: the next interval does not count.
  gap(): void {
    this.lastAt = null;
  }

  // The view changed under the ladder: its windows are dropped and nothing
  // is judged until `until`, a trial starting its count again.
  pause(until: number): void {
    this.lastAt = null;
    this.usual = null;
    this.intervals = [];
    this.scripts = [];
    this.recent = [];
    this.fresh = null;
    this.settleUntil = Math.max(this.settleUntil, until);
    if (this.trial) Object.assign(this.trial, { seen: 0, rates: [] });
  }

  private judge(fps: number, script: number, at: number, ms: number): void {
    const r = LADDER_RULES;
    const target = Math.min(r.capHz, this.screenHz ?? r.capHz);
    const line = r.lineShare * target;
    this.judgedMs += ms;
    if (this.current === 0) {
      this.topMs += ms;
      this.topShares.push(fps / target);
    }
    const trial = this.trial;
    if (trial) {
      if (++trial.seen <= r.changeWindows) return;
      trial.rates.push(fps);
      const needed = trial.walked ? r.freshWindows : r.medianWindows;
      if (trial.rates.length >= needed) this.decide(trial, target, at);
      return;
    }
    this.recent = [...this.recent, fps].slice(-r.medianWindows);
    if (this.fresh) {
      this.fresh.push(fps);
      if (this.fresh.length < r.freshWindows) return;
      const before = median(this.fresh);
      this.fresh = null;
      if (before < line && this.mayStepDown(before, script, at)) this.begin(true, before);
      return;
    }
    if (this.recent.length < r.medianWindows) return;
    const now = median(this.recent);
    const step = this.steps.at(-1);
    if (now < line) {
      if (this.mayStepDown(now, script, at)) this.fresh = [];
    } else if (
      step &&
      at >= this.upHeldUntil &&
      (now >= r.roomShare * target || now < r.gain * step.before)
    ) {
      this.begin(false, 0);
    }
  }

  // Not from the floor, nor from the top in its first seconds, nor for
  // frames held back by their script, nor while a failed step's hold runs
  // unless the page has slowed well under that step's before (a new pace).
  private mayStepDown(rate: number, script: number, at: number): boolean {
    const r = LADDER_RULES;
    return (
      this.current < this.rungs - 1 &&
      (this.current > 0 || this.topMs >= r.startMs) &&
      script < r.scriptShare &&
      (at >= this.downHeldUntil || rate * r.gain < this.heldBefore)
    );
  }

  private begin(down: boolean, before: number): void {
    this.trial = { down, from: this.current, before, seen: 0, rates: [], walked: false };
    this.current = down ? this.current + 1 : this.steps.at(-1)!.from;
    this.recent = [];
    this.fresh = null;
  }

  // A trial's windows are in. Up: kept, the step down it undoes failed too,
  // or back and held. Down: kept, and still short the next at once against
  // its windows; the page slowed under it, fresh windows at once, nothing
  // held; every frame still the same whole number of refreshes, a rung
  // further (a screen waiting for its refresh shows nothing until a frame
  // fits under one fewer); else back and held.
  private decide(trial: Trial, target: number, at: number): void {
    const r = LADDER_RULES;
    const after = median(trial.rates);
    this.trial = null;
    if (!trial.down) {
      if (after >= r.lineShare * target) {
        this.holdDown(this.steps.pop()!.before, at);
        this.recent = trial.rates;
        this.upFails = 0;
      } else {
        this.current = trial.from;
        this.upHeldUntil = at + hold(r.upHoldMs, r.upHoldMostMs, this.upFails++);
      }
    } else if (after >= r.gain * trial.before) {
      this.steps.push({ from: trial.from, before: trial.before });
      this.recent = trial.rates;
      if (after < r.lineShare * target && this.mayStepDown(after, 0, at)) this.begin(true, after);
    } else if (after * r.gain < trial.before) {
      this.current = trial.from;
      this.fresh = [];
    } else if (wholeTimes(target / after) && this.current < this.rungs - 1) {
      this.current++;
      this.trial = { ...trial, seen: 0, rates: [], walked: true };
    } else {
      this.current = trial.from;
      this.holdDown(trial.before, at);
    }
  }

  private holdDown(before: number, at: number): void {
    const r = LADDER_RULES;
    this.downHeldUntil = at + hold(r.downHoldMs, r.downHoldMostMs, this.downFails++);
    this.heldBefore = before;
  }
}
