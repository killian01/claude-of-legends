// The frames a second this page draws, for the seat report (server/
// seat_report.ts, PRIVACY.md): a requestAnimationFrame loop of its own
// counts the frames the browser paints, and each answer to the server's
// round-trip probe carries the rate since the one before. Nothing while
// the tab is hidden: a browser stops painting it, and that is no frame
// rate. Visitors left inside two minutes and nothing said whether the
// planet drew at five frames a second on their machine (2026-10-03).
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
// show as well. The fastest refresh read is kept.

import { refreshHz } from './quality_ladder';

const LONGEST_MS = 1000;
// Intervals a refresh is read off at a time.
const REFRESH_FRAMES = 30;

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
