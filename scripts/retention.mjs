// Bundles and runs scripts/retention_report.ts (who came back, off the
// files the server already writes).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/retention_report.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/retention_report.cjs',
  external: [],
});
const run = spawnSync(
  process.execPath,
  ['dist-server/retention_report.cjs', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);
process.exit(run.status ?? 1);
