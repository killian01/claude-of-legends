// The calibration log (ADR 0017): every act that costs money writes what
// it really cost, in the provider's own units, so the ember weights are
// read off measurement instead of intuition. Nothing in the game reads
// these rows; the report does.

import { describe, expect, it } from 'vitest';
import { ForgeStore } from '../server/forge_store';
import { modelCostUsd, type SpendSample, summarize, usageSample } from '../server/spend';

describe('the spend log', () => {
  it('round-trips a provider task and a model turn, keeping them apart', () => {
    const store = new ForgeStore(':memory:');
    try {
      store.addSpendSample({
        accountId: 1,
        action: 'generation',
        detail: 'model',
        provider: 'tripo',
        credits: 30,
        at: 100,
      });
      store.addSpendSample(
        usageSample('agent', 'kit', 1, 200, {
          input_tokens: 14,
          output_tokens: 900,
          cache_read_input_tokens: 4423,
          cache_creation_input_tokens: 0,
        }),
      );
      const rows = store.listSpendSamples();
      expect(rows).toHaveLength(2);
      // A task carries credits and no tokens; a turn the other way round.
      expect(rows[0]).toMatchObject({ provider: 'tripo', credits: 30, detail: 'model' });
      expect(rows[0]!.inputTokens).toBeUndefined();
      expect(rows[1]).toMatchObject({ provider: 'anthropic', inputTokens: 14, outputTokens: 900 });
      expect(rows[1]!.credits).toBeUndefined();
      // The window is honoured, so a report can ask for a week.
      expect(store.listSpendSamples(150)).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('prices a model turn from its four token kinds', () => {
    const s = usageSample('agent', 'coach', 1, 0, {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    });
    // 2 + 10 + 0.2 + 2.5 per million, the sonnet-5 list read 2026-09-05.
    expect(modelCostUsd(s)).toBeCloseTo(14.7, 6);
    // A cache read is a tenth of an input token: the whole point of the
    // caching pass, and it has to show up in the calibration too.
    const cached = usageSample('agent', 'kit', 1, 0, { cache_read_input_tokens: 1_000_000 });
    const uncached = usageSample('agent', 'kit', 1, 0, { input_tokens: 1_000_000 });
    expect(modelCostUsd(uncached) / modelCostUsd(cached)).toBeCloseTo(10, 6);
  });

  it('summarizes by act, dearest first, and says when a row cannot be priced', () => {
    const at = 0;
    const task = (credits: number): SpendSample => ({
      accountId: 1,
      action: 'generation',
      detail: 'model',
      provider: 'tripo',
      credits,
      at,
    });
    const samples = [
      task(30),
      task(30),
      usageSample('agent', 'kit', 1, at, { input_tokens: 100, output_tokens: 100 }),
    ];
    // With a credit price, the 3D build towers over a model turn and
    // sorts first.
    const priced = summarize(samples, 0.02);
    expect(priced[0]).toMatchObject({ detail: 'model', count: 2, units: 60 });
    expect(priced[0]!.usd).toBeCloseTo(1.2, 6);
    expect(priced[1]!.detail).toBe('kit');
    // Without one, the credits are still exact and the dollars are null
    // rather than zero: an unpriced act must never read as a free one.
    const unpriced = summarize(samples, null);
    const model = unpriced.find((l) => l.detail === 'model');
    expect(model).toMatchObject({ units: 60, usd: null });
  });
});
