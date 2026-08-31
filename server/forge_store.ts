// The Forge's own store (ADR 0011): SQLite via node:sqlite, one file under
// DATA_DIR, holding exactly the Forge domain: forged champions, the
// creation ledger, and generation jobs. Accounts stay where they are
// (server/accounts.ts, JSON): rows here reference their ids as plain
// integers across the store boundary. Ledger-first economy: balances are
// never stored, only derived, so a grant, a spend, and a refund are all
// the same append.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { BASE_RATING } from './rating';

const SCHEMA = `
create table if not exists forged_champions (
  id text primary key,
  account_id integer not null,
  def text not null,
  status text not null check (status in ('draft', 'finalized')),
  assets text,
  created_at integer not null,
  updated_at integer not null,
  listed integer not null default 1,
  shared integer not null default 1,
  taken_down integer not null default 0
);
create table if not exists credits (
  id integer primary key autoincrement,
  account_id integer not null,
  delta integer not null,
  reason text not null,
  ref text,
  at integer not null
);
create table if not exists generation_jobs (
  id integer primary key autoincrement,
  forged_id text not null references forged_champions(id),
  account_id integer not null,
  status text not null check (status in ('running', 'success', 'failed')),
  stage text not null,
  error text,
  created_at integer not null,
  updated_at integer not null
);
create table if not exists forge_ratings (
  account_id integer primary key,
  rating integer not null,
  games integer not null
);
create table if not exists likes (
  account_id integer not null,
  forged_id text not null,
  at integer not null,
  primary key (account_id, forged_id)
);
create table if not exists reports (
  account_id integer not null,
  forged_id text not null,
  reason text not null,
  at integer not null,
  primary key (account_id, forged_id)
);
create table if not exists warnings (
  id integer primary key autoincrement,
  account_id integer not null,
  forged_id text not null,
  reason text not null,
  at integer not null
);
create table if not exists quota_events (
  id integer primary key autoincrement,
  account_id integer not null,
  action text not null,
  at integer not null
);
`;

export interface ForgedRow {
  id: string;
  accountId: number;
  def: ForgedChampionDef;
  status: 'draft' | 'finalized';
  createdAt: number;
  updatedAt: number;
  // Gallery visibility: on by default, the creator can remove and relist.
  listed: boolean;
  // "Others may play it": on by default (game definition of the gallery).
  shared: boolean;
  // Moderation takedown: hidden and unplayable everywhere until lifted.
  takenDown: boolean;
}

export interface CreditEntry {
  accountId: number;
  delta: number;
  // 'weekly_grant' | 'finalize' | 'refund' | ... : the ledger keeps the
  // string, policy lives with the callers.
  reason: string;
  ref?: string;
  at: number;
}

export interface GenerationJobRow {
  id: number;
  forgedId: string;
  accountId: number;
  status: 'running' | 'success' | 'failed';
  stage: string;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ForgedRawRow {
  id: string;
  account_id: number;
  def: string;
  status: 'draft' | 'finalized';
  created_at: number;
  updated_at: number;
  listed: number;
  shared: number;
  taken_down: number;
}

interface JobRawRow {
  id: number;
  forged_id: string;
  account_id: number;
  status: 'running' | 'success' | 'failed';
  stage: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

function toForged(r: ForgedRawRow): ForgedRow {
  return {
    id: r.id,
    accountId: r.account_id,
    def: JSON.parse(r.def) as ForgedChampionDef,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    listed: r.listed === 1,
    shared: r.shared === 1,
    takenDown: r.taken_down === 1,
  };
}

// Every column a ForgedRow is built from, shared by each select below so a
// new column cannot be forgotten in one of them.
const FORGED_COLS =
  'id, account_id, def, status, created_at, updated_at, listed, shared, taken_down';

function toJob(r: JobRawRow): GenerationJobRow {
  return {
    id: r.id,
    forgedId: r.forged_id,
    accountId: r.account_id,
    status: r.status,
    stage: r.stage,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class ForgeStore {
  private readonly db: DatabaseSync;

  // ':memory:' gives tests a real store with no disk.
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('pragma journal_mode = wal');
    this.db.exec(SCHEMA);
    // A store created before the gallery gains its columns in place;
    // create-if-not-exists alone never alters an existing table.
    this.ensureColumn('forged_champions', 'listed', 'listed integer not null default 1');
    this.ensureColumn('forged_champions', 'shared', 'shared integer not null default 1');
    this.ensureColumn('forged_champions', 'taken_down', 'taken_down integer not null default 0');
  }

  private ensureColumn(table: string, name: string, ddl: string): void {
    const cols = this.db.prepare(`pragma table_info(${table})`).all() as unknown as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === name)) this.db.exec(`alter table ${table} add column ${ddl}`);
  }

