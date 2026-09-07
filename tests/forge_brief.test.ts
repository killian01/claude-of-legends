// The brief (server/forge_brief.ts): one line in, a whole champion out.
// It answers honestly when unconfigured, works on the owner's drafts
// only, and NOTHING it writes escapes the rules: the kit is fitted to
// its envelope, the body to the Stat and Growth lines, the names must be
// English and pass the card filter, the role must be one of ours, and
// the whole champion must clear validateForged before the editor ever
// sees it. A turn is billed once, on the answer, however many internal
// retries it took.

import { describe, expect, it } from 'vitest';
import { EMBER_PRICES } from '../server/embers';
import { BRIEF_LINE_MAX, briefChampion } from '../server/forge_brief';
import { ForgeStore } from '../server/forge_store';
import { SUGGEST_ATTEMPTS, type SuggestDeps } from '../server/suggest';
import { budgetOf } from '../src/sim/forge/budget';
import { ENVELOPES, envelopeSpend, KIT_ENVELOPE } from '../src/sim/forge/envelopes';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { validateForged } from '../src/sim/forge/validate';
import { FORGED_TWINS } from './forged_twins';

function twin(i: number, id: string): ForgedChampionDef {
  return { ...FORGED_TWINS[i]!, id, creator: 'alice' };
}

// A model answer as the non-streaming shape askModel also accepts, with
// the usage block that makes the turn billable.
function answer(text: string, usage = { input_tokens: 10, output_tokens: 20 }): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }], usage }), {
    status: 200,
  });
}

// A whole champion in one answer: a roster twin's kit (which is the
// budget's own calibration set, so it fits) with a light melee body the
// stat fit raises onto both lines.
function briefAnswer(over: Record<string, unknown> = {}): string {
  const source = FORGED_TWINS[0]!;
  return JSON.stringify({
    comment: 'A wall that punishes the patient.',
    name: 'Bramwell',
    title: 'the Standing Gate',
    tagline: 'Holds the lane and makes leaving it expensive',
    role: 'Tank',
    splash: 'A mossy stone warden with a shield of layered slate, one amber lantern at the belt',
    passive: source.passive,
    abilities: source.abilities,
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
    ...over,
  });
}

const SEED = 200;

function seeded(): ForgeStore {
  const store = new ForgeStore(':memory:');
  store.addCreditEntry({ accountId: 1, delta: SEED, reason: 'weekly_grant', at: 1 });
  store.addCreditEntry({ accountId: 1, delta: 0, reason: 'ember_migration', at: 1 });
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
  return { store, apiKey: 'k-test', assetsDir: 'ASSETS', fetchFn, now: () => 5 };
}

const LINE = 'a stone warden who makes leaving the lane expensive';

