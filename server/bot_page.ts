// A bot's page (CONTEXT.md: Bot page): what anyone signed in may read of
// a bot before playing it. Its identity, its rated play, and its playbook
// only when the owner opened it. The page reads the same to everyone, the
// owner included: the switch's effect is visible to the one who holds it,
// and the owner reads their own playbook in the Academy, not here.

import type { RecordRow, RecordTallies } from '../src/net/record';
import type { PlaybookDef } from '../src/sim/playbook/types';
import { listEntries } from './bot_records';
import type { BotStore } from './bot_store';
import type { BotOutcome } from './bots';
import { talliesOf } from './record_tally';

export interface BotPageDeps {
  store: BotStore;
  // The owner's display name, null when the account is gone.
  ownerName: (accountId: number) => string | null;
}

export interface BotPage {
  bot: {
    id: string;
    name: string;
    championId: string;
    skin: number;
    sigils: [string, string];
    version: number;
    ranked: boolean;
    openPlaybook: boolean;
    owner: string | null;
    accountId: number;
    mine: boolean;
  };
  // Read per kind (server/record_tally.ts): a reader wants the rated play
  // first, and never wants it blended with the sparring behind it.
  tally: RecordTallies;
  ratings: {
    live: { rating: number; games: number };
    arena: { rating: number; games: number };
  };
  // The last rated matches, Arena and live; sparring stays in the Academy.
  rows: RecordRow[];
  playbook?: PlaybookDef;
}

export const BOT_PAGE_ROWS = 10;

export function describeBotPage(
  deps: BotPageDeps,
  readerId: number,
  botId: unknown,
): BotOutcome<BotPage> {
  const bot = typeof botId === 'string' ? deps.store.getBot(botId) : null;
  if (!bot) return { ok: false, error: 'no such bot' };
  const entries = listEntries(deps.store, bot.id);
  const tally = talliesOf(entries);
  const rated = entries.filter((r) => r.kind === 'arena' || r.kind === 'live');
  return {
    ok: true,
    bot: {
      id: bot.id,
      name: bot.name,
      championId: bot.championId,
      skin: bot.skin,
      sigils: bot.sigils,
      version: bot.version,
      ranked: bot.deposited,
      openPlaybook: bot.openPlaybook,
      owner: deps.ownerName(bot.accountId),
      accountId: bot.accountId,
      mine: bot.accountId === readerId,
    },
    tally,
    ratings: {
      live: deps.store.botRating(bot.id, 'live'),
      arena: deps.store.botRating(bot.id, 'arena'),
    },
    rows: rated.slice(0, BOT_PAGE_ROWS),
    ...(bot.openPlaybook ? { playbook: bot.playbook } : {}),
  };
}
