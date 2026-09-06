// The collection and the shop, client side (ADR 0018). One fetch answers
// everything three surfaces need: the balance, what the account holds,
// what the week lends it, and the price of everything else. Kept in one
// module because a champion is locked or not for two different reasons
// and every screen has to say which.

import { format } from './balances';

export interface CollectionState {
  laurels: number;
  collection: string[];
  // The three champions everyone may play this week (CONTEXT.md).
  rotation: string[];
  // Champion id to price, holding exactly what is for sale.
  prices: Record<string, number>;
}

// Why a champion is playable, which is not the same as whether it is.
// A null state is the absence of a wall: the practice match and any
// surface that never asked the server.
export type Standing = 'owned' | 'rotation' | 'locked';

export function standingOf(state: CollectionState | null, championId: string): Standing {
  if (!state) return 'owned';
  if (state.collection.includes(championId)) return 'owned';
  if (state.rotation.includes(championId)) return 'rotation';
  return 'locked';
}

export function playable(state: CollectionState | null, championId: string): boolean {
  return standingOf(state, championId) !== 'locked';
}

export function priceOf(state: CollectionState | null, championId: string): number | null {
  return state?.prices[championId] ?? null;
}

export function affordable(state: CollectionState | null, championId: string): boolean {
  const price = priceOf(state, championId);
  return price !== null && state !== null && state.laurels >= price;
}

// What a champion's card says under its name. Never a bare lock: a
// refusal that does not name its number teaches nothing (ADR 0017).
export function standingLine(state: CollectionState | null, championId: string): string {
  switch (standingOf(state, championId)) {
    case 'owned':
      return 'Yours';
    case 'rotation':
      return 'Free this week';
    default: {
      // The price without its noun: the caller wears the mark
      // (ui/balances.ts), so the unit is drawn rather than spelled and
      // this line stays a number the way a price tag is.
      const price = priceOf(state, championId);
      return price === null ? 'Locked' : format(price);
    }
  }
}

// How far off an unaffordable champion is, in matches, at the rate a win
// pays. A goal reads better as a number of matches than as a shortfall.
export function matchesAway(
  state: CollectionState | null,
  championId: string,
  perMatch = 150,
): number {
  const price = priceOf(state, championId);
  if (price === null || state === null) return 0;
  const missing = price - state.laurels;
  return missing <= 0 ? 0 : Math.ceil(missing / perMatch);
}

async function post(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return res.json().catch(() => null);
}

function asState(raw: unknown): CollectionState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.collection) || typeof r.laurels !== 'number') return null;
  return {
    laurels: r.laurels,
    collection: r.collection.filter((v): v is string => typeof v === 'string'),
    rotation: Array.isArray(r.rotation)
      ? r.rotation.filter((v): v is string => typeof v === 'string')
      : [],
    prices: (r.prices as Record<string, number>) ?? {},
  };
}

// The account's collection, or null when there is no account behind this
// screen: the offline surfaces then show no wall at all, which is what
// the practice match is.
export async function loadCollection(): Promise<CollectionState | null> {
  try {
    return asState(await post('/api/collection'));
  } catch {
    return null;
  }
}

export type RecruitResult =
  | { ok: true; laurels: number; collection: string[] }
  | { ok: false; error: string };

export async function recruit(championId: string): Promise<RecruitResult> {
  try {
    const raw = (await post('/api/collection/recruit', { championId })) as Record<
      string,
      unknown
    > | null;
    if (raw && typeof raw.laurels === 'number' && Array.isArray(raw.collection)) {
      return {
        ok: true,
        laurels: raw.laurels,
        collection: raw.collection.filter((v): v is string => typeof v === 'string'),
      };
    }
    const error = raw && typeof raw.error === 'string' ? raw.error : 'That did not go through.';
    return { ok: false, error };
  } catch {
    return { ok: false, error: 'The server did not answer.' };
  }
}
