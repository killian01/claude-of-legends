// The frames a second this page draws, for the seat report (server/
// seat_report.ts, PRIVACY.md): a requestAnimationFrame loop of its own
// counts the frames the browser paints, and each answer to the server's
// round-trip probe carries the rate since the one before. Nothing while
// the tab is hidden: a browser stops painting it, and that is no frame
// rate. Without it nothing said whether the planet drew at five frames a
// second on a given machine.
//
// The rate is the frames over the time between them, not over the time
// since the last probe: a tab hidden for four of its five seconds and
// drawing 60 a second for the fifth said 12 (2026-10-06). An interval over
// a second is a hidden tab or a stall, left out.
//
// The same loop reads the screen's refresh for the quality ladder
// (quality_ladder.ts), from the page's start: the menus' frames are light
// and come on every refresh, where a match on a weak GPU may take two
// refreshes for each of its frames, a cadence a screen half as fast would
// show as well. The fastest refresh read is kept. A browser hands
// requestAnimationFrame the time of the screen's refresh, so every interval
// is a whole number of refreshes and their common divisor is the refresh,
// however slow the frames.

const LONGEST_MS = 1000;
// The refresh is searched down to this short, over divisors up to the
// most, through a clock that rounds a frame's time this far.
const FASTEST_REFRESH_MS = 1000 / 250;
const MAX_DIVISOR = 8;
const ROUNDING_MS = 1.5;
// Intervals a refresh is read off at a time.
const REFRESH_FRAMES = 30;

// Whether `ratio` is a whole number, one or more, give or take a tenth.
export const wholeTimes = (ratio: number): boolean =>
  ratio >= 0.9 && Math.abs(ratio - Math.round(ratio)) <= 0.1;

// The screen's refresh in Hz read off frame intervals, nine in ten of them
// a whole number of refreshes; null when no divisor fits. The shortest are
// averaged first, so a clock that rounds to the millisecond reads true.
export function refreshHz(intervals: readonly number[]): number | null {
  if (intervals.length < 4) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const from = sorted[Math.floor(sorted.length * 0.05)]!;
  const low = sorted.filter((x) => x >= from && x <= from + ROUNDING_MS);
  const shortest = low.reduce((a, b) => a + b, 0) / low.length;
  for (let k = 1; k <= MAX_DIVISOR; k++) {
    const p = shortest / k;
    if (p < FASTEST_REFRESH_MS) break;
    const fit = intervals.filter((x) => wholeTimes(x / p));
    if (fit.length >= intervals.length * 0.9) {
      const refreshes = fit.reduce((n, x) => n + Math.round(x / p), 0);
      return (1000 * refreshes) / fit.reduce((a, b) => a + b, 0);
    }
  }
  return null;
}

let frames = 0;
let spent = 0;
let lastPaint: number | null = null;
let since: number | null = null;
let running = false;
let recent: number[] = [];
let refresh: number | null = null;

function paint(at: number): void {
  if (lastPaint !== null) {
    const dt = at - lastPaint;
    if (dt > 0 && dt <= LONGEST_MS) {
      frames++;
      spent += dt;
      recent.push(dt);
      if (recent.length >= REFRESH_FRAMES) {
        const hz = refreshHz(recent);
        if (hz !== null) refresh = Math.max(refresh ?? 0, hz);
        recent = [];
      }
    }
  }
  lastPaint = at;
  requestAnimationFrame(paint);
}

// Starts the loop, once: at the page's start, so the menus are counted.
export function watchFrames(): void {
  if (running) return;
  running = true;
  requestAnimationFrame(paint);
}

// The screen's refresh in Hz, the fastest read so far; null before the
// first read.
export function screenRefresh(): number | null {
  return refresh;
}

// The rate since the last call, in frames a second, rounded to a tenth;
// null on the first call (the count starts there), while the page is
// hidden, when less than half a second went by, or when under a quarter
// of a second of it was drawn.
export function frameRate(now = performance.now()): number | null {
  watchFrames();
  const hidden = typeof document !== 'undefined' && document.hidden;
  const last = since;
  if (last !== null && !hidden && now - last < 500) return null;
  const counted = frames;
  const drawn = spent;
  since = now;
  frames = 0;
  spent = 0;
  if (last === null || hidden || drawn < 250) return null;
  return Math.round((counted * 10000) / drawn) / 10;
}
