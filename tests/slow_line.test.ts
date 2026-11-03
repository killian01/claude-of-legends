// A full Star Orchard on a slow line gives way to the light model (src/game/
// slow_line.ts): the rule, and the download driven over a made-up line.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadModel,
  prefersLight,
  SLOW_LINE_LIMIT_MS,
  SLOW_LINE_SAMPLE_MS,
} from '../src/game/slow_line';

const FULL = 42_849_216;
const LIGHT = 14_102_380;

describe('when the light model is the shorter wait', () => {
  const pace = (elapsedMs: number, received: number) => ({
    elapsedMs,
    received,
    total: FULL,
    lightBytes: LIGHT,
  });

  it('waits for the line to be read first', () => {
    expect(prefersLight(pace(SLOW_LINE_SAMPLE_MS - 1, 0))).toBe(false);
    expect(prefersLight(pace(SLOW_LINE_SAMPLE_MS, 0))).toBe(true);
  });

  it('keeps the full model on a line that brings it in time', () => {
    // 4 MB a second: the rest of the full model in about six seconds.
    expect(prefersLight(pace(5000, 20_000_000))).toBe(false);
    // Exactly at the limit still waits for it.
    const received = FULL / 2;
    expect(prefersLight(pace(SLOW_LINE_LIMIT_MS, received))).toBe(false);
  });

  it('gives the full model up on a line that would hold the card for minutes', () => {
    // 200 kB a second: more than three minutes of full model still to come.
    expect(prefersLight(pace(5000, 1_000_000))).toBe(true);
  });

  it('keeps the full model once less of it is left than the light one', () => {
    expect(prefersLight(pace(200_000, FULL - LIGHT))).toBe(false);
  });

  it('never switches with no light model to switch to', () => {
    expect(prefersLight({ ...pace(60_000, 1000), lightBytes: 0 })).toBe(false);
  });
});

// A line that hands out `chunk` bytes every `everyMs` of the fake clock.
function line(bytes: number, chunk: number, everyMs: number, clock: { t: number }): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, everyMs));
      clock.t += everyMs;
      const n = Math.min(chunk, bytes - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n).fill(bytes === LIGHT_SMALL ? 2 : 1));
    },
  });
  return new Response(body);
}

const FULL_SMALL = 3000;
const LIGHT_SMALL = 1000;

describe('the download on a slow line', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function run(fullEveryMs: number) {
    const clock = { t: 0 };
    const asked: string[] = [];
    const progress: number[] = [];
    const done = downloadModel(
      { file: 'map.glb', bytes: FULL_SMALL },
      { file: 'map-light.glb', bytes: LIGHT_SMALL },
      {
        fetchFile: async (path) => {
          asked.push(path);
          return path === 'map.glb'
            ? line(FULL_SMALL, 10, fullEveryMs, clock)
            : line(LIGHT_SMALL, 100, 100, clock);
        },
        totalOf: (_res, expected) => expected,
        now: () => clock.t,
      },
      (fraction) => progress.push(fraction),
    );
    await vi.runAllTimersAsync();
    return { bytes: await done, asked, progress };
  }

  it('fetches the light model when the full one would take too long', async () => {
    // 10 bytes every 150 ms: 45 s for the whole model, 40 s left at 5 s.
    const { bytes, asked, progress } = await run(150);
    expect(asked).toEqual(['map.glb', 'map-light.glb']);
    expect(bytes.byteLength).toBe(LIGHT_SMALL);
    expect(new Uint8Array(bytes)[0]).toBe(2);
    // The bar never steps back, and it ends full.
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1] as number);
    }
    expect(progress.at(-1)).toBe(1);
  });

  it('keeps the full model on a line fast enough for it', async () => {
    const { bytes, asked } = await run(50);
    expect(asked).toEqual(['map.glb']);
    expect(bytes.byteLength).toBe(FULL_SMALL);
  });

  it('gives up a full download that has stopped bringing anything', async () => {
    const clock = { t: 0 };
    const asked: string[] = [];
    const done = downloadModel(
      { file: 'map.glb', bytes: FULL_SMALL },
      { file: 'map-light.glb', bytes: LIGHT_SMALL },
      {
        fetchFile: async (path) => {
          asked.push(path);
          if (path === 'map-light.glb') return line(LIGHT_SMALL, 100, 100, clock);
          return new Response(
            new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }),
          );
        },
        totalOf: (_res, expected) => expected,
        now: () => clock.t,
      },
      () => undefined,
    );
    for (let i = 0; i < 8; i++) {
      clock.t += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
    await vi.runAllTimersAsync();
    expect(asked).toEqual(['map.glb', 'map-light.glb']);
    expect((await done).byteLength).toBe(LIGHT_SMALL);
  });
});
