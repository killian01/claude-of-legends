// Bots on the account (ADR 0013, plan-bots phase 3): the store round-trips,
// every edit is gated on ownership and on the playbook validator, the
// deposit cap holds, names are clean and unique per account, and the
// version history grows with every applied change.

import { describe, expect, it } from 'vitest';
import { BotStore } from '../server/bot_store';
import {
  type BotDeps,
  createBot,
  deleteBot,
  listBots,
  getVersion,
  listVersions,
  revertBot,
  saveBot,
  setDeposited,
} from '../server/bots';
import { NEW_BOT_PLAYBOOK } from '../src/sim/content/playbooks/new_bot';
import type { PlaybookDef } from '../src/sim/playbook';

function rig(): BotDeps & { store: BotStore } {
  let n = 0;
  let clock = 1_000_000;
  return {
    store: new BotStore(':memory:'),
    now: () => (clock += 1000),
    newId: () => `bot_${(++n).toString(16).padStart(16, '0')}`,
  };
}

const AGGRESSIVE: PlaybookDef = {
  version: 1,
  plays: [
    { id: 'fight', when: { kind: 'enemyVisible' }, do: { kind: 'fight' } },
    { id: 'push', when: { kind: 'always' }, do: { kind: 'push', lane: 'mid' } },
  ],
};

function make(deps: BotDeps, accountId = 1, name = 'Nightfall') {
  const out = createBot(deps, accountId, {
    name,
    championId: 'vesk',
    sigils: ['riftstep', 'sear'],
  });
  if (!out.ok) throw new Error(out.error);
  return out.bot;
}

