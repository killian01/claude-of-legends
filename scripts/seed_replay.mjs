// Bundles and runs scripts/seed_replay.ts (dev-only replay seeding).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/seed_replay.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/seed_replay.cjs',
  external: [],
});
const run = spawnSync(process.execPath, ['dist-server/seed_replay.cjs'], { stdio: 'inherit' });
process.exit(run.status ?? 1);
