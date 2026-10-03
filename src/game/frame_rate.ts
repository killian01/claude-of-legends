// The frames a second this page draws, for the seat report (server/
// seat_report.ts, PRIVACY.md): a requestAnimationFrame loop of its own
// counts the frames the browser paints, and each answer to the server's
// round-trip probe carries the rate since the one before. Nothing while
// the tab is hidden: a browser stops painting it, and that is no frame
// rate. Visitors left inside two minutes and nothing said whether the
// planet drew at five frames a second on their machine (2026-10-03).

let frames = 0;
let since: number | null = null;
let running = false;

function paint(): void {
  frames++;
  requestAnimationFrame(paint);
}

// The rate since the last call, in frames a second, rounded to a tenth;
// null on the first call (the count starts there), while the page is
// hidden, or when less than half a second went by.
export function frameRate(now = performance.now()): number | null {
  if (!running) {
    running = true;
    requestAnimationFrame(paint);
  }
  const hidden = typeof document !== 'undefined' && document.hidden;
  const last = since;
  const counted = frames;
  if (last === null || hidden || now - last >= 500) {
    since = now;
    frames = 0;
  }
  if (last === null || hidden || now - last < 500) return null;
  return Math.round((counted * 10000) / (now - last)) / 10;
}