describe('bots on the account', () => {
  it('creates a bot as the Laner on the chosen champion, lists, edits and deletes it', () => {
    const deps = rig();
    const bot = make(deps);
    expect(bot).toMatchObject({
      id: 'bot_0000000000000001',
      accountId: 1,
      name: 'Nightfall',
      championId: 'vesk',
      sigils: ['riftstep', 'sear'],
      version: 1,
      deposited: false,
    });
    expect(bot.playbook).toEqual(NEW_BOT_PLAYBOOK);
    expect(deps.store.getBot(bot.id)).toEqual(bot);

    const listed = listBots(deps, 1);
    expect(listed.ok && listed.bots.map((b) => b.name)).toEqual(['Nightfall']);

    const saved = saveBot(deps, 1, {
      id: bot.id,
      name: '  Night  Fall ',
      skin: 2,
      sigils: ['mend', 'zephyr'],
    });
    expect(saved.ok && saved.bot).toMatchObject({
      name: 'Night Fall',
      skin: 2,
      sigils: ['mend', 'zephyr'],
      version: 1,
    });

    expect(deleteBot(deps, 1, bot.id)).toEqual({ ok: true });
    expect(deps.store.getBot(bot.id)).toBeNull();
    expect(deps.store.listVersions(bot.id)).toEqual([]);
    deps.store.close();
  });

  it('versions every applied playbook change, and reverting is a new version', () => {
    const deps = rig();
    const bot = make(deps);
    const same = saveBot(deps, 1, { id: bot.id, playbook: NEW_BOT_PLAYBOOK });
    expect(same.ok && same.bot.version).toBe(1);

    const changed = saveBot(deps, 1, { id: bot.id, playbook: AGGRESSIVE });
    expect(changed.ok && changed.bot.version).toBe(2);
    expect(changed.ok && changed.bot.playbook).toEqual(AGGRESSIVE);

    const versions = listVersions(deps, 1, bot.id);
    expect(versions.ok && versions.versions.map((v) => [v.version, v.author])).toEqual([
      [1, 'owner'],
      [2, 'owner'],
    ]);

    // A stored version reads back whole, for the sparring series.
    const first = getVersion(deps, 1, bot.id, 1);
    expect(first.ok && first.version.playbook).toEqual(NEW_BOT_PLAYBOOK);
    expect(getVersion(deps, 1, bot.id, 9).ok).toBe(false);
    expect(getVersion(deps, 2, bot.id, 1).ok).toBe(false);
    expect(getVersion(deps, 1, bot.id, 'one').ok).toBe(false);

    const back = revertBot(deps, 1, bot.id, 1);
    expect(back.ok && back.bot.version).toBe(3);
    expect(back.ok && back.bot.playbook).toEqual(NEW_BOT_PLAYBOOK);
    expect(deps.store.getVersion(bot.id, 3)?.author).toBe('revert:1');
    expect(revertBot(deps, 1, bot.id, 9).ok).toBe(false);
    deps.store.close();
  });

  it('refuses a misshapen or oversized playbook and keeps the stored one', () => {
    const deps = rig();
    const bot = make(deps);
    const bad = saveBot(deps, 1, {
      id: bot.id,
      playbook: {
        version: 1,
        plays: [{ id: 'x', when: { kind: 'always' }, do: { kind: 'nope' } }],
      },
    });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/playbook rejected/);
    const huge = saveBot(deps, 1, {
      id: bot.id,
      playbook: { version: 1, plays: [], pad: 'x'.repeat(40_000) },
    });
    expect(!huge.ok && huge.error).toMatch(/too large/);
    expect(deps.store.getBot(bot.id)?.playbook).toEqual(NEW_BOT_PLAYBOOK);
    expect(deps.store.getBot(bot.id)?.version).toBe(1);
    deps.store.close();
  });

  it('gates every edit on ownership and on a well-formed id', () => {
    const deps = rig();
    const bot = make(deps, 1);
    expect(saveBot(deps, 2, { id: bot.id, name: 'Mine' }).ok).toBe(false);
    expect(deleteBot(deps, 2, bot.id).ok).toBe(false);
    expect(setDeposited(deps, 2, bot.id, true).ok).toBe(false);
    expect(listVersions(deps, 2, bot.id).ok).toBe(false);
    expect(revertBot(deps, 2, bot.id, 1).ok).toBe(false);
    expect(deleteBot(deps, 1, 'bots/../etc').ok).toBe(false);
    expect(deps.store.getBot(bot.id)?.name).toBe('Nightfall');
    deps.store.close();
  });

  it('keeps names clean, plain, and unique within the account', () => {
    const deps = rig();
    make(deps, 1, 'Nightfall');
    expect(createBot(deps, 1, { name: 'nightfall', championId: 'vesk' }).ok).toBe(false);
    // The same name on another account is fine: names are per account.
    expect(createBot(deps, 2, { name: 'Nightfall', championId: 'vesk' }).ok).toBe(true);
    expect(createBot(deps, 1, { name: '', championId: 'vesk' }).ok).toBe(false);
    expect(createBot(deps, 1, { name: 'x'.repeat(25), championId: 'vesk' }).ok).toBe(false);
    expect(createBot(deps, 1, { name: 'badname', championId: 'vesk' }).ok).toBe(false);
    expect(createBot(deps, 1, { name: 'Two', championId: 'not_a_champion' }).ok).toBe(false);
    expect(
      createBot(deps, 1, { name: 'Two', championId: 'vesk', sigils: ['mend', 'mend'] }).ok,
    ).toBe(false);
    deps.store.close();
  });

  it('caps the bots deposited in the Arena per account', () => {
    const deps = { ...rig(), depositCap: 2 };
    const a = make(deps, 1, 'A');
    const b = make(deps, 1, 'B');
    const c = make(deps, 1, 'C');
    expect(setDeposited(deps, 1, a.id, true).ok).toBe(true);
    expect(setDeposited(deps, 1, b.id, true).ok).toBe(true);
    const third = setDeposited(deps, 1, c.id, true);
    expect(!third.ok && third.error).toMatch(/at most 2/);
    // Re-depositing an already deposited bot is not a third seat.
    expect(setDeposited(deps, 1, a.id, true).ok).toBe(true);
    expect(setDeposited(deps, 1, a.id, false).ok).toBe(true);
    expect(setDeposited(deps, 1, c.id, true).ok).toBe(true);
    expect(deps.store.listDeposited().map((r) => r.name)).toEqual(['B', 'C']);
    deps.store.close();
  });

  it('caps the bots one account may hold', () => {
    const deps = { ...rig(), botCap: 2 };
    make(deps, 1, 'A');
    make(deps, 1, 'B');
    const third = createBot(deps, 1, { name: 'C', championId: 'vesk' });
    expect(!third.ok && third.error).toMatch(/bot cap/);
    deps.store.close();
  });
});
