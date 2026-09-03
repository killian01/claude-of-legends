// The ranked pool in the fill (docs/design/bots.md, the ladder alive): a
// live match's empty seats go to ranked bots before house bots, one bot
// per account, no duplicate champion inside a team, seated from the seed;
// their picks carry the owner, the bot and its version for the rating and
// the Record; Match registers nobody behind them; house bots take the
// rest and carry their style's name.

import { describe, expect, it } from 'vitest';
import { fillWithBots, type PoolSeat } from '../server/bot_fill';
import type { BotRow } from '../server/bot_store';
import { Match, type MatchPick } from '../server/match';
import { HOUSE_STYLE_IDS } from '../src/sim/content/bots/house';
import { LANER_PLAYBOOK } from '../src/sim/content/playbooks/laner';

function bot(id: string, accountId: number, championId: string): BotRow {
  return {
    id,
    accountId,
    name: `Bot ${id}`,
    championId,
    sigils: ['riftstep', 'sear'],
    skin: 1,
    playbook: LANER_PLAYBOOK,
    version: 3,
    deposited: true,
    autoApply: false,
    openPlaybook: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

const HUMAN: MatchPick = {
  clientId: 1,
  name: 'alice',
  team: 0,
  championId: 'vesk',
  sigils: ['riftstep', 'mend'],
};

const POOL: PoolSeat[] = [
  { bot: bot('bot_a', 10, 'korrath'), owner: 'ann' },
  { bot: bot('bot_b', 10, 'sylra'), owner: 'ann' },
  { bot: bot('bot_c', 11, 'vesk'), owner: 'cid' },
  { bot: bot('bot_d', 12, 'dain'), owner: 'dee' },
  { bot: bot('bot_e', 13, 'vesk'), owner: 'eve' },
];

describe('the ranked pool in the fill', () => {
  it('seats pool bots before house bots, one per account, no duplicate champion per team', () => {
    const picks = fillWithBots([HUMAN], 5, 5, POOL);
    expect(picks).toHaveLength(10);
    const pooled = picks.filter((p) => p.ownerId !== undefined);
    // Four accounts in the pool: at most four seats, ann seated once.
    expect(pooled.length).toBeGreaterThanOrEqual(3);
    expect(pooled.length).toBeLessThanOrEqual(4);
    expect(new Set(pooled.map((p) => p.ownerId)).size).toBe(pooled.length);
    for (const team of [0, 1] as const) {
      const champs = picks.filter((p) => p.team === team).map((p) => p.championId);
      expect(champs).toHaveLength(5);
      expect(new Set(champs).size).toBe(5);
    }
    for (const p of pooled) {
      expect(p.name).toMatch(/^\w+ \(Bot bot_[a-e]\)$/);
      expect(p.playbook).toEqual(LANER_PLAYBOOK);
      expect(p.botVersion).toBe(3);
      expect(p.botId).toMatch(/^bot_/);
      expect(p.bot).toBeUndefined();
    }
    // House bots fill what is left, named by their style.
    const house = picks.filter((p) => p.bot !== undefined);
    expect(house.length).toBe(9 - pooled.length);
    for (const p of house) {
      expect(HOUSE_STYLE_IDS).toContain(p.bot);
      expect(p.name).toMatch(/^House /);
    }
  });

  it('is deterministic over the seed and the pool, and changes with the seed', () => {
    const a = fillWithBots([HUMAN], 9, 5, POOL).map((p) => `${p.team}:${p.botId ?? p.bot}`);
    const b = fillWithBots([HUMAN], 9, 5, POOL).map((p) => `${p.team}:${p.botId ?? p.bot}`);
    expect(a).toEqual(b);
    const seeds = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      seeds.add(
        fillWithBots([HUMAN], seed, 5, POOL)
          .map((p) => p.botId ?? p.bot)
          .join(','),
      );
    }
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('registers no player behind a pool seat, but seats it in the sim', () => {
    const picks = fillWithBots([HUMAN], 3, 5, POOL);
    const match = new Match(3, picks);
    expect(match.players.size).toBe(1);
    expect(match.players.get(1)?.name).toBe('alice');
    const pooledIndex = picks.findIndex((p) => p.ownerId !== undefined);
    const unitId = match.unitIdOfPick(pooledIndex);
    expect(unitId).toBeDefined();
    const unit = match.sim.units.get(unitId!);
    expect(unit?.kind).toBe('champion');
    expect(unit?.team).toBe(picks[pooledIndex]!.team);
    expect(match.sim.policies.has(unitId!)).toBe(true);
    // The replay picks carry the playbook, never the owner id.
    expect(match.replayPicks[pooledIndex]?.playbook).toEqual(LANER_PLAYBOOK);
    expect('ownerId' in match.replayPicks[pooledIndex]!).toBe(false);
  });

  it('falls back to house bots alone with an empty pool', () => {
    const picks = fillWithBots([HUMAN], 5);
    expect(picks.filter((p) => p.bot !== undefined)).toHaveLength(9);
    expect(picks.some((p) => p.ownerId !== undefined)).toBe(false);
  });
});
