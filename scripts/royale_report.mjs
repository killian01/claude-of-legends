// Bundles and runs scripts/royale_report.ts (what a battle royale of fifty
// house bots looks like on the Wanderseed, per variant and seed).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/royale_report.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/royale_report.cjs',
  external: [],
});
const run = spawnSync(
  process.execPath,
  ['dist-server/royale_report.cjs', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(run.status ?? 1);
