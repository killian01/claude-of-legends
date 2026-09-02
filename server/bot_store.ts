// Bots on the account (ADR 0013): their own store, SQLite via node:sqlite,
// one file under DATA_DIR beside the Forge's (ADR 0011's pattern), holding
// exactly the bots domain: the bots themselves and their playbook version
// history. Accounts stay in their JSON registry; rows here reference their
// ids as plain integers across the store boundary. Nothing here validates:
// the playbook validator gates every def before it is worth storing, and
// server/bots.ts is the caller that does.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PlaybookDef } from '../src/sim/playbook/types';

const SCHEMA = `
create table if not exists bots (
  id text primary key,
  account_id integer not null,
  name text not null,
  champion_id text not null,
  sigils text not null,
  skin integer not null default 0,
  playbook text not null,
  version integer not null default 1,
  deposited integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);
create index if not exists bots_by_account on bots (account_id);
create table if not exists bot_versions (
  bot_id text not null references bots(id),
  version integer not null,
  playbook text not null,
  author text not null,
  at integer not null,
  primary key (bot_id, version)
);
`;

export interface BotRow {
  id: string;
  accountId: number;
  name: string;
  championId: string;
  sigils: [string, string];
  skin: number;
  playbook: PlaybookDef;
  // The playbook's version number; every applied change is one more.
  version: number;
  // In the Arena's pool (docs/design/bots.md).
  deposited: boolean;
  createdAt: number;
  updatedAt: number;
}

// One applied playbook. `author` says what made it: the owner's own edit,
// a revert, later the night coach.
export interface BotVersionRow {
  botId: string;
  version: number;
  playbook: PlaybookDef;
  author: string;
  at: number;
}

interface RawBot {
  id: string;
  account_id: number;
  name: string;
  champion_id: string;
  sigils: string;
  skin: number;
  playbook: string;
  version: number;
  deposited: number;
  created_at: number;
  updated_at: number;
}

const BOT_COLS =
  'id, account_id, name, champion_id, sigils, skin, playbook, version, deposited, created_at, updated_at';

function toBot(r: RawBot): BotRow {
  return {
    id: r.id,
    accountId: r.account_id,
    name: r.name,
    championId: r.champion_id,
    sigils: JSON.parse(r.sigils) as [string, string],
    skin: r.skin,
    playbook: JSON.parse(r.playbook) as PlaybookDef,
    version: r.version,
    deposited: r.deposited === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class BotStore {
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

  // -- bots ---------------------------------------------------------------

  insertBot(row: BotRow): void {
    this.db
      .prepare(
        `insert into bots (${BOT_COLS})
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.accountId,
        row.name,
        row.championId,
        JSON.stringify(row.sigils),
        row.skin,
        JSON.stringify(row.playbook),
        row.version,
        row.deposited ? 1 : 0,
        row.createdAt,
        row.updatedAt,
      );
  }

  // Rewrites the editable fields of an existing bot; identity (id, account,
  // champion, createdAt) never moves.
  updateBot(
    id: string,
    fields: {
      name: string;
      sigils: [string, string];
      skin: number;
      playbook: PlaybookDef;
      version: number;
      updatedAt: number;
    },
  ): void {
    this.db
      .prepare(
        `update bots set name = ?, sigils = ?, skin = ?, playbook = ?, version = ?, updated_at = ?
         where id = ?`,
      )
      .run(
        fields.name,
        JSON.stringify(fields.sigils),
        fields.skin,
        JSON.stringify(fields.playbook),
        fields.version,
        fields.updatedAt,
        id,
      );
  }

  getBot(id: string): BotRow | null {
    const r = this.db.prepare(`select ${BOT_COLS} from bots where id = ?`).get(id) as
      | RawBot
      | undefined;
    return r ? toBot(r) : null;
  }

  listByAccount(accountId: number): BotRow[] {
    const rows = this.db
      .prepare(`select ${BOT_COLS} from bots where account_id = ? order by created_at, id`)
      .all(accountId) as unknown as RawBot[];
    return rows.map(toBot);
  }

  countByAccount(accountId: number): number {
    const r = this.db
      .prepare('select count(*) as n from bots where account_id = ?')
      .get(accountId) as { n: number } | undefined;
    return r?.n ?? 0;
  }

  deleteBot(id: string): void {
    this.db.prepare('delete from bot_versions where bot_id = ?').run(id);
    this.db.prepare('delete from bots where id = ?').run(id);
  }

  setDeposited(id: string, on: boolean): void {
    this.db.prepare('update bots set deposited = ? where id = ?').run(on ? 1 : 0, id);
  }

  depositedCount(accountId: number): number {
    const r = this.db
      .prepare('select count(*) as n from bots where account_id = ? and deposited = 1')
      .get(accountId) as { n: number } | undefined;
    return r?.n ?? 0;
  }

  // Every deposited bot on the server: the Arena's pool.
  listDeposited(): BotRow[] {
    const rows = this.db
      .prepare(
        `select ${BOT_COLS} from bots where deposited = 1 order by account_id, created_at, id`,
      )
      .all() as unknown as RawBot[];
    return rows.map(toBot);
  }

  // -- versions -----------------------------------------------------------

  addVersion(v: BotVersionRow): void {
    this.db
      .prepare(
        'insert into bot_versions (bot_id, version, playbook, author, at) values (?, ?, ?, ?, ?)',
      )
      .run(v.botId, v.version, JSON.stringify(v.playbook), v.author, v.at);
  }

  listVersions(botId: string): { version: number; author: string; at: number }[] {
    return this.db
      .prepare('select version, author, at from bot_versions where bot_id = ? order by version')
      .all(botId) as unknown as { version: number; author: string; at: number }[];
  }

  getVersion(botId: string, version: number): BotVersionRow | null {
    const r = this.db
      .prepare('select playbook, author, at from bot_versions where bot_id = ? and version = ?')
      .get(botId, version) as { playbook: string; author: string; at: number } | undefined;
    if (!r) return null;
    return {
      botId,
      version,
      playbook: JSON.parse(r.playbook) as PlaybookDef,
      author: r.author,
      at: r.at,
    };
  }
}
