// What players wrote in the feedback box, one message per block, newest
// last. Reads feedback.jsonl under the data directory and prints it.
//
//   node scripts/feedback.mjs /var/lib/docker/volumes/claude-of-legends_game_data/_data
//   node scripts/feedback.mjs <data dir> 7      the last 7 days only
//
// Read-only. No name is in the file and none is printed.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/feedback.mjs <data dir> [days]');
  process.exit(2);
}
const days = process.argv[3] === undefined ? 0 : Number(process.argv[3]);
let text = '';
try {
  text = readFileSync(path.join(dir, 'feedback.jsonl'), 'utf8');
} catch {
  console.log(`no feedback under ${dir} yet`);
  process.exit(0);
}
const cut = days > 0 ? Date.now() - days * 24 * 3600 * 1000 : 0;
const rows = [];
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  try {
    const r = JSON.parse(line);
    if (typeof r.at === 'number' && r.at >= cut && typeof r.text === 'string') rows.push(r);
  } catch {
    // A torn line.
  }
}
if (rows.length === 0) {
  console.log(`no feedback${days > 0 ? ` in the last ${days} days` : ''}`);
  process.exit(0);
}
console.log(`${rows.length} message${rows.length === 1 ? '' : 's'}\n`);
for (const r of rows) {
  const when = new Date(r.at).toISOString().slice(0, 16).replace('T', ' ');
  const who = r.signedIn ? 'account' : 'visitor';
  const match = `${r.mode}, ${r.minutes} min, ${r.finished ? 'played through' : 'left'}`;
  const where = r.where === 'end' ? 'end screen' : 'pause menu';
  console.log(`${when}  ${who}, ${match}, from the ${where}`);
  for (const line of r.text.split('\n')) console.log(`    ${line}`);
  console.log('');
}
