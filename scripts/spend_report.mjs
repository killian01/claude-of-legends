// The calibration report (ADR 0017): what every paid act has actually
// cost, read off the append-only spend log the server writes.
//
//   node scripts/spend_report.mjs <path to forge.sqlite3> [usd per tripo credit] [days]
//
// In production the store lives inside the container:
//   docker compose cp scripts/spend_report.mjs game:/tmp/r.mjs
//   docker compose exec game node /tmp/r.mjs /app/data/forge.sqlite3 0.02
//
// The price of a Tripo credit is an argument and not a constant: it is
// what the maintainer paid, it is on no public endpoint, and a guess at
// the bottom of the table would make every number above it a guess too.
// Without it the Tripo rows still report exact credits, and only their
// dollars are left blank.

import { DatabaseSync } from 'node:sqlite';

const [file, creditArg, daysArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/spend_report.mjs <forge.sqlite3> [usd/credit] [days]');
  process.exit(2);
}
const creditUsd = creditArg === undefined ? null : Number(creditArg);
const days = daysArg === undefined ? 30 : Number(daysArg);
const since = Date.now() - days * 24 * 60 * 60 * 1000;

// Anthropic list prices for claude-sonnet-5 per million tokens, read
// 2026-09-05. Kept beside the report, never in the running server.
const RATE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const usd = (n) => (n === null ? '        ?' : `$${n.toFixed(4).padStart(8)}`);

const db = new DatabaseSync(file, { readOnly: true });
const rows = db.prepare('select * from spend_samples where at > ? order by at').all(since);

if (rows.length === 0) {
  console.log(`no samples in the last ${days} days: play the surfaces, then read this again`);
  process.exit(0);
}

const lines = new Map();
for (const r of rows) {
  const key = `${r.action}/${r.detail}`;
  const line = lines.get(key) ?? {
    key,
    provider: r.provider,
    n: 0,
    units: 0,
    cost: 0,
    priced: true,
  };
  line.n += 1;
  if (r.provider === 'tripo') {
    line.units += r.credits ?? 0;
    if (creditUsd === null) line.priced = false;
    else line.cost += (r.credits ?? 0) * creditUsd;
  } else {
    const tok =
      ((r.input_tokens ?? 0) * RATE.input +
        (r.output_tokens ?? 0) * RATE.output +
        (r.cache_read_tokens ?? 0) * RATE.cacheRead +
        (r.cache_write_tokens ?? 0) * RATE.cacheWrite) /
      1_000_000;
    line.units +=
      (r.input_tokens ?? 0) +
      (r.output_tokens ?? 0) +
      (r.cache_read_tokens ?? 0) +
      (r.cache_write_tokens ?? 0);
    line.cost += tok;
  }
  lines.set(key, line);
}

const all = [...lines.values()].sort((a, b) => (b.priced ? b.cost : 0) - (a.priced ? a.cost : 0));
console.log(`${rows.length} samples over ${days} days\n`);
console.log('act                       n   units    total     each   relative');
for (const l of all) {
  const each = l.priced ? l.cost / l.n : null;
  console.log(
    `${l.key.padEnd(22)} ${String(l.n).padStart(4)}  ${String(Math.round(l.units)).padStart(7)}` +
      `  ${usd(l.priced ? l.cost : null)} ${usd(each)}`,
  );
}
const cheapest = all
  .filter((l) => l.priced)
  .map((l) => l.cost / l.n)
  .filter((c) => c > 0);
if (cheapest.length > 0) {
  const floor = Math.min(...cheapest);
  console.log('\nin embers, if the cheapest act is worth one:');
  for (const l of all) {
    if (!l.priced) {
      console.log(`  ${l.key.padEnd(22)} unpriced (give the report a usd/credit)`);
      continue;
    }
    console.log(`  ${l.key.padEnd(22)} ${(l.cost / l.n / floor).toFixed(1)}`);
  }
}
if (creditUsd === null) {
  console.log('\nno usd/credit given: Tripo rows are exact in credits and blank in dollars.');
}
