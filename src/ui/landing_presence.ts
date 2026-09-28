// The line over the landing's gold button that says someone is playing
// right now (ADR 0025): a stranger is more likely to press Play when the
// press lands them next to a person, and now it does. Counts only, read
// from /api/public/presence every twenty seconds while the landing is on screen;
// nothing when nobody is on, so an empty evening says nothing rather than
// "0 players". The words are pure so a test reads them without a browser.

export const PRESENCE_ROUTE = '/api/public/presence';
export const PRESENCE_POLL_MS = 20_000;

// The mirror of the server's shape (server/drop_in.ts): the client never
// imports from server/.
export interface PresenceState {
  playing: number;
  queued: number;
  joinable: boolean;
}

export function presenceLine(p: PresenceState): string | null {
  if (p.joinable && p.playing > 0) {
    return p.playing === 1
      ? 'Someone is in a match right now. Jump in against them.'
      : `${p.playing} people are in a match right now. Jump in.`;
  }
  if (p.queued > 0) {
    return p.queued === 1
      ? 'Someone is waiting for a match right now.'
      : `${p.queued} people are waiting for a match right now.`;
  }
  return null;
}

function asPresence(raw: unknown): PresenceState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.playing !== 'number' || typeof r.queued !== 'number') return null;
  return { playing: r.playing, queued: r.queued, joinable: r.joinable === true };
}

export async function fetchPresence(
  get: typeof fetch = (input, init) => fetch(input, init),
): Promise<PresenceState | null> {
  try {
    const res = await get(PRESENCE_ROUTE, { credentials: 'same-origin' });
    return res.ok ? asPresence(await res.json()) : null;
  } catch {
    return null;
  }
}

// Fills `into` with the line and keeps it current; stops by itself once
// the element has left the page.
export function mountPresence(into: HTMLElement): void {
  into.hidden = true;
  const refresh = (): void => {
    void fetchPresence().then((p) => {
      if (!into.isConnected) return;
      const line = p ? presenceLine(p) : null;
      into.hidden = line === null;
      const words = into.querySelector('span');
      if (words && line !== null) words.textContent = line;
    });
  };
  refresh();
  const timer = window.setInterval(() => {
    if (!into.isConnected) {
      window.clearInterval(timer);
      return;
    }
    if (!document.hidden) refresh();
  }, PRESENCE_POLL_MS);
}
