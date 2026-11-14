// The ranked bots a 5v5 may seat (docs/design/bots.md, the ladder alive):
// every deposited bot whose account holds no seat in the match and whose
// owner is still known, with the owner's name for the seat. Whose each seat
// is reads off the picks (server/matchmaker.ts records it as the select
// starts), never off the sockets still open: an account whose socket closed
// during the select still holds its seat, and its bot plays it, so its
// ranked bot must not sit in the same match a second time.

import type { PoolSeat } from './bot_fill';
import type { BotRow } from './bot_store';
import type { MatchPick } from './match';

export function rankedPool(
  picks: readonly Pick<MatchPick, 'clientId' | 'accountId'>[],
  deposited: readonly BotRow[],
  ownerName: (accountId: number) => string | undefined,
  // A pick that does not say whose it is falls back to its open socket.
  accountOf: (clientId: number) => number | undefined = () => undefined,
): PoolSeat[] {
  const present = new Set<number>();
  for (const p of picks) {
    const account = p.accountId ?? accountOf(p.clientId);
    if (account !== undefined) present.add(account);
  }
  const pool: PoolSeat[] = [];
  for (const bot of deposited) {
    if (present.has(bot.accountId)) continue;
    const owner = ownerName(bot.accountId);
    if (owner) pool.push({ bot, owner });
  }
  return pool;
}
