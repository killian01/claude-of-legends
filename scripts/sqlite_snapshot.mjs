// A consistent copy of one live SQLite store, for scripts/backup_game_data.sh.
//
// VACUUM INTO rather than a file copy: the game writes to these stores while
// the backup runs, and a plain copy of an open WAL database is a torn file.
// This reads the source inside one transaction, folds the WAL in, and writes a
// complete database to the destination. The source is never modified.
//
//   node scripts/sqlite_snapshot.mjs <source.sqlite3> <dest.sqlite3>

import { DatabaseSync } from 'node:sqlite';

const [source, dest] = process.argv.slice(2);
if (!source || !dest) {
  console.error('usage: sqlite_snapshot.mjs <source> <dest>');
  process.exit(2);
}

// The destination is a SQL string literal, so it wears single quotes and
// doubles any of its own. JSON.stringify would spell it with double quotes,
// which SQLite reads as an identifier and refuses.
function sqlString(value) {
  return `'${value.split("'").join("''")}'`;
}

try {
  // Read-only: a backup must never be able to write to the live store.
  const db = new DatabaseSync(source, { readOnly: true });
  db.exec(`VACUUM INTO ${sqlString(dest)}`);
  db.close();
} catch (err) {
  console.error(`snapshot of ${source} failed: ${err.message}`);
  process.exit(1);
}
