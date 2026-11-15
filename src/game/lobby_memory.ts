// What a tab remembers of a private lobby (ADR 0036), in its session
// storage: nothing outlives the tab, and nothing but a code is kept.
//
// - The lobby this tab is in: a reload, or the reload a deploy asks for,
//   comes back to it rather than to the front page, since boot takes the
//   code off the address (ADR 0020). Kept while a lobby session is open,
//   dropped when the person leaves it.
// - A code waiting on a sign-in through Discord: the round trip leaves the
//   page, so the invitation is put down before and picked up after, once,
//   if it is fresh.
//
// The store is the narrow seam (StatsStore's shape), so the rules are
// testable without a browser and a page with storage denied fails quietly.

import { normalizeJoinCode } from './invite';

export interface CodeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LOBBY_KEY = 'col.lobby';
export const PENDING_JOIN_KEY = 'col.pendingJoin';
// A Discord round trip takes seconds; an invitation older than this was
// abandoned, not delayed.
export const PENDING_JOIN_MS = 15 * 60_000;

export function rememberLobby(store: CodeStore | null, code: string): void {
  const shaped = normalizeJoinCode(code);
  if (shaped === null) return;
  try {
    store?.setItem(LOBBY_KEY, shaped);
  } catch {
    // A tab that cannot remember goes home on a reload, as before.
  }
}

export function readLobby(store: CodeStore | null): string | null {
  try {
    const raw = store?.getItem(LOBBY_KEY) ?? null;
    return raw === null ? null : normalizeJoinCode(raw);
  } catch {
    return null;
  }
}

export function forgetLobby(store: CodeStore | null): void {
  try {
    store?.removeItem(LOBBY_KEY);
  } catch {
    // Nothing to forget.
  }
}

export function rememberPendingJoin(store: CodeStore | null, code: string, now: number): void {
  const shaped = normalizeJoinCode(code);
  if (shaped === null) return;
  try {
    store?.setItem(PENDING_JOIN_KEY, JSON.stringify({ code: shaped, at: now }));
  } catch {
    // The invitation is lost with the round trip, as before.
  }
}

// The waiting code, removed whatever it holds: read once, used once. Null
// when there is none, when it is not a code (an older build, a hand edit),
// or when it is stale.
export function takePendingJoin(store: CodeStore | null, now: number): string | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(PENDING_JOIN_KEY) ?? null;
    store?.removeItem(PENDING_JOIN_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { code, at } = parsed as { code?: unknown; at?: unknown };
  if (typeof code !== 'string' || typeof at !== 'number') return null;
  if (now - at > PENDING_JOIN_MS || at > now) return null;
  return normalizeJoinCode(code);
}

// The tab's own session storage, or null where reading it throws (a
// sandboxed frame, storage denied).
export function tabStore(): CodeStore | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
