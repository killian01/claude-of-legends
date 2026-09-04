// One-shot repair for match logs written before the fix in server/records.ts:
// an unrated match used to write a ratingDelta of zero on every owned seat,
// and everything that counts rated play reads that field, so those matches
// were counted in the ladder's wins, losses and form and in the career.
//
// Strips ratingDelta from the seats of every record whose `rated` is not
// true. Records already correct are left byte for byte alone.
//
// Dry run by default, which is the whole point of a tool that edits a live
// log; --write makes the change after copying the file beside itself:
//   node scripts/fix_unrated_deltas.mjs [path/to/matches.jsonl]
//   node scripts/fix_unrated_deltas.mjs --write [path/to/matches.jsonl]

import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const write = args.includes('--write');
const file = args.find((a) => !a.startsWith('--')) ?? path.join('data', 'matches.jsonl');

const text = readFileSync(file, 'utf8');
const lines = text.split('\n');
let touchedRecords = 0;
let touchedSeats = 0;
let malformed = 0;

const out = lines.map((line) => {
  if (line.trim() === '') return line;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    // A truncated last line is the log's business, not this tool's.
    malformed++;
    return line;
  }
  if (rec.rated === true || !Array.isArray(rec.players)) return line;
  let hit = 0;
  for (const seat of rec.players) {
    if (seat && typeof seat === 'object' && 'ratingDelta' in seat) {
      delete seat.ratingDelta;
      hit++;
    }
  }
  if (hit === 0) return line;
  touchedRecords++;
  touchedSeats += hit;
  return JSON.stringify(rec);
});

console.log(`${file}: ${lines.filter((l) => l.trim() !== '').length} records`);
console.log(`unrated records carrying a delta: ${touchedRecords} (${touchedSeats} seats)`);
if (malformed > 0) console.log(`unparsable lines left alone: ${malformed}`);
if (!write) {
  console.log('dry run; pass --write to apply');
  process.exit(0);
}
if (touchedRecords === 0) {
  console.log('nothing to write');
  process.exit(0);
}
copyFileSync(file, `${file}.bak`);
// Written beside and renamed, so a crash never leaves half a log.
const tmp = `${file}.tmp`;
writeFileSync(tmp, out.join('\n'));
renameSync(tmp, file);
console.log(`written; the log as it was is ${file}.bak`);
