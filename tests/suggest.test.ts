// The kit conversation: the surface answers honestly when unconfigured,
// works only for the owner's drafts with a chosen splash, replays the
// client-kept thread with the preamble and image on the first turn and
// the live form state on the last, and NOTHING lands unchecked: every
// proposal is fitted to the budget line by the power dial's own scaling
// and must then clear validateForged, and a kit too light even at the
// dial's maximum is sent back for more structure before being accepted
// as the fallback.

import { describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import {
  BUDGET_FLOOR_DEFAULT,
  type ChatTurn,
  imageMediaType,
  SUGGEST_ATTEMPTS,
  type SuggestDeps,
  suggestKit,
  threadError,
} from '../server/suggest';
import type { AbilityDef } from '../src/sim/combat/casting';
import { budgetOf, POWER_BUDGET } from '../src/sim/forge/budget';
import { KIT_ENVELOPE, kitSpendOf } from '../src/sim/forge/envelopes';
import type { ForgedChampionDef } from '../src/sim/forge/forged_def';
import { scaleAbility } from '../src/sim/forge/spell_power';
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

// The share of the kit envelope a kit spends, for picking a floor
// between the weak and the good fixture deterministically.
function kitShare(def: ForgedChampionDef): number {
  return kitSpendOf(budgetOf(def)) / KIT_ENVELOPE;
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
      expect(out.budget.cap).toBe(KIT_ENVELOPE);
      expect(out.budget.total).toBeGreaterThan(0);
      expect(out.held).toEqual([]);
      expect(out.raw).toContain('Leaned into frost.');
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('api.anthropic.com');
    // Nothing was stored: the proposal is the editor's to apply.
    expect(store.getForged('forged_d')?.def.passive).toEqual(twin(0, 'forged_d').passive);
    store.close();
  });

  it('keeps the flavor lines through the fit, and sends a foreign one back', async () => {
    const store = seeded();
    const flavored = {
      passive: { ...GOOD_KIT.passive, flavor: 'The cold remembers every wound.' },
      abilities: {
        ...GOOD_KIT.abilities,
        Q: { ...GOOD_KIT.abilities.Q, flavor: 'A shard of frozen night streaks out.' },
      },
    };
    const out = await suggestKit(
      deps(store, async () => answer(JSON.stringify(flavored))),
      1,
      {
        id: 'forged_d',
        messages: ASK,
      },
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.abilities.Q.flavor).toBe('A shard of frozen night streaks out.');
      expect(out.passive.flavor).toBe('The cold remembers every wound.');
    }
    let calls = 0;
    const foreign = {
      ...flavored,
      abilities: { ...flavored.abilities, W: { ...GOOD_KIT.abilities.W, flavor: 'Un éclat.' } },
    };
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return answer(JSON.stringify(calls === 1 ? foreign : flavored));
    };
    const fixed = await suggestKit(deps(store, fetchFn), 1, { id: 'forged_d', messages: ASK });
    expect(fixed.ok).toBe(true);
    expect(calls).toBe(2);
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
    expect(feedback[1]).toContain('too light');
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

