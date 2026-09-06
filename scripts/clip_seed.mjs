// Bundles and runs scripts/clip_seed.ts (dev-only clip scouting).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/clip_seed.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/clip_seed.cjs',
  external: [],
});
const run = spawnSync(process.execPath, ['dist-server/clip_seed.cjs', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