describe('briefChampion', () => {
  it('answers honestly when no key is configured', async () => {
    const store = seeded();
    const out = await briefChampion({ store, apiKey: null, assetsDir: 'A' }, 1, {
      id: 'forged_d',
      line: LINE,
    });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('not configured') });
    store.close();
  });

  it('refuses another account, a sealed champion, and an empty or huge line', async () => {
    const store = seeded();
    const d = deps(store, async () => answer(briefAnswer()));
    expect((await briefChampion(d, 2, { id: 'forged_d', line: LINE })).ok).toBe(false);
    expect(await briefChampion(d, 1, { id: 'forged_sealed', line: LINE })).toMatchObject({
      ok: false,
      error: expect.stringContaining('sealed'),
    });
    expect(await briefChampion(d, 1, { id: 'forged_d', line: '   ' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('one line'),
    });
    expect(
      await briefChampion(d, 1, { id: 'forged_d', line: 'x'.repeat(BRIEF_LINE_MAX + 1) }),
    ).toMatchObject({ ok: false, error: expect.stringContaining(String(BRIEF_LINE_MAX)) });
    // Every one of those refused before the ledger moved.
    expect(store.creditBalance(1)).toBe(SEED);
    store.close();
  });

  it('returns a whole champion, fitted, validated, and billed once', async () => {
    const store = seeded();
    let calls = 0;
    const out = await briefChampion(
      deps(store, async () => {
        calls += 1;
        return answer(briefAnswer());
      }),
      1,
      { id: 'forged_d', line: LINE },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(calls).toBe(1);
    // Identity, in the creator's words back: a name, a role of ours, and
    // the line the splash step starts from.
    expect(out.name).toBe('Bramwell');
    expect(out.role).toBe('Tank');
    expect(out.splash).toContain('mossy stone warden');
    expect(out.comment).toBe('A wall that punishes the patient.');
    // The champion it proposes is a champion the game accepts, as it
    // stands: the same gate the build and the seal use.
    const built: ForgedChampionDef = {
      ...twin(0, 'forged_d'),
      name: out.name,
      title: out.title,
      tagline: out.tagline,
      role: out.role,
      passive: out.passive,
      abilities: out.abilities,
      base: out.base,
      growth: out.growth,
    };
    expect(validateForged(built).ok).toBe(true);
    const spend = envelopeSpend(budgetOf(built));
    expect(spend.stats).toBeLessThanOrEqual(ENVELOPES.stats);
    expect(spend.growth).toBeLessThanOrEqual(ENVELOPES.growth);
    expect(spend.kit).toBeLessThanOrEqual(KIT_ENVELOPE);
    expect(out.budget.kit.cap).toBe(KIT_ENVELOPE);
    // The body was light and came back on its lines.
    expect(out.budget.stats.spend).toBeGreaterThan(ENVELOPES.stats - 3);
    expect(out.budget.growth.spend).toBeGreaterThan(ENVELOPES.growth - 3);
    // One turn, one debit, on the answer.
    expect(store.creditBalance(1)).toBe(SEED - EMBER_PRICES.kitTurn);
    expect(store.listSpendSamples()).toMatchObject([{ action: 'agent', detail: 'kit' }]);
    store.close();
  });

  it('refuses to run at all when the balance cannot pay for the turn', async () => {
    const store = seeded();
    store.addCreditEntry({ accountId: 1, delta: -SEED, reason: 'spend', at: 2 });
    let calls = 0;
    const out = await briefChampion(
      deps(store, async () => {
        calls += 1;
        return answer(briefAnswer());
      }),
      1,
      { id: 'forged_d', line: LINE },
    );
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('embers') });
    expect(calls).toBe(0);
    store.close();
  });

  it('sends a role of ours back for a fix, and takes the corrected answer', async () => {
    const store = seeded();
    const asked: string[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      asked.push(String(body.messages.at(-1)?.content));
      return answer(
        asked.length === 1 ? briefAnswer({ role: 'Necromancer' }) : briefAnswer({ role: 'tank' }),
      );
    };
    const out = await briefChampion(deps(store, fetchFn), 1, { id: 'forged_d', line: LINE });
    expect(out.ok).toBe(true);
    // The correction names the role that was wrong and the ones allowed.
    expect(asked[1]).toContain('Necromancer');
    expect(asked[1]).toContain('Tank');
    // A role in the wrong case is still one of ours, not a second retry.
    if (out.ok) expect(out.role).toBe('Tank');
    store.close();
  });

  it('sends a word that cannot go on a card back for a rewrite', async () => {
    const store = seeded();
    const asked: string[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      asked.push(String(body.messages.at(-1)?.content));
      return answer(
        asked.length === 1
          ? briefAnswer({ tagline: 'Holds the lane, shit on the rest' })
          : briefAnswer(),
      );
    };
    const out = await briefChampion(deps(store, fetchFn), 1, { id: 'forged_d', line: LINE });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.tagline).toBe('Holds the lane and makes leaving it expensive');
    expect(asked[1]).toContain('cannot appear on a champion card');
    store.close();
  });

  it('gives up in the validator words when every attempt breaks a rule', async () => {
    const store = seeded();
    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      // A cooldown far outside the bounds: no fit can rescue it.
      const source = FORGED_TWINS[0]!;
      const abilities = structuredClone(source.abilities);
      abilities.Q.cooldown = 9999;
      return answer(briefAnswer({ abilities }));
    };
    const out = await briefChampion(deps(store, fetchFn), 1, { id: 'forged_d', line: LINE });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('validation') });
    expect(calls).toBe(SUGGEST_ATTEMPTS);
    store.close();
  });

  it('reports the stages and the model text as it writes', async () => {
    const store = seeded();
    const seen: string[] = [];
    const out = await briefChampion(
      deps(store, async () => answer(briefAnswer())),
      1,
      {
        id: 'forged_d',
        line: LINE,
        onProgress: (p) => seen.push(p.kind),
      },
    );
    expect(out.ok).toBe(true);
    // A stage before the call, the model's own text, then the stage that
    // says the rules are being checked: no silent minute.
    expect(seen[0]).toBe('stage');
    expect(seen).toContain('text');
    expect(seen.at(-1)).toBe('stage');
    store.close();
  });
});
