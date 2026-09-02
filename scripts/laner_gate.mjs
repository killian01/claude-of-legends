// The default Laner against its previous version (ADR 0014, the internal
// guard under the bar in docs/design/bots.md): the Laner of the working
// tree drives one team, the Laner of a git ref drives the other, in the
// sim of the working tree, over fixed seeds with sides swapped every other
// seed. A Policy is a pure function of the observation, so the previous
// brain runs unchanged inside today's sim, and the win rate is what an
// engine or playbook change did. Usage:
//   node scripts/laner_gate.mjs [--prev <git-ref>] [--seeds 20] [--max-ticks 48000]
// Prints the tally and PASS or FAIL at seventy percent of decided matches.

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const ref = opt('--prev', 'HEAD');
const seeds = Number(opt('--seeds', '20'));
// The first seed, so a confirmation run can use seeds the search never saw.
const firstSeed = Number(opt('--from', '1'));
// The Arena's own cap (src/fast_match.ts): past it a match is a draw.
const maxTicks = Number(opt('--max-ticks', String(20 * 60 * 40)));
// A candidate playbook (JSON) to drive the current side instead of the
// working tree's Laner: the way to try a play list before it is the Laner.
const candidate = opt('--playbook', null);
// The build directory, so several gates can run side by side.
const distName = opt('--dist', 'dist-gate');
const BAR = 0.7;

const root = process.cwd();
const dist = path.join(root, distName);
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'prev'), { recursive: true });

// The previous tree, src only, straight out of git. Relative paths: the
// Windows tar reads a drive letter as a remote host.
execSync(`git archive --format=tar -o ${distName}/prev.tar ${ref} src`, { stdio: 'inherit' });
execSync(`tar -xf ${distName}/prev.tar -C ${distName}/prev`, { stdio: 'inherit' });

writeFileSync(
  path.join(dist, 'current.ts'),
  [
    "export { Sim } from '../src/sim/sim';",
    "export { fillTeam } from '../src/sim/fill';",
    "export { Rng } from '../src/sim/rng';",
    "export { LANER } from '../src/sim/content/bots/laner';",
    "export { playbookPolicy, validatePlaybook } from '../src/sim/playbook';",
    '',
  ].join('\n'),
);
writeFileSync(
  path.join(dist, 'prev.ts'),
  "export { LANER } from './prev/src/sim/content/bots/laner';\n",
);
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'silent',
};
await build({
  ...shared,
  entryPoints: [path.join(dist, 'current.ts')],
  outfile: path.join(dist, 'current.cjs'),
});
await build({
  ...shared,
  entryPoints: [path.join(dist, 'prev.ts')],
  outfile: path.join(dist, 'prev.cjs'),
});

const require = createRequire(import.meta.url);
const cur = require(path.join(dist, 'current.cjs'));
const prev = require(path.join(dist, 'prev.cjs'));
let currentPolicy = cur.LANER.policy;
if (candidate) {
  const v = cur.validatePlaybook(JSON.parse(readFileSync(candidate, 'utf8')));
  if (!v.ok) throw new Error(`candidate playbook: ${v.errors.join('; ')}`);
  currentPolicy = cur.playbookPolicy(v.def);
}

// One full 5v5, both teams on the fill drawn from the seed (src/sim/fill.ts:
// the roster's lanes by role, so lineups vary like a real match's), every
// seat a Laner: the working tree's on `curTeam`, the previous one's on the
// other.
function play(seed, curTeam) {
  const sim = new cur.Sim(seed);
  const rng = new cur.Rng(seed);
  for (const team of [0, 1]) {
    for (const [i, championId] of cur.fillTeam([], rng).entries()) {
      const unit = sim.addChampion(team, undefined, championId, i % 3);
      unit.sigils = ['riftstep', 'mend'];
      sim.attachPolicy(unit.id, team === curTeam ? currentPolicy : prev.LANER.policy);
    }
  }
  while (sim.winner === null && sim.tickCount < maxTicks) sim.tick();
  return { winner: sim.winner, seconds: Math.round(sim.time) };
}

let wins = 0;
let losses = 0;
let draws = 0;
const started = Date.now();
for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
  const curTeam = seed % 2 === 0 ? 1 : 0;
  const { winner, seconds } = play(seed, curTeam);
  const outcome = winner === null ? 'draw' : winner === curTeam ? 'win' : 'loss';
  if (outcome === 'win') wins++;
  else if (outcome === 'loss') losses++;
  else draws++;
  console.log(
    `seed ${seed}: current on team ${curTeam}, ${outcome} after ${seconds}s ` +
      `(${wins}-${losses}-${draws}, ${Math.round((Date.now() - started) / 1000)}s elapsed)`,
  );
}
const decided = wins + losses;
const rate = decided > 0 ? wins / decided : 0;
console.log(
  `current Laner vs ${ref}: ${wins} wins, ${losses} losses, ${draws} draws over ${seeds} seeds; ` +
    `${Math.round(rate * 100)}% of decided matches; ${rate >= BAR ? 'PASS' : 'FAIL'} at ${BAR * 100}%`,
);
process.exit(rate >= BAR ? 0 : 1);
