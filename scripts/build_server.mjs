// Bundles the authoritative server with esbuild into one runnable file,
// plus the Arena worker beside it (server/arena_worker.ts): a match at full
// speed on its own thread, spawned by the server from dist-server.

import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: [],
};

await build({ ...shared, entryPoints: ['server/main.ts'], outfile: 'dist-server/server.cjs' });
await build({
  ...shared,
  entryPoints: ['server/arena_worker.ts'],
  outfile: 'dist-server/arena_worker.cjs',
});
console.log('server bundled to dist-server/server.cjs (+ arena_worker.cjs)');
