// Bundles the headless environment with esbuild into one runnable file, the
// same way the server is bundled: a trainer outside the repo spawns this.

import { build } from 'esbuild';

await build({
  entryPoints: ['headless/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-env/env.cjs',
  sourcemap: true,
  external: [],
});
console.log('environment bundled to dist-env/env.cjs');
