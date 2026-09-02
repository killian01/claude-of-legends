// Bots on the account (ADR 0013): their own store, SQLite via node:sqlite,
// one file under DATA_DIR beside the Forge's (ADR 0011's pattern), holding
// exactly the bots domain: the bots themselves and their playbook version
// history. Accounts stay in their JSON registry; rows here reference their
// ids as plain integers across the store boundary. Nothing here validates:
// the playbook validator gates every def before it is worth storing, and
// server/bots.ts is the caller that does.

import type { CoachTurn } from '../src/net/coach_chat';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ReplayPick } from '../src/net/replay';
import type { PatchOp } from '../src/sim/playbook/patch';
import type { PlayReport } from '../src/sim/playbook/report';
import type { PlaybookDef } from '../src/sim/playbook/types';
import { BASE_RATING } from './rating';

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
create table if not exists bot_ratings (
  account_id integer not null,
  way text not null,
  rating integer not null,
  games integer not null,
  primary key (account_id, way)
);
create table if not exists arena_meta (
  key text primary key,
  value integer not null
);
create table if not exists arena_events (
  id integer primary key autoincrement,
  account_id integer not null,
  at integer not null
);
create table if not exists bot_reports (
  id integer primary key autoincrement,
  match_id integer not null,
  bot_id text not null,
  seat_index integer not null,
  unit_id integer not null default 0,
  picks text not null,
  report text not null,
  at integer not null
);
create index if not exists bot_reports_by_bot on bot_reports (bot_id, at);
create table if not exists bot_proposals (
  id integer primary key autoincrement,
  bot_id text not null,
  at integer not null,
  comment text not null,
  ops text not null,
  current_wins integer not null,
  candidate_wins integer not null,
  matches integer not null,
  status text not null check (status in ('pending', 'applied', 'dismissed')),
  applied_version integer
);
create table if not exists bot_chats (
  bot_id text primary key,
  turns text not null,
  updated_at integer not null
);
`;

// The two ways an account's bot is rated (ADR 0013): in live matches
// (coached or not) and in the Arena.
export type BotWay = 'live' | 'arena';

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
  // The night coach's passing proposals become versions on their own.
  autoApply: boolean;
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
  auto_apply: number;
  created_at: number;
  updated_at: number;
}

const BOT_COLS =
  'id, account_id, name, champion_id, sigils, skin, playbook, version, deposited, auto_apply, ' +
  'created_at, updated_at';

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
    autoApply: r.auto_apply === 1,
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
    // A store created before the night coach gains its columns in place;
    // create-if-not-exists alone never alters an existing table.
    this.ensureColumn('bots', 'auto_apply', 'auto_apply integer not null default 0');
    this.ensureColumn('bots', 'last_coached_at', 'last_coached_at integer');
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

  // -- bots ---------------------------------------------------------------

  insertBot(row: BotRow): void {
    this.db
      .prepare(
        `insert into bots (${BOT_COLS})
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.autoApply ? 1 : 0,
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
    this.db.prepare('delete from bot_chats where bot_id = ?').run(id);
    this.db.prepare('delete from bots where id = ?').run(id);
  }

  setDeposited(id: string, on: boolean): void {
    this.db.prepare('update bots set deposited = ? where id = ?').run(on ? 1 : 0, id);
  }

  setAutoApply(id: string, on: boolean): void {
    this.db.prepare('update bots set auto_apply = ? where id = ?').run(on ? 1 : 0, id);
  }

  botLastCoachedAt(id: string): number | null {
    const r = this.db.prepare('select last_coached_at as at from bots where id = ?').get(id) as
      | { at: number | null }
      | undefined;
    return r?.at ?? null;
  }

  setBotLastCoachedAt(id: string, at: number): void {
    this.db.prepare('update bots set last_coached_at = ? where id = ?').run(at, id);
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

  // -- ratings ------------------------------------------------------------

  botRating(accountId: number, way: BotWay): { rating: number; games: number } {
    const r = this.db
      .prepare('select rating, games from bot_ratings where account_id = ? and way = ?')
      .get(accountId, way) as { rating: number; games: number } | undefined;
    return r ?? { rating: BASE_RATING, games: 0 };
  }

  applyBotRating(accountId: number, way: BotWay, delta: number): void {
    const cur = this.botRating(accountId, way);
    this.db
      .prepare(
        `insert into bot_ratings (account_id, way, rating, games) values (?, ?, ?, ?)
         on conflict (account_id, way) do update set
           rating = excluded.rating, games = excluded.games`,
      )
      .run(accountId, way, cur.rating + delta, cur.games + 1);
  }

  listBotRatings(way: BotWay): { accountId: number; rating: number; games: number }[] {
    const rows = this.db
      .prepare('select account_id, rating, games from bot_ratings where way = ?')
      .all(way) as unknown as { account_id: number; rating: number; games: number }[];
    return rows.map((r) => ({ accountId: r.account_id, rating: r.rating, games: r.games }));
  }

  // -- the Arena ----------------------------------------------------------

  arenaLastRoundAt(): number | null {
    const r = this.db.prepare("select value from arena_meta where key = 'last_round_at'").get() as
      | { value: number }
      | undefined;
    return r ? r.value : null;
  }

  setArenaLastRoundAt(at: number): void {
    this.db
      .prepare(
        "insert into arena_meta (key, value) values ('last_round_at', ?) " +
          'on conflict (key) do update set value = excluded.value',
      )
      .run(at);
  }

  // On-demand Arena matches, for the daily allocation.
  addArenaEvent(accountId: number, at: number): void {
    this.db.prepare('insert into arena_events (account_id, at) values (?, ?)').run(accountId, at);
  }

  arenaEventsSince(accountId: number, since: number): number {
    const r = this.db
      .prepare('select count(*) as n from arena_events where account_id = ? and at >= ?')
      .get(accountId, since) as { n: number } | undefined;
    return r?.n ?? 0;
  }

  pruneArenaEvents(before: number): number {
    const r = this.db.prepare('delete from arena_events where at < ?').run(before);
    return Number(r.changes);
  }

  arenaLastNightAt(): number | null {
    const r = this.db.prepare("select value from arena_meta where key = 'last_night_at'").get() as
      | { value: number }
      | undefined;
    return r ? r.value : null;
  }

  setArenaLastNightAt(at: number): void {
    this.db
      .prepare(
        "insert into arena_meta (key, value) values ('last_night_at', ?) " +
          'on conflict (key) do update set value = excluded.value',
      )
      .run(at);
  }

  // -- reports and proposals (the night coach) -----------------------------

  // What a bot seat did in one Arena match: the match's picks (its
  // opponents, for sparring) and the play report.
  addBotReport(row: BotReportRow): void {
    this.db
      .prepare(
        'insert into bot_reports (match_id, bot_id, seat_index, unit_id, picks, report, at) values (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        row.matchId,
        row.botId,
        row.seatIndex,
        row.unitId,
        JSON.stringify(row.picks),
        JSON.stringify(row.report),
        row.at,
      );
  }

  listBotReports(botId: string, since: number): BotReportRow[] {
    const rows = this.db
      .prepare(
        'select match_id, bot_id, seat_index, unit_id, picks, report, at from bot_reports where bot_id = ? and at >= ? order by at',
      )
      .all(botId, since) as unknown as {
      match_id: number;
      bot_id: string;
      seat_index: number;
      unit_id: number;
      picks: string;
      report: string;
      at: number;
    }[];
    return rows.map((r) => ({
      matchId: r.match_id,
      botId: r.bot_id,
      seatIndex: r.seat_index,
      unitId: r.unit_id,
      picks: JSON.parse(r.picks) as ReplayPick[],
      report: JSON.parse(r.report) as PlayReport,
      at: r.at,
    }));
  }

  pruneBotReports(before: number): number {
    const r = this.db.prepare('delete from bot_reports where at < ?').run(before);
    return Number(r.changes);
  }

  // The coach conversation kept with the bot (server/bot_chats.ts).
  getChat(botId: string): CoachTurn[] {
    const r = this.db.prepare('select turns from bot_chats where bot_id = ?').get(botId) as
      | { turns: string }
      | undefined;
    return r ? (JSON.parse(r.turns) as CoachTurn[]) : [];
  }

  setChat(botId: string, turns: readonly CoachTurn[], at: number): void {
    this.db
      .prepare(
        `insert into bot_chats (bot_id, turns, updated_at) values (?, ?, ?)
         on conflict(bot_id) do update set turns = excluded.turns, updated_at = excluded.updated_at`,
      )
      .run(botId, JSON.stringify(turns), at);
  }

  clearChat(botId: string): void {
    this.db.prepare('delete from bot_chats where bot_id = ?').run(botId);
  }

  addProposal(p: Omit<ProposalRow, 'id' | 'appliedVersion'>): number {
    const r = this.db
      .prepare(
        `insert into bot_proposals (bot_id, at, comment, ops, current_wins, candidate_wins, matches, status)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.botId,
        p.at,
        p.comment,
        JSON.stringify(p.ops),
        p.currentWins,
        p.candidateWins,
        p.matches,
        p.status,
      );
    return Number(r.lastInsertRowid);
  }

  getProposal(id: number): ProposalRow | null {
    const r = this.db.prepare(`select ${PROPOSAL_COLS} from bot_proposals where id = ?`).get(id) as
      | RawProposal
      | undefined;
    return r ? toProposal(r) : null;
  }

  // The newest proposal still awaiting the owner, if any.
  pendingProposal(botId: string): ProposalRow | null {
    const r = this.db
      .prepare(
        `select ${PROPOSAL_COLS} from bot_proposals where bot_id = ? and status = 'pending' order by at desc limit 1`,
      )
      .get(botId) as RawProposal | undefined;
    return r ? toProposal(r) : null;
  }

  setProposalStatus(
    id: number,
    status: ProposalRow['status'],
    appliedVersion: number | null,
  ): void {
    this.db
      .prepare('update bot_proposals set status = ?, applied_version = ? where id = ?')
      .run(status, appliedVersion, id);
  }
}

export interface BotReportRow {
  matchId: number;
  botId: string;
  seatIndex: number;
  unitId: number;
  picks: ReplayPick[];
  report: PlayReport;
  at: number;
}

// A night coach proposal (docs/design/bots.md): the patch, what sparring
// said, and what the owner did with it.
export interface ProposalRow {
  id: number;
  botId: string;
  at: number;
  comment: string;
  ops: PatchOp[];
  currentWins: number;
  candidateWins: number;
  matches: number;
  status: 'pending' | 'applied' | 'dismissed';
  appliedVersion: number | null;
}

interface RawProposal {
  id: number;
  bot_id: string;
  at: number;
  comment: string;
  ops: string;
  current_wins: number;
  candidate_wins: number;
  matches: number;
  status: ProposalRow['status'];
  applied_version: number | null;
}

const PROPOSAL_COLS =
  'id, bot_id, at, comment, ops, current_wins, candidate_wins, matches, status, applied_version';

function toProposal(r: RawProposal): ProposalRow {
  return {
    id: r.id,
    botId: r.bot_id,
    at: r.at,
    comment: r.comment,
    ops: JSON.parse(r.ops) as PatchOp[],
    currentWins: r.current_wins,
    candidateWins: r.candidate_wins,
    matches: r.matches,
    status: r.status,
    appliedVersion: r.applied_version,
  };
}
