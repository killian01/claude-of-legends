// The stat conversation: answers honestly when unconfigured, works for
// the owner's drafts only (no splash needed: the stats follow the kit),
// replays the thread with the preamble first and the form state last,
// and NOTHING lands unchecked: every proposal is fitted to the Stat and
// Growth envelope lines by the sim's stat fit and must clear
// validateForged.

import { describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import { type ChatTurn, SUGGEST_ATTEMPTS, type SuggestDeps } from '../server/suggest';
import { suggestStats } from '../server/suggest_stats';
import { budgetOf } from '../src/sim/forge/budget';
import { ENVELOPES, envelopeSpend } from '../src/sim/forge/envelopes';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { MELEE_REACH } from '../src/sim/forge/stat_fit';
import { FORGED_TWINS } from './forged_twins';

function twin(i: number, id: string): ForgedChampionDef {
  return { ...FORGED_TWINS[i]!, id, creator: 'alice' };
}

function answer(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
}

const ASK: ChatTurn[] = [{ role: 'user', text: 'a tanky frontliner' }];

// A light, melee body: the fit raises it to both lines and pins the reach.
const TANK = JSON.stringify({
  comment: 'A wall.',
  base: {
    hp: 700,
    mana: 250,
    ad: 50,
    armor: 40,
    mr: 35,
    attackRange: 1.5,
    attackSpeed: 0.55,
    moveSpeed: 3.5,
    hpRegen: 2,
    manaRegen: 1,
    radius: 0.75,
  },
  growth: { hp: 110, mana: 20, ad: 2.5, armor: 4, mr: 2.5 },
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

describe('suggestStats', () => {
  it('answers honestly when no key is configured', async () => {
    const store = seeded();
    const out = await suggestStats({ store, apiKey: null, assetsDir: 'A' }, 1, {
      id: 'forged_d',
      messages: ASK,
    });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('not configured') });
    store.close();
  });

  it('refuses another account, a sealed champion, and a malformed thread', async () => {
    const store = seeded();
    const d = deps(store, async () => answer(TANK));
    expect((await suggestStats(d, 2, { id: 'forged_d', messages: ASK })).ok).toBe(false);
    expect(await suggestStats(d, 1, { id: 'forged_sealed', messages: ASK })).toMatchObject({
      ok: false,
      error: expect.stringContaining('sealed'),
    });
    expect(await suggestStats(d, 1, { id: 'forged_d', messages: [] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('malformed'),
    });
    store.close();
  });

  it('returns a fitted, validated stat line with its bill, no splash needed', async () => {
    const store = seeded();
    const out = await suggestStats(
      deps(store, async () => answer(TANK)),
      1,
      {
        id: 'forged_d',
        messages: ASK,
      },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.comment).toBe('A wall.');
    expect(out.base.attackRange).toBe(MELEE_REACH);
    expect(out.base.ap).toBe(0);
    expect(out.budget.stats.cap).toBe(ENVELOPES.stats);
    expect(out.budget.growth.cap).toBe(ENVELOPES.growth);
    expect(out.budget.stats.spend).toBeLessThanOrEqual(ENVELOPES.stats);
    expect(out.budget.stats.spend).toBeGreaterThan(ENVELOPES.stats - 3);
    expect(out.budget.growth.spend).toBeGreaterThan(ENVELOPES.growth - 3);
    expect(out.fit.stats).toBeGreaterThan(0);
    expect(out.raw).toBe(TANK);
    const spend = envelopeSpend(budgetOf({ ...twin(0, 'x'), base: out.base, growth: out.growth }));
    expect(spend.stats).toBeLessThanOrEqual(ENVELOPES.stats);
    store.close();
  });

  it('replays the thread: preamble and roster first, form state last, no image', async () => {
    const store = seeded();
    const seen: { role: string; content: unknown }[][] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: unknown }[];
      };
      seen.push(body.messages);
      return answer(TANK);
    };
    const thread: ChatTurn[] = [
      { role: 'user', text: 'a tank' },
      { role: 'assistant', text: TANK },
      { role: 'user', text: 'faster' },
    ];
    const form = { ...twin(0, 'forged_d'), name: 'Quillmarrow' };
    const out = await suggestStats(deps(store, fetchFn), 1, {
      id: 'forged_d',
      messages: thread,
      def: form,
    });
    expect(out.ok).toBe(true);
    const msgs = seen[0]!;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const first = String(msgs[0]!.content);
    expect(first).toContain('The roster, for reference');
    expect(first).toContain('The creator says: a tank');
    expect(first).not.toContain('Quillmarrow');
    expect(msgs[1]!.content).toBe(TANK);
    const last = String(msgs[2]!.content);
    expect(last.startsWith('faster')).toBe(true);
    expect(last).toContain('Quillmarrow');
    expect(last).toContain('The stats on the form right now');
    store.close();
  });

  it('asks again on a shapeless answer, then reports honestly', async () => {
    const store = seeded();
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return answer(calls === 1 ? 'not json at all' : TANK);
    };
    const out = await suggestStats(deps(store, fetchFn), 1, { id: 'forged_d', messages: ASK });
    expect(out.ok).toBe(true);
    expect(calls).toBe(2);
    const alwaysBad = deps(store, async () => answer('still not json'));
    const bad = await suggestStats(alwaysBad, 1, { id: 'forged_d', messages: ASK });
    expect(bad).toMatchObject({
      ok: false,
      error: expect.stringContaining('did not clear validation'),
    });
    store.close();
  });

  it('gives up after the attempt budget and reports a stuck call plainly', async () => {
    const store = seeded();
    let calls = 0;
    const alwaysBad: typeof fetch = async () => {
      calls += 1;
      return answer('{}');
    };
    await suggestStats(deps(store, alwaysBad), 1, { id: 'forged_d', messages: ASK });
    expect(calls).toBe(SUGGEST_ATTEMPTS);
    const stuck: typeof fetch = async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    };
    const out = await suggestStats(deps(store, stuck), 1, { id: 'forged_d', messages: ASK });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('too long') });
    store.close();
  });

  it('reports the stages and the words as they stream', async () => {
    const store = seeded();
    const stages: string[] = [];
    let words = '';
    const out = await suggestStats(
      deps(store, async () => answer(TANK)),
      1,
      {
        id: 'forged_d',
        messages: ASK,
        onProgress: (p) => {
          if (p.kind === 'stage') stages.push(p.text);
          else words += p.text;
        },
      },
    );
    expect(out.ok).toBe(true);
    expect(stages[0]).toContain('shaping the stats');
    expect(words).toBe(TANK);
    store.close();
  });
});