describe('the fit', () => {
  it('lands a light kit on the budget line in one call and reports the factor', async () => {
    const store = seeded();
    let n = 0;
    let signals = 0;
    const fetchFn = ((_url: string, init?: RequestInit) => {
      n += 1;
      if (init?.signal instanceof AbortSignal) signals += 1;
      return Promise.resolve(answer(JSON.stringify({ comment: 'ok', ...GOOD_KIT })));
    }) as unknown as typeof fetch;
    const base = twin(0, 'forged_d');
    expect(kitSpendOf(budgetOf({ ...base, ...GOOD_KIT }))).toBeLessThan(KIT_ENVELOPE);
    const out = await suggestKit(deps(store, fetchFn, BUDGET_FLOOR_DEFAULT), 1, {
      id: 'forged_d',
      messages: ASK,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fit).toBeGreaterThan(1);
      expect(out.budget.total).toBeLessThanOrEqual(POWER_BUDGET);
      // The kit lands on its envelope line: the whole bill is the body
      // plus a full envelope.
      const spend = kitSpendOf(budgetOf({ ...base, ...GOOD_KIT, abilities: out.abilities }));
      expect(spend).toBeLessThanOrEqual(KIT_ENVELOPE);
      expect(spend).toBeGreaterThanOrEqual(KIT_ENVELOPE - 1);
      // Structure and rhythm stay the model's; the raw answer is replayed
      // as it was said.
      expect(out.abilities.Q.spec.kind).toBe(GOOD_KIT.abilities.Q.spec.kind);
      expect(out.abilities.Q.cooldown).toBe(GOOD_KIT.abilities.Q.cooldown);
      expect(out.raw).toContain(GOOD_KIT.abilities.Q.name);
    }
    // One call, no strengthening round trip; and the call carries a
    // timeout signal, so a stuck model cannot hang the conversation.
    expect(n).toBe(1);
    expect(signals).toBe(1);
    store.close();
  });

  it('trims a heavy kit to the line instead of sending it back', async () => {
    const store = seeded();
    const heavy = {
      passive: GOOD_KIT.passive,
      abilities: {
        Q: scaleAbility(GOOD_KIT.abilities.Q, 2.4),
        W: scaleAbility(GOOD_KIT.abilities.W, 2.4),
        E: scaleAbility(GOOD_KIT.abilities.E, 2.4),
        R: scaleAbility(GOOD_KIT.abilities.R, 2.4),
      },
    };
    expect(kitSpendOf(budgetOf({ ...twin(0, 'forged_d'), ...heavy }))).toBeGreaterThan(
      KIT_ENVELOPE,
    );
    let n = 0;
    const fetchFn = (() => {
      n += 1;
      return Promise.resolve(answer(JSON.stringify({ comment: 'big', ...heavy })));
    }) as unknown as typeof fetch;
    const out = await suggestKit(deps(store, fetchFn, BUDGET_FLOOR_DEFAULT), 1, {
      id: 'forged_d',
      messages: ASK,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fit).toBeLessThan(1);
      expect(out.budget.total).toBeLessThanOrEqual(POWER_BUDGET);
    }
    expect(n).toBe(1);
    store.close();
  });

  it('never crashes on a shapeless answer: the validator speaks instead', async () => {
    const store = seeded();
    const shapeless = {
      passive: GOOD_KIT.passive,
      abilities: { Q: { name: 'q' }, W: { name: 'w' }, E: 'nope', R: null },
    };
    let n = 0;
    const fetchFn = (() => {
      n += 1;
      return Promise.resolve(answer(JSON.stringify(shapeless)));
    }) as unknown as typeof fetch;
    const out = await suggestKit(deps(store, fetchFn), 1, { id: 'forged_d', messages: ASK });
    expect(out).toMatchObject({
      ok: false,
      error: expect.stringContaining('did not clear validation'),
    });
    expect(n).toBe(SUGGEST_ATTEMPTS);
    store.close();
  });

  it('reports a stuck model call plainly', async () => {
    const store = seeded();
    const fetchFn = (() => {
      const err = new Error('signal timed out');
      err.name = 'TimeoutError';
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    const out = await suggestKit(deps(store, fetchFn), 1, { id: 'forged_d', messages: ASK });
    expect(out).toMatchObject({ ok: false, error: expect.stringContaining('too long') });
    store.close();
  });
});

describe('the stream', () => {
  // The Messages API's server-sent events for one text answer, chunked
  // twice: text deltas of `chunk` chars, then the byte stream cut at
  // arbitrary points, so the reader must reassemble frames.
  function sse(text: string, chunk = 40): Response {
    const frames = ['event: message_start\ndata: {"type":"message_start"}\n\n'];
    for (let i = 0; i < text.length; i += chunk) {
      const delta = { type: 'text_delta', text: text.slice(i, i + chunk) };
      const event = { type: 'content_block_delta', index: 0, delta };
      frames.push(`event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`);
    }
    frames.push('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    const whole = frames.join('');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < whole.length; i += 57) {
          controller.enqueue(new TextEncoder().encode(whole.slice(i, i + 57)));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  it('reads the answer off server-sent events and reports every piece', async () => {
    const store = seeded();
    const full = JSON.stringify({ comment: 'Un kit de givre, tres mobile.', ...GOOD_KIT });
    let asked: Record<string, unknown> = {};
    const fetchFn = ((_u: string, init?: RequestInit) => {
      asked = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(sse(full));
    }) as unknown as typeof fetch;
    const heard: string[] = [];
    const stages: string[] = [];
    const out = await suggestKit(deps(store, fetchFn), 1, {
      id: 'forged_d',
      messages: ASK,
      onProgress: (p) => {
        if (p.kind === 'text') heard.push(p.text);
        else stages.push(p.text);
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.raw).toBe(full);
      expect(out.comment).toBe('Un kit de givre, tres mobile.');
    }
    // Streamed, and without hidden reasoning: the wait is the writing.
    expect(asked.stream).toBe(true);
    expect(asked.thinking).toEqual({ type: 'disabled' });
    expect(heard.join('')).toBe(full);
    expect(heard.length).toBeGreaterThan(1);
    expect(stages[0]).toContain('writing');
    expect(stages[1]).toContain('Fitting');
    store.close();
  });

  it('declares the image type from its bytes, whatever the file is called', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const [bytes, type] of [
      [jpeg, 'image/jpeg'],
      [png, 'image/png'],
    ] as const) {
      // The seeded splash is called splash_1.png either way.
      const store = seeded();
      let declared = '';
      const fetchFn = ((_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: { content: { source?: { media_type: string } }[] }[];
        };
        declared = body.messages[0]?.content[0]?.source?.media_type ?? '';
        return Promise.resolve(answer(JSON.stringify({ comment: 'ok', ...GOOD_KIT })));
      }) as unknown as typeof fetch;
      const d: SuggestDeps = { ...deps(store, fetchFn), readImage: () => bytes };
      expect((await suggestKit(d, 1, { id: 'forged_d', messages: ASK })).ok).toBe(true);
      expect(declared).toBe(type);
      store.close();
    }
    expect(imageMediaType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(imageMediaType(Buffer.from('GIF89a'))).toBe('image/gif');
  });

  it('sends names that are not plain English back, whatever the creator spoke', async () => {
    const store = seeded();
    const accented = {
      passive: GOOD_KIT.passive,
      abilities: { ...GOOD_KIT.abilities, Q: { ...GOOD_KIT.abilities.Q, name: 'Epee de Givre' } },
    };
    (accented.abilities.Q as { name: string }).name = '\u00c9p\u00e9e de Givre';
    let n = 0;
    const feedback: string[] = [];
    const fetchFn = ((_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: unknown }[];
      };
      const last = body.messages[body.messages.length - 1];
      feedback.push(typeof last?.content === 'string' ? last.content : '');
      n += 1;
      return Promise.resolve(answer(JSON.stringify(n === 1 ? accented : GOOD_KIT)));
    }) as unknown as typeof fetch;
    const out = await suggestKit(deps(store, fetchFn), 1, {
      id: 'forged_d',
      messages: [{ role: 'user', text: 'un kit de glace' }],
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.abilities.Q.name).toBe(GOOD_KIT.abilities.Q.name);
    expect(n).toBe(2);
    expect(feedback[1]).toContain('English');
    expect(feedback[1]).toContain('\u00c9p\u00e9e de Givre');
    store.close();
  });
});
