// Kit suggestions from the splash art: the surface answers honestly
// when unconfigured, works only for the owner's drafts with a chosen
// splash, and NOTHING lands unchecked: a suggestion must clear
// validateForged, with one retry carrying the validator's errors back.

import { describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import { type SuggestDeps, suggestKit } from '../server/suggest';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { FORGED_TWINS } from './forged_twins';

function twin(i: number, id: string): ForgedChampionDef {
  return { ...FORGED_TWINS[i]!, id, creator: 'alice' };
}

// A valid kit to answer with: a twin's own passive and abilities (the
// roster is the proof they clear the budget).
const GOOD_KIT = {
  passive: FORGED_TWINS[2]!.passive,
  abilities: FORGED_TWINS[2]!.abilities,
};

function answer(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
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
  store.saveForged({
    id: 'forged_sealed',
    accountId: 1,
    def: twin(1, 'forged_sealed'),
    status: 'finalized',
    createdAt: 1,
    updatedAt: 1,
  });
  const cid = store.addArtCandidate({
    forgedId: 'forged_d',
    accountId: 1,
    kind: 'splash',
    prompt: 'p',
    path: 'forged/forged_d/art/splash_1.png',
    provenance: null,
    at: 1,
  });
  store.chooseArtCandidate('forged_d', 'splash', cid);
  return store;
}

function deps(store: ForgeStore, fetchFn: typeof fetch): SuggestDeps {
  return {
    store,
    apiKey: 'k-test',
    assetsDir: 'ASSETS',
    fetchFn,
    readImage: () => Buffer.from('png-bytes'),
  };
}

describe('suggestKit', () => {
  it('answers honestly when no key is configured', async () => {
    const store = seeded();
    const out = await suggestKit({ store, apiKey: null, assetsDir: 'A' }, 1, 'forged_d');
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('not configured') });
    store.close();
  });

  it('refuses another account, a sealed kit, and a splashless draft', async () => {
    const store = seeded();
    const d = deps(store, () => {
      throw new Error('must not be called');
    });
    expect((await suggestKit(d, 2, 'forged_d')).ok).toBe(false);
    expect(await suggestKit(d, 1, 'forged_sealed')).toMatchObject({
      ok: false,
      error: expect.stringContaining('sealed'),
    });
    // The sealed row HAS no splash either, but the seal answers first;
    // the draft without a chosen splash gets the splash message.
    store.saveForged({
      id: 'forged_bare',
      accountId: 1,
      def: twin(3, 'forged_bare'),
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await suggestKit(d, 1, 'forged_bare')).toMatchObject({
      ok: false,
      error: expect.stringContaining('splash'),
    });
    store.close();
  });

  it('returns a validated kit and sends the splash image to the model', async () => {
    const store = seeded();
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchFn = ((url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Promise.resolve(answer(`Here you go: ${JSON.stringify(GOOD_KIT)}`));
    }) as unknown as typeof fetch;
    const out = await suggestKit(deps(store, fetchFn), 1, 'forged_d');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.passive).toEqual(GOOD_KIT.passive);
      expect(out.abilities.R.name).toBe(GOOD_KIT.abilities.R.name);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('api.anthropic.com');
    const messages = (calls[0]?.body.messages ?? []) as { content: { type: string }[] }[];
    expect(messages[0]?.content[0]?.type).toBe('image');
    // Nothing was stored: the suggestion is the editor's to apply.
    expect(store.getForged('forged_d')?.def.passive).toEqual(twin(0, 'forged_d').passive);
    store.close();
  });

  it('retries once with the validator errors, then reports honestly', async () => {
    const store = seeded();
    let n = 0;
    const prompts: string[] = [];
    const badKit = {
      passive: GOOD_KIT.passive,
      // An out-of-bounds cooldown fails boundsErrors, driving the retry.
      abilities: { ...GOOD_KIT.abilities, Q: { ...GOOD_KIT.abilities.Q, cooldown: 999 } },
    };
    const fetchFn = ((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { content: { type: string; text?: string }[] }[];
      };
      prompts.push(body.messages[0]?.content[1]?.text ?? '');
      n += 1;
      return Promise.resolve(answer(JSON.stringify(n === 1 ? badKit : GOOD_KIT)));
    }) as unknown as typeof fetch;
    const out = await suggestKit(deps(store, fetchFn), 1, 'forged_d');
    expect(out.ok).toBe(true);
    expect(n).toBe(2);
    expect(prompts[1]).toContain('failed validation');
    // Two bad answers end in an honest refusal, never a bad kit.
    let m = 0;
    const alwaysBad = (() => {
      m += 1;
      return Promise.resolve(answer(JSON.stringify(badKit)));
    }) as unknown as typeof fetch;
    const bad = await suggestKit(deps(store, alwaysBad), 1, 'forged_d');
    expect(m).toBe(2);
    expect(bad).toMatchObject({
      ok: false,
      error: expect.stringContaining('did not clear validation'),
    });
    store.close();
  });
});
