// Bundles and runs scripts/thornfray_report.ts (what a Thornfray of house
// bots looks like on the Wanderseed, per bout kind and over whole matches).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/thornfray_report.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/thornfray_report.cjs',
  external: [],
});
const run = spawnSync(
  process.execPath,
  ['dist-server/thornfray_report.cjs', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(run.status ?? 1);
