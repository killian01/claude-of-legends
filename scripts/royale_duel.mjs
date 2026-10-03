// Bundles and runs scripts/royale_duel.ts (every pairing of champions one
// against one on the Wanderseed, the planet balance's gate).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/royale_duel.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/royale_duel.cjs',
  external: [],
});
const run = spawnSync(process.execPath, ['dist-server/royale_duel.cjs', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