  close(): void {
    this.db.close();
  }

  // -- forged champions ---------------------------------------------------

  // Upserts a forged champion row. Validation is the caller's duty (the
  // deterministic validator gates every def before it is worth storing).
  // The gallery switches are not part of a save: they default on insert
  // and only setForgedVisibility and setTakenDown ever move them.
  saveForged(row: Omit<ForgedRow, 'listed' | 'shared' | 'takenDown'>): void {
    this.db
      .prepare(
        `insert into forged_champions (id, account_id, def, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict (id) do update set
           def = excluded.def, status = excluded.status, updated_at = excluded.updated_at`,
      )
      .run(
        row.id,
        row.accountId,
        JSON.stringify(row.def),
        row.status,
        row.createdAt,
        row.updatedAt,
      );
  }

  getForged(id: string): ForgedRow | null {
    const r = this.db.prepare(`select ${FORGED_COLS} from forged_champions where id = ?`).get(id) as
      | ForgedRawRow
      | undefined;
    return r ? toForged(r) : null;
  }

  listForgedByAccount(accountId: number): ForgedRow[] {
    const rows = this.db
      .prepare(
        `select ${FORGED_COLS} from forged_champions where account_id = ? order by created_at`,
      )
      .all(accountId) as unknown as ForgedRawRow[];
    return rows.map(toForged);
  }

  // The gallery's raw material: every finalized champion that is not taken
  // down, with its like count. Listing policy (listed, shared, search,
  // sort) lives with the callers in server/gallery.ts.
  listFinalized(): (ForgedRow & { likes: number })[] {
    const rows = this.db
      .prepare(
        `select ${FORGED_COLS.split(', ')
          .map((c) => `f.${c}`)
          .join(', ')},
           (select count(*) from likes l where l.forged_id = f.id) as likes
         from forged_champions f
         where f.status = 'finalized' and f.taken_down = 0
         order by f.updated_at desc`,
      )
      .all() as unknown as (ForgedRawRow & { likes: number })[];
    return rows.map((r) => ({ ...toForged(r), likes: r.likes }));
  }

  // The creator's two switches: gallery listing and "others may play it".
  setForgedVisibility(id: string, fields: { listed?: boolean; shared?: boolean }): void {
    const row = this.getForged(id);
    if (!row) return;
    this.db
      .prepare('update forged_champions set listed = ?, shared = ? where id = ?')
      .run((fields.listed ?? row.listed) ? 1 : 0, (fields.shared ?? row.shared) ? 1 : 0, id);
  }

  setTakenDown(id: string, down: boolean): void {
    this.db
      .prepare('update forged_champions set taken_down = ? where id = ?')
      .run(down ? 1 : 0, id);
  }

  deleteForged(id: string): void {
    this.db.prepare('delete from forged_champions where id = ?').run(id);
  }

  // Success in one write: the champion is sealed with its assets and
  // provenance, exactly once.
  setForgedFinalized(id: string, assets: unknown, now: number): void {
    this.db
      .prepare(
        `update forged_champions set status = 'finalized', assets = ?, updated_at = ? where id = ?`,
      )
      .run(JSON.stringify(assets), now, id);
  }

