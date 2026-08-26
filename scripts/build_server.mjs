// Bundles the authoritative server with esbuild into one runnable file.

import { build } from 'esbuild';

await build({
  entryPoints: ['server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/server.cjs',
  sourcemap: true,
  external: [],
});
console.log('server bundled to dist-server/server.cjs');
