// The look conversation: the kit and stat conversations' third sibling.
// It answers honestly when unconfigured, works for the owner's drafts
// only, replays the thread with the preamble first and the form state
// last, and nothing lands unchecked: an invented word goes back to the
// model naming the exact field, and a set of looks only returns once the
// whole definition clears validateForged.

import { describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import { type ChatTurn, SUGGEST_ATTEMPTS, type SuggestDeps } from '../server/suggest';
import { suggestLook } from '../server/suggest_look';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { spellLookErrors } from '../src/sim/spell_look';
import { FORGED_TWINS } from './forged_twins';

function twin(i: number, id: string): ForgedChampionDef {
  return { ...FORGED_TWINS[i]!, id, creator: 'alice' };
}

function answer(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
}

const ASK: ChatTurn[] = [{ role: 'user', text: 'frost, not fire' }];

const LOOKS = JSON.stringify({
  comment: 'Frost throughout.',
  looks: {
    Q: {
      palette: { main: 3041504, glow: 12575487 },
      projectile: { body: 'shard', trail: 'sparks', spin: 2 },
      impact: { shape: 'shatter', density: 0.7, mark: 'frost' },
    },
    W: { zone: { floor: 'pool', edge: 'soft', motion: 'pulse' } },
    E: { cast: { shape: 'ring' } },
    R: { cast: { shape: 'wave', scale: 2, shake: 0.2, smoke: true } },
  },
});

// The same answer with a word no renderer knows.
const INVENTED = JSON.stringify({
  comment: 'Here.',
  looks: { Q: { projectile: { body: 'dragon' } } },
});

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
  store.saveForged({
    id: 'forged_sealed',
    accountId: 1,
    def: twin(1, 'forged_sealed'),
    status: 'finalized',
    createdAt: 1,
    updatedAt: 1,
  });
  return store;
}

function deps(store: ForgeStore, fetchFn: typeof fetch): SuggestDeps {
  return { store, apiKey: 'k-test', assetsDir: 'ASSETS', fetchFn };
}

describe('suggestLook', () => {
  it('answers honestly when no key is configured', async () => {
    const store = seeded();
    const out = await suggestLook({ store, apiKey: null, assetsDir: 'A' }, 1, {
      id: 'forged_d',
      messages: ASK,
    });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('not configured') });
    store.close();
  });

  it('refuses another account, a sealed champion, and a malformed thread', async () => {
    const store = seeded();
    const d = deps(store, async () => answer(LOOKS));
    expect((await suggestLook(d, 2, { id: 'forged_d', messages: ASK })).ok).toBe(false);
    expect(await suggestLook(d, 1, { id: 'forged_sealed', messages: ASK })).toMatchObject({
      ok: false,
      error: expect.stringContaining('sealed'),
    });
    expect(await suggestLook(d, 1, { id: 'forged_d', messages: [] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('malformed'),
    });
    store.close();
  });

  it('returns one validated look per key, and no splash is required', async () => {
    const store = seeded();
    const out = await suggestLook(
      deps(store, async () => answer(LOOKS)),
      1,
      { id: 'forged_d', messages: ASK },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.comment).toBe('Frost throughout.');
    expect(Object.keys(out.looks).sort()).toEqual(['E', 'Q', 'R', 'W']);
    expect(out.looks.Q?.projectile?.body).toBe('shard');
    expect(out.looks.W?.zone?.floor).toBe('pool');
    for (const key of ['Q', 'W', 'E', 'R'] as const) {
      expect(spellLookErrors(out.looks[key] ?? {})).toEqual([]);
    }
    expect(out.raw).toBe(LOOKS);
    store.close();
  });

  it('replays the thread: the vocabulary first, the kit and its looks last', async () => {
    const store = seeded();
    const seen: { role: string; content: unknown }[][] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: unknown }[];
      };
      seen.push(body.messages);
      return answer(LOOKS);
    };
    const thread: ChatTurn[] = [
      { role: 'user', text: 'icy' },
      { role: 'assistant', text: LOOKS },
      { role: 'user', text: 'calmer on the Q' },
    ];
    const form = { ...twin(0, 'forged_d'), name: 'Quillmarrow' };
    const out = await suggestLook(deps(store, fetchFn), 1, {
      id: 'forged_d',
      messages: thread,
      def: form,
    });
    expect(out.ok).toBe(true);
    const msgs = seen[0]!;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const first = String(msgs[0]!.content);
    expect(first).toContain('The creator says: icy');
    expect(first).toContain('Body: bolt, orb, shard');
    expect(first).toContain('Quillmarrow');
    const last = String(msgs[2]!.content);
    expect(last.startsWith('calmer on the Q')).toBe(true);
    expect(last).toContain('The kit on the form right now');
    expect(last).toContain('The looks on the form right now');
    store.close();
  });

  it('tells the model which parts each delivery can actually show', async () => {
    const store = seeded();
    let last = '';
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: unknown }[] };
      last = String(body.messages[body.messages.length - 1]!.content);
      return answer(LOOKS);
    };
    // Twin 0 is Korrath: a burst Q, a zone W (see the roster kits).
    await suggestLook(deps(store, fetchFn), 1, { id: 'forged_d', messages: ASK });
    expect(last).toMatch(/shows (projectile and impact|zone|cast)/);
    store.close();
  });

  it('sends an invented word back naming the field, then succeeds', async () => {
    const store = seeded();
    let calls = 0;
    let feedback = '';
    const fetchFn: typeof fetch = async (_url, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { messages: { content: unknown }[] };
      if (calls === 2) feedback = String(body.messages[body.messages.length - 1]!.content);
      return answer(calls === 1 ? INVENTED : LOOKS);
    };
    const out = await suggestLook(deps(store, fetchFn), 1, { id: 'forged_d', messages: ASK });
    expect(out.ok).toBe(true);
    expect(calls).toBe(2);
    expect(feedback).toContain('Q.look.projectile.body');
    store.close();
  });

  it('gives up after the attempt budget and reports plainly', async () => {
    const store = seeded();
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return answer(INVENTED);
    };
    const out = await suggestLook(deps(store, fetchFn), 1, { id: 'forged_d', messages: ASK });
    expect(calls).toBe(SUGGEST_ATTEMPTS);
    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining('did not clear the vocabulary'),
    });
    store.close();
  });
});
