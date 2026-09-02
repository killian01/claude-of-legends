// The coach conversation kept with the bot (ADR 0013): the store round
// trips it per bot, ownership gates it, the model reads a window that
// passes the coach's own thread check, the store trims in whole exchanges,
// and a bot's chat leaves with the bot.

import { describe, expect, it } from 'vitest';
import { BotStore } from '../server/bot_store';
import {
  appendExchange,
  botChat,
  CHAT_STORE_MAX,
  clearBotChat,
  windowTurns,
} from '../server/bot_chats';
import { type BotDeps, createBot, deleteBot } from '../server/bots';
import { CHAT_TURNS_MAX, threadError } from '../server/suggest';
import { type CoachTurn, commentOf } from '../src/net/coach_chat';

function rig(): BotDeps & { store: BotStore } {
  let n = 0;
  return {
    store: new BotStore(':memory:'),
    now: () => 1000,
    newId: () => `bot_${(++n).toString(16).padStart(16, '0')}`,
  };
}

function exchanges(n: number): CoachTurn[] {
  const out: CoachTurn[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ role: 'user', text: `ask ${i}` }, { role: 'assistant', text: `# answer ${i}` });
  }
  return out;
}

describe('the thread the model reads', () => {
  it('is the newest turns beside the new message, and passes the thread check', () => {
    expect(windowTurns([], 'hi')).toEqual([{ role: 'user', text: 'hi' }]);
    const short = windowTurns(exchanges(2), 'more');
    expect(short.map((t) => t.text)).toEqual([
      'ask 0',
      '# answer 0',
      'ask 1',
      '# answer 1',
      'more',
    ]);
    const long = windowTurns(exchanges(60), 'again');
    expect(long.length).toBeLessThanOrEqual(CHAT_TURNS_MAX);
    expect(long[0]?.role).toBe('user');
    expect(long.at(-1)).toEqual({ role: 'user', text: 'again' });
    expect(long.at(-2)?.text).toBe('# answer 59');
    expect(threadError(long)).toBeNull();
    // A dangling user turn in the store never reaches the model twice.
    const dangling = windowTurns([...exchanges(1), { role: 'user', text: 'lost' }], 'new');
    expect(dangling.map((t) => t.text)).toEqual(['ask 0', '# answer 0', 'new']);
    expect(threadError(dangling)).toBeNull();
  });

  it('grows by whole exchanges and trims from the front by whole exchanges', () => {
    const one = appendExchange([], 'safer', '# Safer.\nset retreat', ['bad op']);
    expect(one).toEqual([
      { role: 'user', text: 'safer' },
      { role: 'assistant', text: '# Safer.\nset retreat', refused: ['bad op'] },
    ]);
    const full = appendExchange(exchanges(CHAT_STORE_MAX / 2), 'x', '# y', []);
    expect(full).toHaveLength(CHAT_STORE_MAX);
    expect(full[0]).toEqual({ role: 'user', text: 'ask 1' });
    expect(full.at(-1)).toEqual({ role: 'assistant', text: '# y' });
  });

  it('shows the comment line as the bubble', () => {
    expect(commentOf('# Plus prudent.\n{"op":"set"}')).toBe('Plus prudent.');
    expect(commentOf('{"op":"set"}')).toBe('Done.');
    expect(commentOf('#   \n')).toBe('Done.');
  });
});

describe('the chat on the account', () => {
  it('round-trips per bot, is the owner’s only, clears, and leaves with the bot', () => {
    const deps = rig();
    const made = createBot(deps, 1, { name: 'Nightfall', championId: 'vesk' });
    if (!made.ok) throw new Error(made.error);
    const id = made.bot.id;
    expect(botChat(deps, 1, id)).toEqual({ ok: true, turns: [] });
    deps.store.setChat(id, exchanges(2), 5);
    const read = botChat(deps, 1, id);
    expect(read.ok && read.turns.map((t) => t.text)).toEqual([
      'ask 0',
      '# answer 0',
      'ask 1',
      '# answer 1',
    ]);
    expect(botChat(deps, 2, id).ok).toBe(false);
    expect(clearBotChat(deps, 2, id).ok).toBe(false);
    expect(clearBotChat(deps, 1, id)).toEqual({ ok: true });
    expect(deps.store.getChat(id)).toEqual([]);
    deps.store.setChat(id, exchanges(1), 6);
    expect(deleteBot(deps, 1, id).ok).toBe(true);
    expect(deps.store.getChat(id)).toEqual([]);
  });
});