  forgedAssets(id: string): unknown {
    const r = this.db.prepare('select assets from forged_champions where id = ?').get(id) as
      | { assets: string | null }
      | undefined;
    if (!r?.assets) return null;
    try {
      return JSON.parse(r.assets);
    } catch {
      return null;
    }
  }

  // -- the creation ledger ------------------------------------------------

  addCreditEntry(entry: CreditEntry): void {
    this.db
      .prepare('insert into credits (account_id, delta, reason, ref, at) values (?, ?, ?, ?, ?)')
      .run(entry.accountId, entry.delta, entry.reason, entry.ref ?? null, entry.at);
  }

  creditBalance(accountId: number): number {
    const r = this.db
      .prepare('select coalesce(sum(delta), 0) as balance from credits where account_id = ?')
      .get(accountId) as { balance: number };
    return r.balance;
  }

  // When the account last received an entry with this reason; null when
  // never. What the weekly allocation refresh paces itself by.
  lastCreditEntryAt(accountId: number, reason: string): number | null {
    const r = this.db
      .prepare('select max(at) as at from credits where account_id = ? and reason = ?')
      .get(accountId, reason) as { at: number | null };
    return r.at;
  }

  // -- likes, reports, warnings (plan-forge phase 7) -----------------------

  // One like per account per champion; liking twice is a no-op, so is
  // unliking what was never liked.
  setLike(accountId: number, forgedId: string, on: boolean, at: number): void {
    if (on) {
      this.db
        .prepare(
          'insert into likes (account_id, forged_id, at) values (?, ?, ?) on conflict do nothing',
        )
        .run(accountId, forgedId, at);
    } else {
      this.db
        .prepare('delete from likes where account_id = ? and forged_id = ?')
        .run(accountId, forgedId);
    }
  }

  likeCount(forgedId: string): number {
    const r = this.db
      .prepare('select count(*) as n from likes where forged_id = ?')
      .get(forgedId) as { n: number };
    return r.n;
  }

  likedBy(accountId: number, forgedId: string): boolean {
    return (
      this.db
        .prepare('select 1 from likes where account_id = ? and forged_id = ?')
        .get(accountId, forgedId) !== undefined
    );
  }

  likedIds(accountId: number): Set<string> {
    const rows = this.db
      .prepare('select forged_id from likes where account_id = ?')
      .all(accountId) as unknown as { forged_id: string }[];
    return new Set(rows.map((r) => r.forged_id));
  }

  // One report per account per champion, first reason kept.
  addReport(accountId: number, forgedId: string, reason: string, at: number): void {
    this.db
      .prepare(
        `insert into reports (account_id, forged_id, reason, at) values (?, ?, ?, ?)
         on conflict do nothing`,
      )
      .run(accountId, forgedId, reason, at);
  }

  reportCount(forgedId: string): number {
    const r = this.db
      .prepare('select count(*) as n from reports where forged_id = ?')
      .get(forgedId) as { n: number };
    return r.n;
  }

  addWarning(accountId: number, forgedId: string, reason: string, at: number): void {
    this.db
      .prepare('insert into warnings (account_id, forged_id, reason, at) values (?, ?, ?, ?)')
      .run(accountId, forgedId, reason, at);
  }

  warningCount(accountId: number): number {
    const r = this.db
      .prepare('select count(*) as n from warnings where account_id = ?')
      .get(accountId) as { n: number };
    return r.n;
  }

  // -- daily quota events (plan-forge phase 8) -----------------------------
  // Append-only, like the credits ledger: usage is derived by counting a
  // window, never stored. Policy (limits, the window) lives in
  // server/quotas.ts.

  addQuotaEvent(accountId: number, action: string, at: number): void {
    this.db
      .prepare('insert into quota_events (account_id, action, at) values (?, ?, ?)')
      .run(accountId, action, at);
  }

  quotaCountSince(accountId: number, action: string, since: number): number {
    const r = this.db
      .prepare(
        'select count(*) as n from quota_events where account_id = ? and action = ? and at > ?',
      )
      .get(accountId, action, since) as { n: number };
    return r.n;
  }

