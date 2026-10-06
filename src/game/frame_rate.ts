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

const LONGEST_MS = 1000;

let frames = 0;
let spent = 0;
let lastPaint: number | null = null;
let since: number | null = null;
let running = false;

function paint(at: number): void {
  if (lastPaint !== null) {
    const dt = at - lastPaint;
    if (dt > 0 && dt <= LONGEST_MS) {
      frames++;
      spent += dt;
    }
  }
  lastPaint = at;
  requestAnimationFrame(paint);
}

// The rate since the last call, in frames a second, rounded to a tenth;
// null on the first call (the count starts there), while the page is
// hidden, when less than half a second went by, or when under a quarter
// of a second of it was drawn.
export function frameRate(now = performance.now()): number | null {
  if (!running) {
    running = true;
    requestAnimationFrame(paint);
  }
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
