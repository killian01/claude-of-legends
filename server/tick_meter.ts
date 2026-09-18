// How the world loop is keeping up, in numbers: what every tick costs,
// the ticks run late (a catch-up after the timer slipped), the bytes the
// snapshots send. One report per window, logged while a match is on and
// published on /healthz, so a load test (scripts/load_match.mjs) reads the
// server's side of the story beside what its clients see. Pure over the
// numbers it is handed; the loop in main.ts feeds it.

export interface TickReport {
  // The window the numbers cover, in seconds.
  seconds: number;
  ticks: number;
  ticksPerSecond: number;
  // Time spent inside ticks, per tick and at worst, in milliseconds.
  avgMs: number;
  maxMs: number;
  // Ticks run as catch-up: the timer fired late and the loop ran more than
  // one tick to make up the time. A few per minute is the timer's jitter;
  // a steady stream is the server falling behind.
  late: number;
  // Bytes handed to sockets over the window, and per second.
  bytesOut: number;
  bytesPerSecond: number;
  matches: number;
  clients: number;
}

export class TickMeter {
  private since: number;
  private ticks = 0;
  private busyMs = 0;
  private maxMs = 0;
  private late = 0;
  private bytes = 0;
  private lastReport: TickReport | null = null;

  constructor(
    now: number,
    private readonly windowMs = 5000,
  ) {
    this.since = now;
  }

  // One tick's cost; late when it ran as a catch-up (the second or later
  // tick of one timer callback).
  tick(durationMs: number, late: boolean): void {
    this.ticks++;
    this.busyMs += Math.max(0, durationMs);
    if (durationMs > this.maxMs) this.maxMs = durationMs;
    if (late) this.late++;
  }

  sent(bytes: number): void {
    this.bytes += Math.max(0, bytes);
  }

  // The window's report once it has elapsed, and a fresh window begins;
  // null until then.
  report(now: number, matches: number, clients: number): TickReport | null {
    const elapsed = now - this.since;
    if (elapsed < this.windowMs) return null;
    const seconds = elapsed / 1000;
    const r: TickReport = {
      seconds: round(seconds, 1),
      ticks: this.ticks,
      ticksPerSecond: round(this.ticks / seconds, 1),
      avgMs: this.ticks > 0 ? round(this.busyMs / this.ticks, 2) : 0,
      maxMs: round(this.maxMs, 2),
      late: this.late,
      bytesOut: this.bytes,
      bytesPerSecond: Math.round(this.bytes / seconds),
      matches,
      clients,
    };
    this.since = now;
    this.ticks = 0;
    this.busyMs = 0;
    this.maxMs = 0;
    this.late = 0;
    this.bytes = 0;
    this.lastReport = r;
    return r;
  }

  // The most recent report, for anyone asking between windows.
  last(): TickReport | null {
    return this.lastReport;
  }
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// One log line: what the loop did over the window.
export function formatTickReport(r: TickReport): string {
  const out =
    r.bytesPerSecond >= 1_000_000
      ? `${round(r.bytesPerSecond / 1_000_000, 2)} MB/s`
      : `${Math.round(r.bytesPerSecond / 1000)} kB/s`;
  return (
    `tick: ${r.ticks} in ${r.seconds} s (${r.ticksPerSecond}/s), avg ${r.avgMs} ms, ` +
    `max ${r.maxMs} ms, late ${r.late}, out ${out}, matches ${r.matches}, clients ${r.clients}`
  );
}