  // Housekeeping: events older than the widest window will never be
  // counted again; dropping them keeps the table bounded.
  pruneQuotaEvents(before: number): number {
    const res = this.db.prepare('delete from quota_events where at <= ?').run(before);
    return Number(res.changes);
  }

  // -- the Forge queue's own rating (plan-forge phase 6) -------------------
  // Mirrors the account registry's Elo pair (rating, ratedGames) for the
  // Forge queue alone: same policy (server/rating.ts), separate ladder,
  // stored with the rest of the Forge domain (ADR 0011).

  forgeRating(accountId: number): { rating: number; games: number } {
    const r = this.db
      .prepare('select rating, games from forge_ratings where account_id = ?')
      .get(accountId) as { rating: number; games: number } | undefined;
    return r ?? { rating: BASE_RATING, games: 0 };
  }

  // One rated Forge-queue match landed; the delta is already signed.
  applyForgeRating(accountId: number, delta: number): void {
    const cur = this.forgeRating(accountId);
    this.db
      .prepare(
        `insert into forge_ratings (account_id, rating, games) values (?, ?, ?)
         on conflict (account_id) do update set rating = excluded.rating, games = excluded.games`,
      )
      .run(accountId, cur.rating + delta, cur.games + 1);
  }

  // A leaver penalty: rating drops without counting a game, exactly like
  // the classic ladder's penalize().
  penalizeForgeRating(accountId: number, amount: number): void {
    const cur = this.forgeRating(accountId);
    this.db
      .prepare(
        `insert into forge_ratings (account_id, rating, games) values (?, ?, ?)
         on conflict (account_id) do update set rating = excluded.rating`,
      )
      .run(accountId, cur.rating - amount, cur.games);
  }

  // -- generation jobs ----------------------------------------------------

  createGenerationJob(forgedId: string, accountId: number, now: number): number {
    const res = this.db
      .prepare(
        `insert into generation_jobs (forged_id, account_id, status, stage, created_at, updated_at)
         values (?, ?, 'running', 'queued', ?, ?)`,
      )
      .run(forgedId, accountId, now, now);
    return Number(res.lastInsertRowid);
  }

  updateGenerationJob(
    id: number,
    fields: { status?: 'running' | 'success' | 'failed'; stage?: string; error?: string },
    now: number,
  ): void {
    const existing = this.getGenerationJob(id);
    if (!existing) return;
    this.db
      .prepare(
        'update generation_jobs set status = ?, stage = ?, error = ?, updated_at = ? where id = ?',
      )
      .run(
        fields.status ?? existing.status,
        fields.stage ?? existing.stage,
        fields.error ?? existing.error,
        now,
        id,
      );
  }

  getGenerationJob(id: number): GenerationJobRow | null {
    const r = this.db
      .prepare(
        'select id, forged_id, account_id, status, stage, error, created_at, updated_at from generation_jobs where id = ?',
      )
      .get(id) as JobRawRow | undefined;
    return r ? toJob(r) : null;
  }

  // The live job for a champion, if any: what stops a double finalize.
  runningJobFor(forgedId: string): GenerationJobRow | null {
    const r = this.db
      .prepare(
        `select id, forged_id, account_id, status, stage, error, created_at, updated_at
         from generation_jobs where forged_id = ? and status = 'running' limit 1`,
      )
      .get(forgedId) as JobRawRow | undefined;
    return r ? toJob(r) : null;
  }

  // Jobs still marked running (only a crash leaves them): the boot sweep
  // fails and refunds them, because the in-process work died with the
  // process.
  staleRunningJobs(): GenerationJobRow[] {
    const rows = this.db
      .prepare(
        `select id, forged_id, account_id, status, stage, error, created_at, updated_at
         from generation_jobs where status = 'running'`,
      )
      .all() as unknown as JobRawRow[];
    return rows.map(toJob);
  }
}
