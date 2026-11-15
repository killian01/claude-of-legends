// The seats a bot plays for an account in a 5v5, read at the match's start
// (docs/design/bots.md): a ranked pool seat (its owner on the pick) and a
// person's own bot seated through the select (the pick's account). The end
// of the match rates and records each one on its account. Whose a seat is
// reads off the picks, never off the sockets still open: an account whose
// socket closed during the select keeps its seat, and its bot plays it, so
// the bot's result is still its account's.

import type { MatchPick } from './match';

export type BotRecordSeat = { accountId: number; name: string; botId?: string; version?: number };

export function botSeatsOf(
  seated: readonly Pick<
    MatchPick,
    'clientId' | 'accountId' | 'ownerId' | 'bot' | 'playbook' | 'name' | 'botId' | 'botVersion'
  >[],
  // The unit a pick became, by its index in pick order.
  unitIdOfPick: (index: number) => number | undefined,
  // A pick that does not say whose it is falls back to its open socket.
  accountOf: (clientId: number) => number | undefined = () => undefined,
): Map<number, BotRecordSeat> {
  const seats = new Map<number, BotRecordSeat>();
  seated.forEach((p, i) => {
    // A house bot plays for nobody.
    if (p.playbook === undefined || p.bot !== undefined) return;
    const accountId = p.ownerId ?? p.accountId ?? accountOf(p.clientId);
    const unitId = unitIdOfPick(i);
    if (accountId === undefined || unitId === undefined) return;
    seats.set(unitId, {
      accountId,
      name: p.name,
      ...(p.botId !== undefined ? { botId: p.botId } : {}),
      ...(p.botVersion !== undefined ? { version: p.botVersion } : {}),
    });
  });
  return seats;
}
