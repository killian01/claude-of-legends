// Bundles and runs scripts/creature_report.ts (what a neutral body costs
// to kill, against the standard in docs/plan-rings.md).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/creature_report.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/creature_report.cjs',
  external: [],
});
const run = spawnSync(
  process.execPath,
  ['dist-server/creature_report.cjs', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(run.status ?? 1);
