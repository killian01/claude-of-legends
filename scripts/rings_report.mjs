// Bundles and runs scripts/rings_report.ts (what the rings do in house
// bot matches on the shipped export).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/rings_report.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/rings_report.cjs',
  external: [],
});
const run = spawnSync(
  process.execPath,
  ['dist-server/rings_report.cjs', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);
process.exit(run.status ?? 1);
