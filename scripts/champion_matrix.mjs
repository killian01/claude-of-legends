// The champion matrix (docs/design/roster.md): every champion against every
// other, in the working tree's sim. The two teams draw the SAME house
// styles seat for seat and play the same seed from both sides, so the only
// thing that differs between them is the champion, and the win rate is the
// kit's.
//
// Two modes, because they answer different questions:
//   --mode seat (default)  one seat of an ordinary five differs, the rest
//     of the lineup identical on both teams. This is the champion as it is
//     actually played, next to four teammates who cover for it, and it is
//     the number a balance pass should move.
//   --mode field  five of the champion against five of the other. It reads
//     a kit's self-sufficiency, not its balance: a team of five tanks has
//     nothing to kill with and a team of five marksmen has nothing to hide
//     behind, so the order it prints is closer to "how much damage at what
//     range" than to "how strong is this champion".
// Usage:
//   node scripts/champion_matrix.mjs [--mode seat|field] [--seeds 4]
//     [--from 1] [--max-ticks 48000] [--workers N] [--only a,b,c]
//     [--dist dist-champions]

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
const seeds = Number(opt('--seeds', '4'));
const firstSeed = Number(opt('--from', '1'));
const maxTicks = Number(opt('--max-ticks', String(20 * 60 * 40)));
const only = opt('--only', '');
const mode = opt('--mode', 'seat');
const distName = opt('--dist', 'dist-champions');
const root = process.cwd();
const dist = path.join(root, distName);
const bundle = path.join(dist, 'champions.cjs');

// The towers one side starts with (src/sim/content/map.ts), so a game says
// how far it got and not only who took the last one.
const TOWERS_A_SIDE = 8;
const TEAM = 5;

// The two lineups a match seats. In field mode a side is five of its own
// champion. In seat mode both sides take the seed's own fill lineup and one
// seat is replaced: if the champion under test is already in that lineup,
// the slot it was in takes the champion it displaced, so a team is still
// five different champions.
function lineupsFor(mod, rng, a, b, seat) {
  if (mode === 'field') {
    return [Array.from({ length: TEAM }, () => a), Array.from({ length: TEAM }, () => b)];
  }
  const base = mod.fillTeam([], rng);
  return [a, b].map((champion) => {
    const line = [...base];
    const held = line.indexOf(champion);
    if (held >= 0) line[held] = line[seat];
    line[seat] = champion;
    return line;
  });
}

// One pairing over the seeds, mirrored. The styles are drawn once per match
// and handed to both teams in the same order: two brains of the same make
// on both sides, so what is left is the champion.
function playPair(mod, a, b) {
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  const made = { killsA: 0, killsB: 0, towersA: 0, towersB: 0, seconds: 0, games: 0 };
  for (let seed = firstSeed; seed < firstSeed + seeds; seed++) {
    for (const teamA of [0, 1]) {
      const sim = new mod.Sim(seed);
      const styleRng = new mod.Rng(seed);
      const styles = Array.from({ length: TEAM }, () => mod.drawHouseStyle(styleRng));
      // The seat under test walks the team across the seeds, so a champion
      // is measured in more than one lane.
      const [lineA, lineB] = lineupsFor(mod, new mod.Rng(seed + 1), a, b, seed % TEAM);
      for (const team of [0, 1]) {
        const line = team === teamA ? lineA : lineB;
        for (let i = 0; i < TEAM; i++) {
          const unit = sim.addChampion(team, undefined, line[i], i % 3);
          unit.sigils = ['riftstep', 'mend'];
          const style = mod.HOUSE_STYLES.find((s) => s.id === styles[i]);
          sim.attachPolicy(unit.id, style.policy);
        }
      }
      while (sim.winner === null && sim.tickCount < maxTicks) sim.tick();
      const standing = [0, 0];
      for (const u of sim.units.values()) {
        const isA = u.team === teamA;
        if (u.kind === 'champion') {
          if (isA) made.killsA += u.kills;
          else made.killsB += u.kills;
        } else if (u.kind === 'tower' && !u.dead) {
          standing[isA ? 0 : 1] += 1;
        }
      }
      made.towersA += TOWERS_A_SIDE - standing[1];
      made.towersB += TOWERS_A_SIDE - standing[0];
      made.seconds += sim.time;
      made.games += 1;
      if (sim.winner === null) draws++;
      else if (sim.winner === teamA) winsA++;
      else winsB++;
    }
  }
  return { a, b, winsA, winsB, draws, made };
}

