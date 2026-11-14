import { describe, expect, it } from 'vitest';
import type { BotRow } from '../server/bot_store';
import { rankedPool } from '../server/ranked_pool';

function bot(id: string, accountId: number): BotRow {
  return {
    id,
    accountId,
    name: id,
    championId: 'ostrand',
    sigils: ['flash', 'mend'],
    skin: 0,
    playbook: { rules: [] } as unknown as BotRow['playbook'],
    version: 1,
    deposited: true,
    autoApply: false,
    openPlaybook: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

const owners = new Map([
  [7, 'ada'],
  [8, 'brin'],
]);
const ownerName = (id: number) => owners.get(id);

describe('rankedPool', () => {
  it('seats a deposited bot whose account holds no seat, named for its owner', () => {
    const pool = rankedPool([{ clientId: 1, accountId: 8 }], [bot('a', 7)], ownerName);
    expect(pool.map((s) => [s.bot.id, s.owner])).toEqual([['a', 'ada']]);
  });

  it('leaves out the bot of an account seated in the match', () => {
    const pool = rankedPool([{ clientId: 1, accountId: 7 }], [bot('a', 7)], ownerName);
    expect(pool).toEqual([]);
  });

  it('leaves out the bot of an account whose socket closed during the select', () => {
    // No socket answers for client 1 any more; the pick still says whose it is.
    const pool = rankedPool(
      [{ clientId: 1, accountId: 7 }],
      [bot('a', 7), bot('b', 8)],
      ownerName,
      () => undefined,
    );
    expect(pool.map((s) => s.bot.id)).toEqual(['b']);
  });

  it('falls back to the open socket for a pick that does not say whose it is', () => {
    const pool = rankedPool([{ clientId: 1 }], [bot('a', 7)], ownerName, (cid) =>
      cid === 1 ? 7 : undefined,
    );
    expect(pool).toEqual([]);
  });

  it('leaves out a bot whose owner is no longer known', () => {
    const pool = rankedPool([], [bot('a', 99)], ownerName);
    expect(pool).toEqual([]);
  });
});
