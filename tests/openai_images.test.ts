// The 2D provider bought direct. Two things are worth pinning and the
// rest is plumbing: that a call's cost comes out in the unit the ledger
// calibrates against, since the whole reason this exists is that the same
// image was costing 10 cents instead of 4, and that a content refusal is
// told from an outage, because one refunds as blocked and the other does
// not (ADR 0007).

import { describe, expect, it } from 'vitest';
import {
  costInCents,
  DEFAULT_IMAGE_MODEL,
  OPENAI_IMAGE_RATES,
  OpenAIImages,
} from '../server/generation/openai_images';
import { GenerationError } from '../server/generation/provider';

// The usage OpenAI really returned for the splash the Forge really sends,
// 1024x1536 at medium, on 2026-09-06. The numbers in the comments of
// server/embers.ts are this call.
const MEASURED = {
  input_tokens: 98,
  input_tokens_details: { text_tokens: 98, image_tokens: 0 },
  output_tokens: 1372,
};

const PNG = 'iVBORw0KGgo=';

function reply(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })) as unknown as typeof fetch;
}

describe('what a call cost', () => {
  it('is the measured splash, in cents, to the tenth', () => {
    // 98 text at 5 dollars a million and 1372 image out at 30 is 4.165
    // cents. Tripo charges 10 for the same picture; that gap is the whole
    // change.
    expect(costInCents('gpt-image-2', MEASURED)).toBeCloseTo(4.165, 3);
  });

  it('prices the small model from its own rates', () => {
    expect(
      costInCents('gpt-image-1-mini', {
        input_tokens: 98,
        input_tokens_details: { text_tokens: 98, image_tokens: 0 },
        output_tokens: 1584,
      }),
      // 1584 image out at 8 dollars a million is 1.2672 cents, plus the
      // 98 text tokens at 2, which is the part it is easy to drop.
    ).toBeCloseTo(1.2868, 4);
  });

  it('counts an input image at the input-image rate, not the text one', () => {
    // An edit carries the source image in, and it is not free: 1000 image
    // tokens in at 8 dollars a million is 0.8 cents on top.
    const withSource = costInCents('gpt-image-2', {
      input_tokens: 1098,
      input_tokens_details: { text_tokens: 98, image_tokens: 1000 },
      output_tokens: 1372,
    });
    expect(withSource).toBeCloseTo(4.165 + 0.8, 3);
  });

  it('says nothing rather than guess for a model it has no rate for', () => {
    // A wrong price written into the ledger is worse than no price: the
    // spend log would read as truth for a year.
    expect(costInCents('some-model-shipped-next-quarter', MEASURED)).toBeUndefined();
    expect(costInCents(DEFAULT_IMAGE_MODEL, undefined)).toBeUndefined();
  });

  it('has a rate for the model it generates with by default', () => {
    expect(OPENAI_IMAGE_RATES[DEFAULT_IMAGE_MODEL]).toBeDefined();
  });
});

describe('one generation', () => {
  it('comes back as a data URL, so the pipeline downloads it unchanged', async () => {
    // The pipeline fetches ProviderAsset.url straight to disk. Node reads
    // data URLs, so a provider that hands back bytes needs nothing taught
    // to it downstream.
    const api = new OpenAIImages('k', {
      fetchImpl: reply({ data: [{ b64_json: PNG }], usage: MEASURED }),
      now: () => 1_700_000,
    });
    const asset = await api.generate2D({ prompt: 'a duelist' });
    expect(asset.url).toBe(`data:image/png;base64,${PNG}`);
    expect(asset.cost).toBeCloseTo(4.165, 3);
    expect(asset.provenance).toMatchObject({ provider: 'openai', model: DEFAULT_IMAGE_MODEL });
    expect(asset.provenance.taskId).toBe(asset.taskId);
  });

  it('posts to generations without a source and to edits with one', async () => {
    const seen: { url: string; isForm: boolean }[] = [];
    const spy = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), isForm: init.body instanceof FormData });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG }], usage: MEASURED }));
    }) as unknown as typeof fetch;
    const api = new OpenAIImages('k', { fetchImpl: spy });
    await api.generate2D({ prompt: 'a duelist' });
    await api.generate2D({
      prompt: 'now in a storm',
      image: { data: new Uint8Array([1, 2, 3]), name: 'splash.png' },
    });
    expect(seen[0]?.url).toContain('/images/generations');
    expect(seen[0]?.isForm).toBe(false);
    expect(seen[1]?.url).toContain('/images/edits');
    expect(seen[1]?.isForm).toBe(true);
  });

  it('reports no cost rather than a wrong one when usage is absent', async () => {
    const api = new OpenAIImages('k', { fetchImpl: reply({ data: [{ b64_json: PNG }] }) });
    expect((await api.generate2D({ prompt: 'x' })).cost).toBeUndefined();
  });
});

describe('a failure', () => {
  const fails = (body: unknown, status: number) =>
    new OpenAIImages('k', { fetchImpl: reply(body, status) }).generate2D({ prompt: 'x' });

  it('is blocked when the refusal is about content', async () => {
    // Blocked and technical both refund; only blocked may tell the player
    // their words were the problem.
    await expect(
      fails({ error: { code: 'moderation_blocked', message: 'rejected by safety' } }, 400),
    ).rejects.toMatchObject({ blocked: true });
  });

  it('is not blocked when the vendor is merely having a day', async () => {
    await expect(fails({ error: { message: 'rate limited' } }, 429)).rejects.toMatchObject({
      blocked: false,
    });
    await expect(fails({ error: { message: 'upstream' } }, 500)).rejects.toMatchObject({
      blocked: false,
    });
  });

  it('is not blocked on a 400 that is about the request', async () => {
    await expect(
      fails({ error: { code: 'invalid_size', message: 'size not supported' } }, 400),
    ).rejects.toMatchObject({ blocked: false });
  });

  it('is a GenerationError when the answer holds no image at all', async () => {
    await expect(
      new OpenAIImages('k', { fetchImpl: reply({ data: [] }) }).generate2D({ prompt: 'x' }),
    ).rejects.toBeInstanceOf(GenerationError);
    await expect(
      new OpenAIImages('k', { fetchImpl: reply('not json at all') }).generate2D({ prompt: 'x' }),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});
