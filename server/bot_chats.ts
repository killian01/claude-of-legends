// The coach conversation kept with the bot (docs/design/bots.md): the
// thread lives on the server, per bot, so a session picks it up where the
// last one stopped and the coach remembers what was done. The model reads
// a window of the newest turns (the thread cap the coach already
// enforces); the store keeps more, trimmed from the front in whole
// exchanges so what remains always opens on the owner's words.

import type { CoachTurn } from '../src/net/coach_chat';
import { type BotDeps, type BotOutcome, ownedBot } from './bots';
import { CHAT_TURNS_MAX, type ChatTurn } from './suggest';

// Turns kept per bot: a hundred exchanges, far past what the model reads.
export const CHAT_STORE_MAX = 200;

// The thread the model reads for a new message: the newest stored turns
// that fit the cap beside the new user turn, opening on a user turn and
// alternating, which is what the coach's thread check demands.
export function windowTurns(stored: readonly CoachTurn[], text: string): ChatTurn[] {
  let from = Math.max(0, stored.length - (CHAT_TURNS_MAX - 1));
  while (from < stored.length && stored[from]!.role !== 'user') from++;
  const turns: ChatTurn[] = stored.slice(from).map((t) => ({ role: t.role, text: t.text }));
  // A stored thread ends on an answer; a dangling user turn cannot happen
  // through appendExchange, but a hand-edited store must not break a call.
  while (turns.length > 0 && turns[turns.length - 1]!.role === 'user') turns.pop();
  turns.push({ role: 'user', text });
  return turns;
}

// The stored thread after an answered exchange, trimmed from the front.
export function appendExchange(
  stored: readonly CoachTurn[],
  text: string,
  raw: string,
  refused: readonly string[],
): CoachTurn[] {
  const out: CoachTurn[] = [
    ...stored,
    { role: 'user', text },
    { role: 'assistant', text: raw, ...(refused.length > 0 ? { refused: [...refused] } : {}) },
  ];
  let from = Math.max(0, out.length - CHAT_STORE_MAX);
  while (from < out.length && out[from]!.role !== 'user') from++;
  return out.slice(from);
}

export function botChat(
  deps: BotDeps,
  accountId: number,
  id: unknown,
): BotOutcome<{ turns: CoachTurn[] }> {
  const found = ownedBot(deps, accountId, id);
  if (!found.ok) return found;
  return { ok: true, turns: deps.store.getChat(found.bot.id) };
}

export function clearBotChat(deps: BotDeps, accountId: number, id: unknown): BotOutcome {
  const found = ownedBot(deps, accountId, id);
  if (!found.ok) return found;
  deps.store.clearChat(found.bot.id);
  return { ok: true };
}
