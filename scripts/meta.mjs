// Bundles and runs scripts/meta_report.ts (what was actually played, off
// the match log the server already writes).

import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/meta_report.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-server/meta_report.cjs',
  external: [],
});
const run = spawnSync(process.execPath, ['dist-server/meta_report.cjs', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