if (!isMainThread) {
  const require = createRequire(import.meta.url);
  const mod = require(workerData.bundle);
  parentPort.postMessage(workerData.pairs.map(([a, b]) => playPair(mod, a, b)));
} else {
  const { build } = await import('esbuild');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    path.join(dist, 'champions.ts'),
    [
      "export { Sim } from '../src/sim/sim';",
      "export { fillTeam } from '../src/sim/fill';",
      "export { Rng } from '../src/sim/rng';",
      "export { CHAMPION_LIST } from '../src/sim/content/champions';",
      "export { HOUSE_STYLES, drawHouseStyle } from '../src/sim/content/bots/house';",
      '',
    ].join('\n'),
  );
  await build({
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    logLevel: 'silent',
    entryPoints: [path.join(dist, 'champions.ts')],
    outfile: bundle,
  });
  const require = createRequire(import.meta.url);
  const mod = require(bundle);
  const wanted = only ? only.split(',').map((s) => s.trim()) : null;
  const roster = mod.CHAMPION_LIST.filter((c) => !wanted || wanted.includes(c.id));
  const ids = roster.map((c) => c.id);
  const allPairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) allPairs.push([ids[i], ids[j]]);
  }
  const workers = Math.max(
    1,
    Math.min(Number(opt('--workers', String(os.cpus().length - 1))), allPairs.length),
  );
  const buckets = Array.from({ length: workers }, () => []);
  for (const [i, p] of allPairs.entries()) buckets[i % workers].push(p);
  const started = Date.now();
  console.log(
    `champion matrix (${mode}): ${ids.length} champions, ${allPairs.length} pairings, ${seeds} seeds ` +
      `mirrored (${seeds * 2} games a pairing, ${allPairs.length * seeds * 2} in all), ` +
      `${workers} worker(s)`,
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

  const rate = new Map();
  const tally = Object.fromEntries(ids.map((id) => [id, { w: 0, l: 0, d: 0 }]));
  let seconds = 0;
  let games = 0;
  for (const r of results) {
    const decided = r.winsA + r.winsB;
    rate.set(`${r.a}>${r.b}`, decided > 0 ? r.winsA / decided : 0.5);
    rate.set(`${r.b}>${r.a}`, decided > 0 ? r.winsB / decided : 0.5);
    tally[r.a].w += r.winsA;
    tally[r.a].l += r.winsB;
    tally[r.a].d += r.draws;
    tally[r.b].w += r.winsB;
    tally[r.b].l += r.winsA;
    tally[r.b].d += r.draws;
    seconds += r.made.seconds;
    games += r.made.games;
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nrow beats column, as a rate of decided games`);
  console.log(`${pad('', 10)}${ids.map((id) => pad(id, 9)).join('')}`);
  for (const a of ids) {
    const cells = ids.map((b) =>
      a === b ? pad('.', 9) : pad(`${Math.round(rate.get(`${a}>${b}`) * 100)}%`, 9),
    );
    console.log(`${pad(a, 10)}${cells.join('')}`);
  }
  // The field rate: one champion's wins over its decided games against the
  // whole roster. This is the number a balance pass moves.
  const field = ids
    .map((id) => {
      const t = tally[id];
      const decided = t.w + t.l;
      return { id, pct: decided > 0 ? (t.w / decided) * 100 : 50, t };
    })
    .sort((x, y) => y.pct - x.pct);
  console.log('\nagainst the field');
  for (const f of field) {
    console.log(`${pad(f.id, 10)}${f.pct.toFixed(1).padStart(5)}%  (${f.t.w}-${f.t.l}-${f.t.d})`);
  }
  const top = field[0];
  const bottom = field[field.length - 1];
  console.log(
    `\nspread: ${top.id} ${top.pct.toFixed(1)}% to ${bottom.id} ${bottom.pct.toFixed(1)}%, ` +
      `${(top.pct - bottom.pct).toFixed(1)} points apart; ` +
      `a game ran ${Math.round(games > 0 ? seconds / games : 0)}s of match time; ` +
      `${Math.round((Date.now() - started) / 1000)}s wall`,
  );
}
