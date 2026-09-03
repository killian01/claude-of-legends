import { defineConfig, loadEnv } from 'vite';

// Dev: the Vite client talks to the game server on PORT, the variable the
// server itself listens on, read from the shell or from .env (default
// 8787). A second checkout, a worktree beside the first, then runs its own
// pair with one line in its .env; Vite picks the next free port for the
// client on its own and prints it.
export default defineConfig(({ mode }) => {
  const port = Number(loadEnv(mode, process.cwd(), '').PORT || 8787);
  return {
    server: {
      watch: {
        // art_src/ holds the raw 2048px icon sources: nothing imports them, and
        // watching files that are still being copied in crashes the dev server
        // with EBUSY on Windows.
        ignored: ['**/art_src/**'],
      },
      proxy: {
        '/ws': { target: `ws://127.0.0.1:${port}`, ws: true },
        '/api': { target: `http://127.0.0.1:${port}` },
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
  };
});
