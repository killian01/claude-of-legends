// The Star Orchard's download on a slow line (star_orchard.ts). The full
// model is three times the light one (map_quality.ts), and on a line that
// brings a few hundred kilobytes a second it keeps the loading card up for
// minutes while the match goes on without its player. So the full model's
// download is watched: once it has run long enough to say how fast the line
// is, a wait projected past SLOW_LINE_LIMIT_MS gives it up for the light
// model, the same scene with smaller textures, whenever that is the shorter
// wait. Pure but for the fetch it is handed, so tests/slow_line.test.ts can
// drive it with a made-up line and clock.

// How long the full download runs before its pace is read: long enough
// that a slow first second does not decide it.
export const SLOW_LINE_SAMPLE_MS = 5000;
// The wait still ahead past which the light model is fetched instead.
export const SLOW_LINE_LIMIT_MS = 30_000;
// How often a download that brings nothing is looked at again.
export const SLOW_LINE_CHECK_MS = 1000;

export interface DownloadPace {
  elapsedMs: number;
  received: number;
  total: number;
  lightBytes: number;
}

// Whether to give the full model up for the light one: the line has been
// read, the full model's wait ahead runs past the limit, and the light model
// from scratch is fewer bytes than the full one still to come.
export function prefersLight(pace: DownloadPace): boolean {
  const { elapsedMs, received, total, lightBytes } = pace;
  if (lightBytes <= 0 || elapsedMs < SLOW_LINE_SAMPLE_MS) return false;
  const left = total - received;
  if (left <= lightBytes) return false;
  if (received <= 0) return true;
  return (left * elapsedMs) / received > SLOW_LINE_LIMIT_MS;
}

export interface ModelFile {
  file: string;
  bytes: number;
}

export interface SlowLineDeps {
  fetchFile: (path: string) => Promise<Response>;
  // The size to count a response against (download_total.ts).
  totalOf: (res: Response, expected: number) => number;
  now: () => number;
}

const TICK = Symbol('tick');

function tick(ms: number): { done: Promise<typeof TICK>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<typeof TICK>((resolve) => {
    timer = setTimeout(() => resolve(TICK), ms);
  });
  return { done, clear: () => clearTimeout(timer) };
}

function join(chunks: Uint8Array[], received: number): ArrayBuffer {
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

// Streams one file, reporting its progress from 0 to 1. With a light model
// to fall back on, resolves null the moment prefersLight says to give it up.
async function stream(
  model: ModelFile,
  light: ModelFile | null,
  deps: SlowLineDeps,
  onProgress: (fraction: number) => void,
): Promise<ArrayBuffer | null> {
  const res = await deps.fetchFile(model.file);
  const total = deps.totalOf(res, model.bytes);
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const started = deps.now();
  const slow = (): boolean =>
    light !== null &&
    prefersLight({
      elapsedMs: deps.now() - started,
      received,
      total,
      lightBytes: light.bytes,
    });
  let next = reader.read();
  for (;;) {
    const wait = tick(SLOW_LINE_CHECK_MS);
    const got = await Promise.race([next, wait.done]);
    wait.clear();
    if (got !== TICK) {
      if (got.done) break;
      chunks.push(got.value);
      received += got.value.byteLength;
      onProgress(Math.min(1, received / total));
      next = reader.read();
    }
    if (slow()) {
      next.catch(() => undefined);
      reader.cancel().catch(() => undefined);
      return null;
    }
  }
  return join(chunks, received);
}

// The model's bytes: the full one when it comes in time, the light one when
// the line is too slow for it. The progress never steps back: the light
// download fills what the bar had left.
export async function downloadModel(
  full: ModelFile,
  light: ModelFile | null,
  deps: SlowLineDeps,
  onProgress: (fraction: number) => void,
): Promise<ArrayBuffer> {
  let shown = 0;
  const bytes = await stream(full, light, deps, (fraction) => {
    shown = fraction;
    onProgress(fraction);
  });
  if (bytes !== null || light === null) return bytes as ArrayBuffer;
  const from = shown;
  const lightBytes = await stream(light, null, deps, (fraction) => {
    onProgress(from + (1 - from) * fraction);
  });
  return lightBytes as ArrayBuffer;
}
