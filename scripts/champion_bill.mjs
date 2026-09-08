// The roster's bill (src/sim/forge/budget.ts, the balance authority): what
// each of the ten champions spends of the Kit envelope, itemized by the
// passive and the four spells, with its reaches beside it. The Forge prices
// a forged champion this way and refuses it over the line; the roster is
// the calibration set, so this is the same scale the whole game is balanced
// on, printed for the roster itself.
//
// Read it as headroom: a champion far under the line has power owed to it,
// and the cheapest power to hand back is reach (a longer skillshot
// multiplies a payload already paid for). Usage:
//   node scripts/champion_bill.mjs [--dist dist-champions-bill]

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const dist = path.join(process.cwd(), opt('--dist', 'dist-champions-bill'));
const bundle = path.join(dist, 'bill.cjs');
const KEYS = ['Q', 'W', 'E', 'R'];

const { build } = await import('esbuild');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
writeFileSync(
  path.join(dist, 'bill.ts'),
  [
    "export { CHAMPION_LIST } from '../src/sim/content/champions';",
    "export { budgetOf } from '../src/sim/forge/budget';",
    "export { KIT_ENVELOPE, kitSpendOf } from '../src/sim/forge/envelopes';",
    "export { forgedTwin } from '../tests/forged_twins';",
    '',
  ].join('\n'),
);
await build({
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'silent',
  entryPoints: [path.join(dist, 'bill.ts')],
  outfile: bundle,
});
const mod = createRequire(import.meta.url)(bundle);

// The far edge of what a button touches: a skillshot's or a cone's length,
// a leap's landing distance, a zone's or a burst's cast range plus its rim
// (the same reading tests/champion_reach.test.ts gates).
function reachOf(a) {
  const s = a.spec;
  if (s.kind === 'skillshot' || s.kind === 'cone' || s.kind === 'dash') return s.range;
  if (s.kind === 'zone' || s.kind === 'burst') return a.castRange + s.radius;
  if (s.kind === 'self_or_ally') return Math.max(a.castRange, s.searchRadius ?? 0);
  return a.castRange;
}

const pad = (s, n) => String(s).padEnd(n);
const rows = mod.CHAMPION_LIST.map((c) => {
  const bill = mod.budgetOf(mod.forgedTwin(c));
  return { c, bill, kit: mod.kitSpendOf(bill) };
}).sort((x, y) => y.kit - x.kit);

console.log(`the kit envelope holds ${mod.KIT_ENVELOPE} points\n`);
console.log(
  `${pad('champion', 10)}${pad('role', 12)}${pad('kit', 6)}${pad('head', 6)}` +
    `${pad('passive', 8)}${KEYS.map((k) => pad(k, 6)).join('')}reaches`,
);
for (const { c, bill, kit } of rows) {
  console.log(
    `${pad(c.id, 10)}${pad(c.role, 12)}${pad(kit.toFixed(0), 6)}` +
      `${pad((mod.KIT_ENVELOPE - kit).toFixed(0), 6)}${pad(bill.passive.toFixed(0), 8)}` +
      `${KEYS.map((k) => pad(bill.abilities[k].toFixed(0), 6)).join('')}` +
      `attack ${c.base.attackRange}, ` +
      KEYS.map((k) => `${k} ${reachOf(c.abilities[k]).toFixed(1)}`).join(' '),
  );
}
const top = rows[0];
const bottom = rows[rows.length - 1];
console.log(
  `\n${top.c.id} sets the ceiling at ${top.kit.toFixed(0)}; ${bottom.c.id} is the ` +
    `cheapest kit at ${bottom.kit.toFixed(0)}, ${(top.kit - bottom.kit).toFixed(0)} points ` +
    'of the same envelope behind it.',
);
