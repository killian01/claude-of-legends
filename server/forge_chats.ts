// The Forge's saved conversations: the kit and stat threads travel with
// the draft, so a reload, a rebuild, or another device finds the
// conversation and its latest proposal where they were (a creator lost a
// thread to a reload once). Stored beside the def, never inside it: a
// conversation is editor state, not champion data, and nothing in it
// reaches the form or the game without the creator's Apply. Owner-only;
// any status, so a sealed champion keeps its history to read.

import type { ForgeOutcome } from './forge';
import type { ForgeStore } from './forge_store';
import { CHAT_RAW_TEXT_MAX, CHAT_TURNS_MAX, CHAT_USER_TEXT_MAX } from './suggest';

export type ChatKind = 'kit' | 'stats';
export const CHAT_KINDS: readonly ChatKind[] = ['kit', 'stats'];
// The short text a turn shows as its bubble (the model's comment).
export const CHAT_BUBBLE_MAX = 400;
// The proposal ridden along, as JSON text: a fitted kit is small, and the
// cap keeps a client from parking megabytes in a row.
export const CHAT_PROPOSAL_MAX = 60_000;
// The route's body cap: a full thread of raw model answers plus the
// proposal.
export const CHAT_JSON_MAX = CHAT_TURNS_MAX * CHAT_RAW_TEXT_MAX + CHAT_PROPOSAL_MAX + 4096;

export interface SavedTurn {
  role: 'user' | 'assistant';
  text: string;
  bubble: string;
}

export interface SavedChat {
  turns: SavedTurn[];
  proposal: unknown;
}

export type ForgedChats = Partial<Record<ChatKind, SavedChat>>;

// A readable rejection when the turns are not a thread; null when well
// formed. Unlike a request thread (suggest.ts), a saved one may be empty
// (started over) or end on the assistant's answer.
export function chatError(turns: unknown): string | null {
  if (!Array.isArray(turns)) return 'malformed conversation';
  if (turns.length > CHAT_TURNS_MAX) return 'this conversation is too long to keep';
  for (let i = 0; i < turns.length; i += 1) {
    const t = turns[i] as Partial<SavedTurn>;
    if (typeof t !== 'object' || t === null) return 'malformed conversation';
    if (t.role !== 'user' && t.role !== 'assistant') return 'malformed conversation';
    if (typeof t.text !== 'string' || typeof t.bubble !== 'string') {
      return 'malformed conversation';
    }
    const cap = t.role === 'user' ? CHAT_USER_TEXT_MAX : CHAT_RAW_TEXT_MAX;
    if (t.text.length > cap || t.bubble.length > CHAT_BUBBLE_MAX) {
      return 'a message in this conversation is too long';
    }
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (t.role !== expected) return 'malformed conversation';
  }
  return null;
}

function isKind(v: unknown): v is ChatKind {
  return typeof v === 'string' && (CHAT_KINDS as readonly string[]).includes(v);
}

// The stored blob read back defensively: only well formed chats of known
// kinds come out, so a hand-edited row never breaks the editor.
export function chatsOf(store: ForgeStore, id: string): ForgedChats {
  const raw = store.forgedChats(id);
  const out: ForgedChats = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const kind of CHAT_KINDS) {
    const c = (raw as Record<string, unknown>)[kind] as Partial<SavedChat> | undefined;
    if (typeof c !== 'object' || c === null) continue;
    if (chatError(c.turns) !== null) continue;
    out[kind] = { turns: c.turns as SavedTurn[], proposal: c.proposal ?? null };
  }
  return out;
}

export interface SaveChatRequest {
  id: string;
  kind: unknown;
  turns: unknown;
  proposal?: unknown;
}

export function saveChat(
  deps: { store: ForgeStore },
  accountId: number,
  req: SaveChatRequest,
): ForgeOutcome {
  const row = deps.store.getForged(req.id);
  if (!row || row.accountId !== accountId) {
    return { ok: false, error: 'no such champion on this account' };
  }
  if (!isKind(req.kind)) return { ok: false, error: 'unknown conversation' };
  const bad = chatError(req.turns);
  if (bad !== null) return { ok: false, error: bad };
  const proposal = req.proposal ?? null;
  if (proposal !== null) {
    if (typeof proposal !== 'object') return { ok: false, error: 'malformed proposal' };
    if (JSON.stringify(proposal).length > CHAT_PROPOSAL_MAX) {
      return { ok: false, error: 'this proposal is too large to keep' };
    }
  }
  const chats = chatsOf(deps.store, req.id);
  chats[req.kind] = { turns: req.turns as SavedTurn[], proposal };
  deps.store.setForgedChats(req.id, chats);
  return { ok: true };
}
