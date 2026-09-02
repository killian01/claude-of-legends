// Saved conversations: the kit and stat threads travel with the draft,
// owner-only, each kind kept apart, read back defensively, and the store
// column arrives by migration on rows created before it.

import { describe, expect, it } from 'vitest';
import {
  CHAT_BUBBLE_MAX,
  CHAT_PROPOSAL_MAX,
  chatError,
  chatsOf,
  saveChat,
} from '../server/forge_chats';
import { ForgeStore } from '../server/forge_store';
import { CHAT_TURNS_MAX } from '../server/suggest';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { FORGED_TWINS } from './forged_twins';

function twin(i: number, id: string): ForgedChampionDef {
  return { ...FORGED_TWINS[i]!, id, creator: 'alice' };
}

function seeded(): ForgeStore {
  const store = new ForgeStore(':memory:');
  store.saveForged({
    id: 'forged_d',
    accountId: 1,
    def: twin(0, 'forged_d'),
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
  });
  return store;
}

const THREAD = [
  { role: 'user' as const, text: 'an ice theme', bubble: 'an ice theme' },
  { role: 'assistant' as const, text: '{"comment":"Frost."}', bubble: 'Frost.' },
];

describe('chatError', () => {
  it('accepts an empty thread, one ending on either side, and rejects the rest', () => {
    expect(chatError([])).toBeNull();
    expect(chatError(THREAD)).toBeNull();
    expect(chatError(THREAD.slice(0, 1))).toBeNull();
    expect(chatError('no')).toContain('malformed');
    expect(chatError([THREAD[1]])).toContain('malformed');
    expect(chatError([THREAD[0], THREAD[0]])).toContain('malformed');
    expect(chatError([{ role: 'user', text: 'x' }])).toContain('malformed');
    expect(
      chatError([{ role: 'user', text: 'x', bubble: 'y'.repeat(CHAT_BUBBLE_MAX + 1) }]),
    ).toContain('too long');
    const long = Array.from({ length: CHAT_TURNS_MAX + 2 }, (_, i) => THREAD[i % 2]!);
    expect(chatError(long)).toContain('too long');
  });
});

describe('saveChat', () => {
  it('keeps each kind apart with its proposal, for the owner only', () => {
    const store = seeded();
    const deps = { store };
    expect(saveChat(deps, 2, { id: 'forged_d', kind: 'kit', turns: THREAD }).ok).toBe(false);
    expect(saveChat(deps, 1, { id: 'forged_x', kind: 'kit', turns: THREAD }).ok).toBe(false);
    expect(saveChat(deps, 1, { id: 'forged_d', kind: 'art', turns: THREAD }).ok).toBe(false);
    expect(saveChat(deps, 1, { id: 'forged_d', kind: 'kit', turns: 'no' }).ok).toBe(false);
    expect(
      saveChat(deps, 1, { id: 'forged_d', kind: 'kit', turns: THREAD, proposal: { fit: 1 } }).ok,
    ).toBe(true);
    expect(saveChat(deps, 1, { id: 'forged_d', kind: 'stats', turns: THREAD.slice(0, 1) }).ok).toBe(
      true,
    );
    const chats = chatsOf(store, 'forged_d');
    expect(chats.kit).toEqual({ turns: THREAD, proposal: { fit: 1 } });
    expect(chats.stats).toEqual({ turns: THREAD.slice(0, 1), proposal: null });
    // Starting over empties one kind and leaves the other alone.
    expect(saveChat(deps, 1, { id: 'forged_d', kind: 'kit', turns: [] }).ok).toBe(true);
    expect(chatsOf(store, 'forged_d').kit).toEqual({ turns: [], proposal: null });
    expect(chatsOf(store, 'forged_d').stats?.turns).toHaveLength(1);
    // The draft itself is untouched: a conversation is not a champion edit.
    expect(store.getForged('forged_d')?.updatedAt).toBe(1);
    store.close();
  });

  it('refuses a proposal that is not an object or too large', () => {
    const store = seeded();
    const deps = { store };
    expect(
      saveChat(deps, 1, { id: 'forged_d', kind: 'kit', turns: THREAD, proposal: 'x' }).ok,
    ).toBe(false);
    const huge = { pad: 'x'.repeat(CHAT_PROPOSAL_MAX) };
    expect(
      saveChat(deps, 1, { id: 'forged_d', kind: 'kit', turns: THREAD, proposal: huge }).ok,
    ).toBe(false);
    store.close();
  });

  it('reads a damaged row back as nothing rather than breaking', () => {
    const store = seeded();
    store.setForgedChats('forged_d', { kit: { turns: 'garbage' }, other: 1 });
    expect(chatsOf(store, 'forged_d')).toEqual({});
    expect(chatsOf(store, 'forged_missing')).toEqual({});
    store.close();
  });
});
