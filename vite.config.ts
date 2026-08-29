import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: {
      // art_src/ holds the raw 2048px icon sources: nothing imports them, and
      // watching files that are still being copied in crashes the dev server
      // with EBUSY on Windows.
      ignored: ['**/art_src/**'],
    },
    proxy: {
      // Dev: the Vite client on :5173 talks to the game server on :8787.
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
      '/api': { target: 'http://127.0.0.1:8787' },
    },
  },
  test: {
    // The heaviest tests step whole matches to a result: the endgame run is
    // 20 s of wall clock on its own, and objectives and pacing sit close
    // enough to the 5 s default that a loaded machine fails them for being
    // slow rather than wrong. The bound is here to catch a hang, not to
    // measure the sim.
    testTimeout: 60_000,
  },
});
