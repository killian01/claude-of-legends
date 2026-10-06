// What the seat reports say (server/seat_report.ts): one line per seat a
// person held online, newest last, then the shape of them all. Reads
// seats.jsonl under the data directory.
//
//   node scripts/seat_report.mjs /var/lib/docker/volumes/claude-of-legends_game_data/_data
//   node scripts/seat_report.mjs <data dir> 3        the last 3 days only
//   node scripts/seat_report.mjs <data dir> 3 CH     ...leaving one country out
//
// Read-only. No name is in the file and none is printed.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/seat_report.mjs <data dir> [days] [country to leave out]');
  process.exit(2);
}
const days = process.argv[3] === undefined ? 0 : Number(process.argv[3]);
const skip = process.argv[4] ?? null;
let text = '';
try {
  text = readFileSync(path.join(dir, 'seats.jsonl'), 'utf8');
} catch {
  console.log(`no seat reports under ${dir} yet`);
  process.exit(0);
}
const cut = days > 0 ? Date.now() - days * 24 * 3600 * 1000 : 0;
const rows = [];
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  try {
    const r = JSON.parse(line);
    if (r.at >= cut && (skip === null || r.country !== skip)) rows.push(r);
  } catch {
    // a torn line is skipped
  }
}
if (rows.length === 0) {
  console.log('no seat reports in that window');
  process.exit(0);
}
const pad = (v, n) => String(v ?? '-').padEnd(n);
// The seat's first moments and its frame rate (version 2 lines on), and
// how finely the page drew (version 3 on): the step it last stood on and
// the deepest of the seat (a match may start below the top, where its last
// one left it), the lean level (1 no effect lights, 2 no antialiasing either),
// the ratio, the picture's pixels, and no shadows when they were off.
function moments(r) {
  if (r.v < 2) return '';
  const at = (label, s) => (s === null || s === undefined ? '' : ` ${label}@${s}s`);
  const fps = r.fps === null ? '' : ` fps ${r.fps} (low ${r.fpsLow})`;
  const mode = r.variant ? ` ${r.variant}` : ` ${r.queue}`;
  return ` |${mode}${at('hit', r.firstHitS)}${at('hurt', r.firstHurtS)}${at('takedown', r.firstTakedownS)}${at('cache', r.firstCacheS)}${at('died', r.diedS)}${fps}${drawn(r)}`;
}
function drawn(r) {
  if (r.v < 3 || r.step === null || r.step === undefined) return '';
  const lean = r.lean > 0 ? ` lean ${r.lean}` : '';
  return ` step ${r.step} (deep ${r.stepDeep})${lean} x${r.ratio} ${r.px}${r.shadows ? '' : ' no shadows'}`;
}
console.log(
  `${pad('when (UTC)', 12)}${pad('cc', 4)}${pad('dev', 7)}${pad('who', 6)}${pad('how', 7)}${pad('held', 7)}${pad('load', 6)}${pad('1st', 6)}${pad('orders', 7)}${pad('walked', 7)}${pad('pts', 5)}${pad('cs', 4)}${pad('k/d/a', 7)}ping (max)  orders by kind | first steps`,
);
for (const r of rows) {
  const when = new Date(r.at).toISOString().slice(5, 16).replace('T', ' ');
  console.log(
    `${pad(when, 12)}${pad(r.country, 4)}${pad(r.mobile ? 'phone' : 'pc', 7)}${pad(r.guest ? 'guest' : 'acct', 6)}${pad(r.how, 7)}${pad(`${r.heldS}s`, 7)}${pad(r.loadS === null ? '-' : `${r.loadS}s`, 6)}${pad(r.firstOrderS === null ? '-' : `${r.firstOrderS}s`, 6)}${pad(r.orders, 7)}${pad(`${r.walkedM}m`, 7)}${pad(r.points, 5)}${pad(r.cs, 4)}${pad(`${r.kills}/${r.deaths}/${r.assists}`, 7)}${pad(r.pingMs === null ? '-' : `${r.pingMs} ms (${r.pingMaxMs})`, 12)}${Object.entries(
      r.kinds ?? {},
    )
      .map(([k, n]) => `${k}:${n}`)
      .join(' ')}${r.steps?.length ? ` | ${r.steps.join(' ')}` : ''}${moments(r)}`,
  );
}
const med = (xs) => {
  const s = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (s.length === 0) return '-';
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const share = (n) => `${n}/${rows.length} (${Math.round((100 * n) / rows.length)}%)`;
console.log('');
console.log(`seats: ${rows.length}`);
console.log(
  `median held: ${med(rows.map((r) => r.heldS))} s, median load: ${med(rows.map((r) => r.loadS))} s`,
);
console.log(`gave at least one order: ${share(rows.filter((r) => r.orders > 0).length)}`);
console.log(`median first order: ${med(rows.map((r) => r.firstOrderS))} s after the seat started`);
console.log(`walked more than 20 m: ${share(rows.filter((r) => r.walkedM > 20).length)}`);
console.log(`scored a point: ${share(rows.filter((r) => r.points > 0).length)}`);
console.log(`left by closing the tab: ${share(rows.filter((r) => r.how === 'closed').length)}`);
const v2 = rows.filter((r) => r.v >= 2);
if (v2.length > 0) {
  const within = (key, s) => v2.filter((r) => r[key] !== null && r[key] <= s).length;
  console.log(
    `since the first moments are told (${v2.length} seats): a blow given within 30 s ${within('firstHitS', 30)}, taken within 30 s ${within('firstHurtS', 30)}, a cache within 60 s ${within('firstCacheS', 60)}, a takedown at all ${v2.filter((r) => r.firstTakedownS !== null).length}; median fps ${med(v2.map((r) => r.fps))}`,
  );
}
const v3 = rows.filter((r) => r.v >= 3 && r.step !== null && r.step !== undefined);
if (v3.length > 0) {
  const mpx = (px) => {
    const [w, h] = String(px).split('x').map(Number);
    return Math.round((w * h) / 1e4) / 100;
  };
  console.log(
    `since the quality step is told (${v3.length} seats): below the top at some point ${v3.filter((r) => r.stepDeep > 0).length}, still below at the end ${v3.filter((r) => r.step > 0).length}, lean ${v3.filter((r) => r.lean > 0).length}, median megapixels ${med(v3.map((r) => mpx(r.px)))}`,
  );
}
const byCountry = new Map();
for (const r of rows) {
  const k = r.country ?? '??';
  if (!byCountry.has(k)) byCountry.set(k, []);
  byCountry.get(k).push(r);
}
console.log('');
console.log('by country: seats, median held, median ping');
for (const [k, rs] of [...byCountry].sort((a, b) => b[1].length - a[1].length)) {
  console.log(
    `  ${pad(k, 4)}${pad(rs.length, 4)}${pad(`${med(rs.map((r) => r.heldS))} s`, 9)}${med(rs.map((r) => r.pingMs))} ms`,
  );
}
