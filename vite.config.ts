import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // Dev: the Vite client on :5173 talks to the game server on :8787.
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
