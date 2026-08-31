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

const SCHEMA = `
create table if not exists forged_champions (
  id text primary key,
  account_id integer not null,
  def text not null,
  status text not null check (status in ('draft', 'finalized')),
  assets text,
  created_at integer not null,
  updated_at integer not null
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
`;

export interface ForgedRow {
  id: string;
  accountId: number;
  def: ForgedChampionDef;
  status: 'draft' | 'finalized';
  createdAt: number;
  updatedAt: number;
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
  };
}

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
  }

  close(): void {
    this.db.close();
  }

  // -- forged champions ---------------------------------------------------

  // Upserts a forged champion row. Validation is the caller's duty (the
  // deterministic validator gates every def before it is worth storing).
  saveForged(row: Omit<ForgedRow, 'updatedAt'> & { updatedAt: number }): void {
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
    const r = this.db
      .prepare(
        'select id, account_id, def, status, created_at, updated_at from forged_champions where id = ?',
      )
      .get(id) as ForgedRawRow | undefined;
    return r ? toForged(r) : null;
  }

  listForgedByAccount(accountId: number): ForgedRow[] {
    const rows = this.db
      .prepare(
        `select id, account_id, def, status, created_at, updated_at
         from forged_champions where account_id = ? order by created_at`,
      )
      .all(accountId) as unknown as ForgedRawRow[];
    return rows.map(toForged);
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
