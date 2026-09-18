// Bundles and runs scripts/practice_report.ts (what the practice matches
// say about the bots, off the reports the browser sends at their end).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/practice_report.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/practice_report.cjs',
  external: [],
});
const run = spawnSync(
  process.execPath,
  ['dist-server/practice_report.cjs', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);
process.exit(run.status ?? 1);
