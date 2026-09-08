// Bundles and runs scripts/seed_home.ts (dev-only seeding of a server with
// people on it: placed accounts, ranked bots, forged champions). Run it with
// the server down, DATA_DIR set to the directory the stack will use.

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/seed_home.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/seed_home.cjs',
  external: [],
});
const run = spawnSync(process.execPath, ['dist-server/seed_home.cjs'], { stdio: 'inherit' });
process.exit(run.status ?? 1);
