// The kit conversation: the surface answers honestly when unconfigured,
// works only for the owner's drafts with a chosen splash, replays the
// client-kept thread with the preamble and image on the first turn and
// the live form state on the last, and NOTHING lands unchecked: every
// proposal must clear validateForged, and a valid but timid kit is sent
// back for strengthening before being accepted as the fallback.

import { describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import {
  type ChatTurn,
  SUGGEST_ATTEMPTS,
  type SuggestDeps,
  suggestKit,
  threadError,
} from '../server/suggest';
import type { AbilityDef } from '../src/sim/combat/casting';
import { budgetOf, POWER_BUDGET } from '../src/sim/forge/budget';
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

// A kit that validates but barely spends the budget: four small
// skillshots on long cooldowns.
function faintAbility(name: string, cooldown: number): AbilityDef {
  return {
    name,
    manaCost: 50,
    cooldown,
    castRange: 6,
    spec: {
      kind: 'skillshot',
      speed: 20,
      radius: 0.8,
      range: 6,
      onHit: [{ kind: 'damage', base: 20, dtype: 'magic' }],
    },
  } as AbilityDef;
}
const WEAK_KIT = {
  passive: GOOD_KIT.passive,
  abilities: {
    Q: faintAbility('Faint Bolt', 12),
    W: faintAbility('Dim Spark', 14),
    E: faintAbility('Low Ember', 16),
    R: faintAbility('Soft Glow', 60),
  },
};

// The share of the kit's own budget a kit spends, for picking a floor
// between the weak and the good fixture deterministically.
function kitShare(def: ForgedChampionDef): number {
  const bill = budgetOf(def);
  const spend =
    bill.passive + bill.abilities.Q + bill.abilities.W + bill.abilities.E + bill.abilities.R;
  return spend / (POWER_BUDGET - bill.stats - bill.growth);
}

function answer(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
}

const ASK: ChatTurn[] = [{ role: 'user', text: 'a kit please' }];

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

function deps(store: ForgeStore, fetchFn: typeof fetch, budgetFloor = 0): SuggestDeps {
  return {
    store,
    apiKey: 'k-test',
    assetsDir: 'ASSETS',
    budgetFloor,
    fetchFn,
    readImage: () => Buffer.from('png-bytes'),
  };
}

describe('threadError', () => {
  it('accepts a well formed thread and rejects the malformed ones', () => {
    expect(threadError(ASK)).toBeNull();
    expect(
      threadError([
        { role: 'user', text: 'a' },
        { role: 'assistant', text: 'b' },
        { role: 'user', text: 'c' },
      ]),
    ).toBeNull();
    expect(threadError([])).toContain('malformed');
    expect(threadError('nope')).toContain('malformed');
    // Ends on an assistant turn: nothing to answer.
    expect(
      threadError([
        { role: 'user', text: 'a' },
        { role: 'assistant', text: 'b' },
      ]),
    ).toContain('malformed');
    // Two same-role turns in a row.
    expect(
      threadError([
        { role: 'user', text: 'a' },
        { role: 'user', text: 'b' },
      ]),
    ).toContain('malformed');
    expect(threadError([{ role: 'user', text: 'x'.repeat(3000) }])).toContain('too long');
  });
});

describe('suggestKit', () => {
  it('answers honestly when no key is configured', async () => {
    const store = seeded();
    const out = await suggestKit({ store, apiKey: null, assetsDir: 'A' }, 1, {
      id: 'forged_d',
      messages: ASK,
    });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('not configured') });
    store.close();
  });

  it('refuses another account, a sealed kit, and a splashless draft', async () => {
    const store = seeded();
    const d = deps(store, () => {
      throw new Error('must not be called');
    });
    expect((await suggestKit(d, 2, { id: 'forged_d', messages: ASK })).ok).toBe(false);
    expect(await suggestKit(d, 1, { id: 'forged_sealed', messages: ASK })).toMatchObject({
      ok: false,
      error: expect.stringContaining('sealed'),
    });
    store.saveForged({
      id: 'forged_bare',
      accountId: 1,
      def: twin(3, 'forged_bare'),
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(await suggestKit(d, 1, { id: 'forged_bare', messages: ASK })).toMatchObject({
      ok: false,
      error: expect.stringContaining('splash'),
    });
    expect(await suggestKit(d, 1, { id: 'forged_d', messages: [] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('malformed'),
    });
    store.close();
  });

  it('returns a validated kit with its comment and budget bill', async () => {
    const store = seeded();
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fetchFn = ((url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return Promise.resolve(
        answer(JSON.stringify({ comment: 'Leaned into frost.', ...GOOD_KIT })),
      );
    }) as unknown as typeof fetch;
    const out = await suggestKit(deps(store, fetchFn), 1, { id: 'forged_d', messages: ASK });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.comment).toBe('Leaned into frost.');
      expect(out.passive).toEqual(GOOD_KIT.passive);
      expect(out.abilities.R.name).toBe(GOOD_KIT.abilities.R.name);
      expect(out.budget.cap).toBe(POWER_BUDGET);
      expect(out.budget.total).toBeGreaterThan(0);
      expect(out.raw).toContain('Leaned into frost.');
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('api.anthropic.com');
    // Nothing was stored: the proposal is the editor's to apply.
    expect(store.getForged('forged_d')?.def.passive).toEqual(twin(0, 'forged_d').passive);
    store.close();
  });

  it('replays the thread: image and preamble first, form state last', async () => {
    const store = seeded();
    const bodies: { messages: { role: string; content: unknown }[] }[] = [];
    const fetchFn = ((_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as (typeof bodies)[number]);
      return Promise.resolve(answer(JSON.stringify({ comment: 'ok', ...GOOD_KIT })));
    }) as unknown as typeof fetch;
    const thread: ChatTurn[] = [
      { role: 'user', text: 'a poison theme' },
      { role: 'assistant', text: 'RAW PRIOR ANSWER' },
      { role: 'user', text: 'more mobility on E' },
    ];
    const out = await suggestKit(deps(store, fetchFn), 1, { id: 'forged_d', messages: thread });
    expect(out.ok).toBe(true);
    const sent = bodies[0]?.messages ?? [];
    expect(sent).toHaveLength(3);
    const first = sent[0]?.content as { type: string; text?: string }[];
    expect(first[0]?.type).toBe('image');
    expect(first[1]?.text).toContain('power budget');
    expect(first[1]?.text).toContain('The creator says: a poison theme');
    expect(first[1]?.text).not.toContain('The kit on the form right now');
    expect(sent[1]).toEqual({ role: 'assistant', content: 'RAW PRIOR ANSWER' });
    expect(sent[2]?.content).toContain('more mobility on E');
    expect(sent[2]?.content).toContain('The kit on the form right now');
    store.close();
  });

  it('retries with the validator errors, then reports honestly', async () => {
    const store = seeded();
    let n = 0;
    const feedback: string[] = [];
    const badKit = {
      passive: GOOD_KIT.passive,
      abilities: { ...GOOD_KIT.abilities, Q: { ...GOOD_KIT.abilities.Q, cooldown: 999 } },
    };
    const fetchFn = ((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: unknown }[];
      };
      const last = body.messages[body.messages.length - 1];
      feedback.push(typeof last?.content === 'string' ? last.content : '');
      n += 1;
      return Promise.resolve(answer(JSON.stringify(n === 1 ? badKit : GOOD_KIT)));
    }) as unknown as typeof fetch;
    const out = await suggestKit(deps(store, fetchFn), 1, { id: 'forged_d', messages: ASK });
    expect(out.ok).toBe(true);
    expect(n).toBe(2);
    expect(feedback[1]).toContain('failed validation');
    // Only bad answers end in an honest refusal, never a bad kit.
    let m = 0;
    const alwaysBad = (() => {
      m += 1;
      return Promise.resolve(answer(JSON.stringify(badKit)));
    }) as unknown as typeof fetch;
    const bad = await suggestKit(deps(store, alwaysBad), 1, { id: 'forged_d', messages: ASK });
    expect(m).toBe(SUGGEST_ATTEMPTS);
    expect(bad).toMatchObject({
      ok: false,
      error: expect.stringContaining('did not clear validation'),
    });
    store.close();
  });

  it('pushes a timid kit to strengthen, and falls back to it honestly', async () => {
    const store = seeded();
    const base = twin(0, 'forged_d');
    const weakShare = kitShare({ ...base, ...WEAK_KIT });
    const goodShare = kitShare({ ...base, ...GOOD_KIT });
    expect(weakShare).toBeLessThan(goodShare);
    // A floor strictly between the two fixtures: the weak kit triggers
    // the strengthen retry, the good one passes.
    const floor = (weakShare + goodShare) / 2;
    let n = 0;
    const feedback: string[] = [];
    const fetchFn = ((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: unknown }[];
      };
      const last = body.messages[body.messages.length - 1];
      feedback.push(typeof last?.content === 'string' ? last.content : '');
      n += 1;
      return Promise.resolve(answer(JSON.stringify(n === 1 ? WEAK_KIT : GOOD_KIT)));
    }) as unknown as typeof fetch;
    const out = await suggestKit(deps(store, fetchFn, floor), 1, { id: 'forged_d', messages: ASK });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.abilities.Q.name).toBe(GOOD_KIT.abilities.Q.name);
    expect(n).toBe(2);
    expect(feedback[1]).toContain('timid');
    // Always timid: the valid weak kit still returns, never an error.
    let m = 0;
    const alwaysWeak = (() => {
      m += 1;
      return Promise.resolve(answer(JSON.stringify(WEAK_KIT)));
    }) as unknown as typeof fetch;
    const timid = await suggestKit(deps(store, alwaysWeak, floor), 1, {
      id: 'forged_d',
      messages: ASK,
    });
    expect(m).toBe(SUGGEST_ATTEMPTS);
    expect(timid.ok).toBe(true);
    if (timid.ok) expect(timid.abilities.Q.name).toBe('Faint Bolt');
    store.close();
  });
});
