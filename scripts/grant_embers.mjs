// Put embers on an account by hand (ADR 0017), for the times the ledger
// needs a maintainer: a refund the code missed, a gift, a test account.
//
//   node scripts/grant_embers.mjs --account monsieur-connard --embers 91
//   node scripts/grant_embers.mjs --account 11 --embers 91 --apply
//
// It prints what it would do and changes nothing until --apply. The ledger
// is append-only and balances are derived from it, so this writes one row
// and never edits a balance; undoing it is deleting that row, whose id is
// printed.
//
// --reason names the entry. It refuses `weekly_grant` on purpose: the
// weekly allocation paces itself off the last entry carrying that reason
// (server/forge.ts), so borrowing it here would quietly push the account's
// next automatic grant back a week.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const DATA_DIR = opt('data-dir', process.env.DATA_DIR ?? 'data');
const who = opt('account');
const embers = Number(opt('embers'));
const reason = opt('reason', 'maintainer_grant');
const apply = args.includes('--apply');

if (!who || !Number.isFinite(embers) || embers === 0) {
  console.error('usage: --account <id|name> --embers <n> [--reason r] [--data-dir d] [--apply]');
  process.exit(2);
}
if (reason === 'weekly_grant') {
  console.error("refusing --reason weekly_grant: it would delay the account's next weekly grant");
  process.exit(2);
}

const accountsFile = path.join(DATA_DIR, 'accounts.json');
const dbFile = path.join(DATA_DIR, 'forge.sqlite3');
for (const f of [accountsFile, dbFile]) {
  if (!existsSync(f)) {
    console.error(`no ${f}: is --data-dir right?`);
    process.exit(2);
  }
}

// A name is what a maintainer has; an id is what the ledger holds.
const parsed = JSON.parse(readFileSync(accountsFile, 'utf8'));
const accounts = Array.isArray(parsed) ? parsed : (parsed.accounts ?? []);
const account = /^\d+$/.test(who)
  ? accounts.find((a) => String(a.id) === who)
  : accounts.find((a) => a.name === who);
if (!account) {
  console.error(`no account "${who}" in ${accountsFile}`);
  process.exit(1);
}

const db = new DatabaseSync(dbFile);
const balance = () =>
  db
    .prepare('select coalesce(sum(delta), 0) as b from credits where account_id = ?')
    .get(account.id).b;
const weeklyAt = () =>
  db
    .prepare("select max(at) as a from credits where account_id = ? and reason = 'weekly_grant'")
    .get(account.id).a;

const before = balance();
const weeklyBefore = weeklyAt();
console.log(`${account.name} (id ${account.id}): ${before} embers`);
console.log(
  `${apply ? 'writing' : 'would write'} ${embers > 0 ? '+' : ''}${embers}, reason "${reason}"`,
);
console.log(`balance would become ${before + embers}`);

if (!apply) {
  console.log('nothing written. Add --apply to do it.');
  process.exit(0);
}

const at = Date.now();
db.prepare('insert into credits (account_id, delta, reason, ref, at) values (?, ?, ?, ?, ?)').run(
  account.id,
  embers,
  reason,
  null,
  at,
);
const id = db.prepare('select last_insert_rowid() as id').get().id;
console.log(`entry ${id} written at ${new Date(at).toISOString()}`);
console.log(`balance is now ${balance()}`);
console.log(`weekly pacing untouched: ${weeklyBefore === weeklyAt()}`);
console.log(`to undo: delete from credits where id = ${id}`);
