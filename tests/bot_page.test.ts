// The Bot page (server/bot_page.ts): what anyone signed in reads of a bot.
// The playbook rides only when the owner opened it, and the page reads
// the same to the owner: closed is closed, for the reader and for the one
// who holds the switch. Ranked and rated play come through; sparring
// stays in the Academy.

import { describe, expect, it } from 'vitest';
import { describeBotPage } from '../server/bot_page';
import { addEntry } from '../server/bot_records';
import { BotStore } from '../server/bot_store';
import { type BotDeps, createBot, setDeposited, setOpenPlaybook } from '../server/bots';
import type { NewRecordEntry } from '../src/net/record';
import { NEW_BOT_PLAYBOOK } from '../src/sim/content/playbooks/new_bot';

const OWNER = 1;
const READER = 2;

function rig(): { deps: BotDeps; page: Parameters<typeof describeBotPage>[0]; botId: string } {
  const store = new BotStore(':memory:');
  const deps: BotDeps = { store, newId: () => 'bot_00000000000000aa', now: () => 1_000_000 };
  const made = createBot(deps, OWNER, { name: 'Nightfall', championId: 'vesk' });
  if (!made.ok) throw new Error(made.error);
  const page = {
    store,
    ownerName: (id: number) => (id === OWNER ? 'killian' : null),
  };
  return { deps, page, botId: made.bot.id };
}

function rated(kind: NewRecordEntry['kind'], won: boolean, at: number): NewRecordEntry {
  return {
    kind,
    at,
    seed: 7,
    team: 0,
    winner: won ? 0 : 1,
    ticks: 1200,
    version: 1,
    edited: false,
    botUnitId: 3,
    score: [],
    report: { ticks: 1200, units: [] },
    replayId: null,
  };
}

describe('the Bot page', () => {
  it('keeps a closed playbook from the reader and from the owner alike', () => {
    const { deps, page, botId } = rig();
    const asReader = describeBotPage(page, READER, botId);
    expect(asReader.ok && asReader.bot).toMatchObject({
      id: botId,
      name: 'Nightfall',
      championId: 'vesk',
      owner: 'killian',
      accountId: OWNER,
      mine: false,
      ranked: false,
      openPlaybook: false,
    });
    expect(asReader.ok && 'playbook' in asReader).toBe(false);

    const asOwner = describeBotPage(page, OWNER, botId);
    expect(asOwner.ok && asOwner.bot.mine).toBe(true);
    expect(asOwner.ok && 'playbook' in asOwner).toBe(false);

    setOpenPlaybook(deps, OWNER, botId, true);
    const opened = describeBotPage(page, READER, botId);
    expect(opened.ok && opened.bot.openPlaybook).toBe(true);
    expect(opened.ok && opened.playbook).toEqual(NEW_BOT_PLAYBOOK);
  });

  it('refuses an unknown bot and a malformed id', () => {
    const { page } = rig();
    expect(describeBotPage(page, READER, 'bot_ffffffffffffffff')).toEqual({
      ok: false,
      error: 'no such bot',
    });
    expect(describeBotPage(page, READER, 42).ok).toBe(false);
  });

  it('tallies the rated matches only, newest first, and says whether the bot is ranked', () => {
    const { deps, page, botId } = rig();
    setDeposited(deps, OWNER, botId, true);
    addEntry(deps.store, botId, OWNER, rated('sparring', true, 1000));
    addEntry(deps.store, botId, OWNER, rated('arena', true, 2000));
    addEntry(deps.store, botId, OWNER, rated('live', false, 3000));
    addEntry(deps.store, botId, OWNER, rated('series', true, 4000));
    const out = describeBotPage(page, READER, botId);
    expect(out.ok && out.bot.ranked).toBe(true);
    expect(out.ok && out.tally).toEqual({ wins: 1, losses: 1 });
    expect(out.ok && out.rows.map((r) => [r.kind, r.at])).toEqual([
      ['live', 3000],
      ['arena', 2000],
    ]);
    expect(out.ok && out.ratings.live).toEqual({ rating: 1000, games: 0 });
  });
});
