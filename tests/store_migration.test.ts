// A store on disk outlives the server that created it: a deploy opens
// yesterday's file with today's code, at boot, before the first match.
// These open each store in a shape an older server left behind and check
// that it gains its new columns in place and keeps every row it held.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { BotStore } from '../server/bot_store';
import { CREATION_IN_EMBERS } from '../server/embers';
import { ForgeStore } from '../server/forge_store';
import { recoverStaleJobs } from '../server/generation/pipeline';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempFile(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'loc-migration-'));
  dirs.push(dir);
  return path.join(dir, name);
}

describe('a bot store created before the night coach', () => {
  it('gains the coach and playbook columns and keeps its bots', () => {
    const file = tempFile('bots.sqlite3');
    // The bots table exactly as the first bot store created it.
    const old = new DatabaseSync(file);
    old.exec(`create table bots (
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
    )`);
    old
      .prepare(
        `insert into bots (id, account_id, name, champion_id, sigils, skin, playbook, version,
           deposited, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('bot_old', 7, 'Old Hand', 'vesk', '["a","b"]', 1, '{"rules":[]}', 3, 1, 10, 20);
    old.close();

    const store = new BotStore(file);
    expect(store.getBot('bot_old')).toMatchObject({
      accountId: 7,
      name: 'Old Hand',
      sigils: ['a', 'b'],
      playbook: { rules: [] },
      version: 3,
      deposited: true,
      autoApply: false,
      openPlaybook: false,
    });
    expect(store.botLastCoachedAt('bot_old')).toBeNull();
    store.setAutoApply('bot_old', true);
    store.setOpenPlaybook('bot_old', true);
    store.setBotLastCoachedAt('bot_old', 99);
    store.close();

    // Opening it again alters nothing more and loses nothing.
    const again = new BotStore(file);
    expect(again.getBot('bot_old')).toMatchObject({ autoApply: true, openPlaybook: true });
    expect(again.botLastCoachedAt('bot_old')).toBe(99);
    again.close();
  });
});

describe('a forge store created before job kinds and embers', () => {
  function oldForgeStore(): string {
    const file = tempFile('forge.sqlite3');
    // The tables as they stood before the two-phase build and the ember
    // ledger: no gallery columns, no chats, a job with no kind or price.
    const old = new DatabaseSync(file);
    old.exec(`create table forged_champions (
      id text primary key,
      account_id integer not null,
      def text not null,
      status text not null check (status in ('draft', 'finalized')),
      assets text,
      created_at integer not null,
      updated_at integer not null
    );
    create table generation_jobs (
      id integer primary key autoincrement,
      forged_id text not null references forged_champions(id),
      account_id integer not null,
      status text not null check (status in ('running', 'success', 'failed')),
      stage text not null,
      error text,
      created_at integer not null,
      updated_at integer not null
    );`);
    old
      .prepare(
        `insert into forged_champions (id, account_id, def, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run('forged_old', 4, '{"id":"forged_old"}', 'draft', 1, 1);
    old
      .prepare(
        `insert into generation_jobs (forged_id, account_id, status, stage, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run('forged_old', 4, 'running', 'model', 1, 1);
    old.close();
    return file;
  }

  it('reads an orphaned job with no kind and no price', () => {
    const store = new ForgeStore(oldForgeStore());
    try {
      expect(store.staleRunningJobs()).toMatchObject([
        { forgedId: 'forged_old', accountId: 4, status: 'running', kind: null, embers: null },
      ]);
      expect(store.forgedChats('forged_old')).toBeNull();
      expect(store.getForged('forged_old')).toMatchObject({ listed: true, takenDown: false });
    } finally {
      store.close();
    }
  });

  it('the boot sweep fails that job and gives back one creation', () => {
    const store = new ForgeStore(oldForgeStore());
    try {
      const before = store.creditBalance(4);
      expect(recoverStaleJobs(store, () => 5)).toBe(1);
      expect(store.staleRunningJobs()).toEqual([]);
      expect(store.creditBalance(4)).toBe(before + CREATION_IN_EMBERS);
      // A second boot finds nothing left to refund.
      expect(recoverStaleJobs(store, () => 6)).toBe(0);
      expect(store.creditBalance(4)).toBe(before + CREATION_IN_EMBERS);
    } finally {
      store.close();
    }
  });
});
