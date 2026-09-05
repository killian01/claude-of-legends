// The calibration log ADR 0017 asks for, and nothing more. Every act that
// costs the server money writes one append-only sample here saying what
// it really cost, in the provider's own units: Tripo credits for a task,
// tokens for a model turn. Nothing in the game reads it. It exists so the
// ember weights are set from measurement instead of from the intuition
// the four old meters were set by, and so the size of a weekly grant is
// read off a normal week rather than guessed.
//
// Cost comes from the provider, never from a balance difference: Tripo
// reports consumed_credit on the settled task and the Messages API
// reports usage on the response, so a sample is exact even when two jobs
// overlap.

import type { QuotaAction } from './quotas';

export type SpendProvider = 'tripo' | 'anthropic';

// The finer act inside a metered action, so a sample says which of the
// several things a meter covers actually spent.
export type SpendDetail =
  | 'model'
  | 'weapon'
  | 'rig'
  | 'retarget'
  | 'image'
  | 'kit'
  | 'coach'
  | 'night';

export interface SpendSample {
  action: QuotaAction;
  detail: SpendDetail;
  provider: SpendProvider;
  accountId: number;
  at: number;
  // Provider credits for a generation task; absent for a model turn.
  credits?: number;
  // Token counts for a model turn; absent for a generation task.
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// What one Messages API response reported, in the shape the API sends it.
// Both streaming halves (message_start carries the input side, the final
// message_delta the output side) fold into one of these.
export interface ModelUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export function usageSample(
  action: QuotaAction,
  detail: SpendDetail,
  accountId: number,
  at: number,
  usage: ModelUsage,
): SpendSample {
  return {
    action,
    detail,
    provider: 'anthropic',
    accountId,
    at,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

// The rates a sample is priced with, in US dollars. Calibration input,
// not a runtime dependency: only the report reads them, and the game
// never does. Anthropic list prices for claude-sonnet-5, per million
// tokens, read 2026-09-05; a cache read is a tenth of an input token and
// a cache write is a quarter more than one.
export const MODEL_RATES = {
  input: 2 / 1_000_000,
  output: 10 / 1_000_000,
  cacheRead: 0.2 / 1_000_000,
  cacheWrite: 2.5 / 1_000_000,
} as const;

// What a model turn cost, in dollars.
export function modelCostUsd(s: SpendSample): number {
  return (
    (s.inputTokens ?? 0) * MODEL_RATES.input +
    (s.outputTokens ?? 0) * MODEL_RATES.output +
    (s.cacheReadTokens ?? 0) * MODEL_RATES.cacheRead +
    (s.cacheWriteTokens ?? 0) * MODEL_RATES.cacheWrite
  );
}

// What a provider task cost, in dollars, given what a credit was bought
// for. The price of a Tripo credit is not in this file on purpose: it is
// what the maintainer paid, it is not on any public endpoint, and
// inventing it would put a guess back at the bottom of the whole table.
export function taskCostUsd(s: SpendSample, creditUsd: number): number {
  return (s.credits ?? 0) * creditUsd;
}

// One line of the report: an act, how often it happened, and what it cost
// on average. `usd` is null when the sample cannot be priced yet, which
// today means a Tripo sample with no credit price given.
export interface SpendLine {
  action: QuotaAction;
  detail: SpendDetail;
  provider: SpendProvider;
  count: number;
  units: number;
  usd: number | null;
}

export function summarize(samples: readonly SpendSample[], creditUsd: number | null): SpendLine[] {
  const byKey = new Map<string, SpendLine>();
  for (const s of samples) {
    const key = `${s.action}/${s.detail}/${s.provider}`;
    const line = byKey.get(key) ?? {
      action: s.action,
      detail: s.detail,
      provider: s.provider,
      count: 0,
      units: 0,
      usd: 0 as number | null,
    };
    line.count += 1;
    if (s.provider === 'tripo') {
      line.units += s.credits ?? 0;
      line.usd = creditUsd === null ? null : (line.usd ?? 0) + taskCostUsd(s, creditUsd);
    } else {
      line.units +=
        (s.inputTokens ?? 0) +
        (s.outputTokens ?? 0) +
        (s.cacheReadTokens ?? 0) +
        (s.cacheWriteTokens ?? 0);
      line.usd = (line.usd ?? 0) + modelCostUsd(s);
    }
    byKey.set(key, line);
  }
  // Dearest first: the report is read to find out what to price highest.
  return [...byKey.values()].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
}
