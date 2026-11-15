import { describe, expect, it } from 'vitest';
import { botSeatsOf } from '../server/bot_record_seats';
import type { MatchPick } from '../server/match';

const book = { rules: [] } as unknown as NonNullable<MatchPick['playbook']>;
const unitOf = (i: number) => 100 + i;

describe('botSeatsOf', () => {
  it('keeps a seated own bot on its account after its socket closed during the select', () => {
    const seats = botSeatsOf(
      [{ clientId: 1, accountId: 7, name: 'ada', playbook: book, botId: 'b1', botVersion: 3 }],
      unitOf,
      () => undefined,
    );
    expect([...seats]).toEqual([[100, { accountId: 7, name: 'ada', botId: 'b1', version: 3 }]]);
  });

  it('records a ranked pool seat on its owner', () => {
    const seats = botSeatsOf(
      [
        { clientId: 1, accountId: 8, name: 'brin' },
        { clientId: -5, ownerId: 7, name: 'ada', playbook: book, botId: 'b2' },
      ],
      unitOf,
    );
    expect([...seats]).toEqual([[101, { accountId: 7, name: 'ada', botId: 'b2' }]]);
  });

  it('leaves out hand seats and house bots', () => {
    const seats = botSeatsOf(
      [
        { clientId: 1, accountId: 8, name: 'brin' },
        { clientId: -2, name: 'house', bot: 'scripted', playbook: book },
      ],
      unitOf,
      () => 9,
    );
    expect(seats.size).toBe(0);
  });

  it('falls back to the open socket for a pick that does not say whose it is', () => {
    const seats = botSeatsOf([{ clientId: 4, name: 'cai', playbook: book }], unitOf, (cid) =>
      cid === 4 ? 11 : undefined,
    );
    expect(seats.get(100)?.accountId).toBe(11);
  });
});
