// The client reloads on a new build (src/net/build_watch.ts). What is
// pinned: the id is read the same way off the served page and off the
// page's own module URL, a build is new only when both sides are known
// and differ, and the watcher fires once, on a poke or on its poll.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIdIn, isNewBuild, startBuildWatch } from '../src/net/build_watch';

describe('the build id', () => {
  it('is the entry bundle named by the served page', () => {
    const html =
      '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-QpHC8-qD.js"></script>' +
      '<link rel="modulepreload" href="/assets/three-abc123.js"></head></html>';
    expect(buildIdIn(html)).toBe('index-QpHC8-qD');
  });

  it('is the same name off the module URL a built page runs from', () => {
    // import.meta.url in the entry chunk, in production.
    expect(buildIdIn('https://claudeoflegends.com/assets/index-QpHC8-qD.js')).toBe(
      'index-QpHC8-qD',
    );
  });

  it('is null under the dev server, which serves the source', () => {
    // No bundle, so nothing to compare and nothing ever reloads while
    // developing, which is what a hot-reloading page wants.
    expect(buildIdIn('http://localhost:5173/src/main.ts')).toBeNull();
    expect(buildIdIn('')).toBeNull();
  });

  it('does not stop short on a longer name', () => {
    expect(buildIdIn('/assets/index-abc.js.map')).toBeNull();
  });
});

describe('whether a build is new', () => {
  it('needs both sides known and different', () => {
    expect(isNewBuild('index-a', 'index-b')).toBe(true);
    expect(isNewBuild('index-a', 'index-a')).toBe(false);
  });

  it('is never new when either side is unknown', () => {
    // A dev page, a failed request, a server without dist: none of them
    // is a deployment, and a reload on any of them would loop.
    expect(isNewBuild(null, 'index-b')).toBe(false);
    expect(isNewBuild('index-a', null)).toBe(false);
    expect(isNewBuild('index-a', undefined)).toBe(false);
    expect(isNewBuild('index-a', '')).toBe(false);
  });
});

describe('the watcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reloads once when a poke finds a different build, and never again', async () => {
    let served = 'index-a';
    const onNew = vi.fn();
    const w = startBuildWatch({
      own: 'index-a',
      fetchBuild: () => Promise.resolve(served),
      onNew,
      everyMs: 60_000,
    });
    w.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(onNew).not.toHaveBeenCalled();
    served = 'index-b';
    w.poke();
    w.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(onNew).toHaveBeenCalledTimes(1);
    // The poll is stopped with it: one reload is the whole job.
    await vi.advanceTimersByTimeAsync(180_000);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('polls on its own, for a tab with no socket to close', async () => {
    let served = 'index-a';
    const onNew = vi.fn();
    startBuildWatch({
      own: 'index-a',
      fetchBuild: () => Promise.resolve(served),
      onNew,
      everyMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onNew).not.toHaveBeenCalled();
    served = 'index-c';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('asks nothing in development and stops cleanly', async () => {
    const fetchBuild = vi.fn(() => Promise.resolve('index-b'));
    const w = startBuildWatch({ own: null, fetchBuild, onNew: vi.fn(), everyMs: 1000 });
    w.poke();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchBuild).not.toHaveBeenCalled();
    w.stop();
  });

  it('shrugs off a request that fails and asks again next time', async () => {
    let fail = true;
    const onNew = vi.fn();
    const w = startBuildWatch({
      own: 'index-a',
      fetchBuild: () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve('index-b')),
      onNew,
      everyMs: 60_000,
    });
    w.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(onNew).not.toHaveBeenCalled();
    fail = false;
    w.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
