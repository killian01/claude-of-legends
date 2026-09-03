// The meta matrix (docs/design/bots.md, the ladder's depth): every house
// style against every other, a team of five on each side, on the fill's
// lineups drawn from fixed seeds and mirrored (each seed played from both
// sides), in the working tree's sim. Prints the win matrix and reads it:
// a cyclic matrix (A beats B beats C beats A) is a ladder with depth; a
// transitive one (one style beats every other) is a ladder one playbook
// solves. Usage:
//   node scripts/meta_matrix.mjs [--seeds 10] [--from 1] [--max-ticks 48000]
//     [--workers N] [--dist dist-matrix]
// Matches run in worker threads, one pair of styles per worker.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const seeds = Number(opt('--seeds', '10'));
const firstSeed = Number(opt('--from', '1'));
const maxTicks = Number(opt('--max-ticks', String(20 * 60 * 40)));
const distName = opt('--dist', 'dist-matrix');
const root = process.cwd();
const dist = path.join(root, distName);
const bundle = path.join(dist, 'matrix.cjs');

// One pair of styles over the seeds, mirrored: returns wins for A, for B,
// draws, and the pairs (both, split, none) from A's side.
function playPair(mod, a, b) {
  const styleA = mod.HOUSE_STYLES.find((s) => s.id === a);
  const styleB = mod.HOUSE_STYLES.find((s) => s.id === b);
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  const pairs = { both: 0, split: 0, none: 0 };
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    let seedWinsA = 0;
    for (const teamA of [0, 1]) {
      const sim = new mod.Sim(seed);
      const rng = new mod.Rng(seed);
      for (const team of [0, 1]) {
        for (const [i, championId] of mod.fillTeam([], rng).entries()) {
          const unit = sim.addChampion(team, undefined, championId, i % 3);
          unit.sigils = ['riftstep', 'mend'];
          sim.attachPolicy(unit.id, team === teamA ? styleA.policy : styleB.policy);
        }
      }
      while (sim.winner === null && sim.tickCount < maxTicks) sim.tick();
      if (sim.winner === null) draws++;
      else if (sim.winner === teamA) {
        winsA++;
        seedWinsA++;
      } else winsB++;
    }
    if (seedWinsA === 2) pairs.both++;
    else if (seedWinsA === 1) pairs.split++;
    else pairs.none++;
  }
  return { a, b, winsA, winsB, draws, pairs };
}

if (!isMainThread) {
  const require = createRequire(import.meta.url);
  const mod = require(workerData.bundle);
  const out = workerData.pairs.map(([a, b]) => playPair(mod, a, b));
  parentPort.postMessage(out);
} else {
  const { build } = await import('esbuild');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    path.join(dist, 'matrix.ts'),
    [
      "export { Sim } from '../src/sim/sim';",
      "export { fillTeam } from '../src/sim/fill';",
      "export { Rng } from '../src/sim/rng';",
      "export { HOUSE_STYLES } from '../src/sim/content/bots/house';",
      '',
    ].join('\n'),
  );
  await build({
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    logLevel: 'silent',
    entryPoints: [path.join(dist, 'matrix.ts')],
    outfile: bundle,
  });
  const require = createRequire(import.meta.url);
  const mod = require(bundle);
  const ids = mod.HOUSE_STYLES.map((s) => s.id);
  const names = Object.fromEntries(mod.HOUSE_STYLES.map((s) => [s.id, s.name]));
  const allPairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) allPairs.push([ids[i], ids[j]]);
  }
  const workers = Math.max(
    1,
    Math.min(Number(opt('--workers', String(os.cpus().length - 1))), allPairs.length),
  );
  const buckets = Array.from({ length: workers }, () => []);
  allPairs.forEach((p, i) => buckets[i % workers].push(p));
  const started = Date.now();
  console.log(
    `meta matrix: ${ids.length} styles, ${allPairs.length} pairs, ${seeds} seeds mirrored ` +
      `(${seeds * 2} games a pair), ${workers} worker(s)`,
  );
  const results = (
    await Promise.all(
      buckets
        .filter((b) => b.length > 0)
        .map(
          (pairs) =>
            new Promise((resolve, reject) => {
              const w = new Worker(fileURLToPath(import.meta.url), {
                workerData: { bundle, pairs },
                argv: args,
              });
              w.on('message', resolve);
              w.on('error', reject);
            }),
        ),
    )
  ).flat();

  // The matrix: row beats column, as a rate of decided games.
  const rate = new Map();
  for (const r of results) {
    const decided = r.winsA + r.winsB;
    rate.set(`${r.a}>${r.b}`, decided > 0 ? r.winsA / decided : 0.5);
    rate.set(`${r.b}>${r.a}`, decided > 0 ? r.winsB / decided : 0.5);
    console.log(
      `${names[r.a]} vs ${names[r.b]}: ${r.winsA}-${r.winsB}-${r.draws} ` +
        `(pairs both ${r.pairs.both}, split ${r.pairs.split}, none ${r.pairs.none})`,
    );
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\n${pad('row beats column', 18)}${ids.map((id) => pad(names[id], 12)).join('')}`);
  for (const a of ids) {
    const cells = ids.map((b) =>
      a === b ? pad('.', 12) : pad(`${Math.round(rate.get(`${a}>${b}`) * 100)}%`, 12),
    );
    console.log(`${pad(names[a], 18)}${cells.join('')}`);
  }
  // Reading: a style "beats" another past 55% of decided games. A cycle
  // among the beats is depth; a total order is a solved ladder.
  const beats = (a, b) => rate.get(`${a}>${b}`) >= 0.55;
  const score = Object.fromEntries(
    ids.map((a) => [a, ids.filter((b) => b !== a && beats(a, b)).length]),
  );
  const order = [...ids].sort((x, y) => score[y] - score[x]);
  let cyclic = false;
  for (const a of ids) {
    for (const b of ids) {
      for (const c of ids) {
        if (a !== b && b !== c && a !== c && beats(a, b) && beats(b, c) && beats(c, a))
          cyclic = true;
      }
    }
  }
  const dominant = ids.find((a) => ids.every((b) => a === b || beats(a, b)));
  console.log(
    `\nreading: ${cyclic ? 'CYCLIC (the styles counter each other: depth)' : 'no cycle'}` +
      `${dominant ? `; ${names[dominant]} beats every other style (a solved ladder)` : '; no style beats every other'}` +
      `; by wins over 55%: ${order.map((a) => `${names[a]} ${score[a]}`).join(', ')}` +
      `; ${Math.round((Date.now() - started) / 1000)}s`,
  );
}
