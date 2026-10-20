// The line over the landing's gold button that says someone is playing
// right now (ADR 0025): a stranger is more likely to press Play when the
// press lands them next to a person, and now it does. Counts only, read
// from /api/public/presence every twenty seconds while the landing is on screen;
// nothing when nobody is on, so an empty evening says nothing rather than
// "0 players". Play now plays the battle royale, whose Respawn always has a
// match running to drop into (server/royale_service.ts): the line says a
// match is on and the time it has left, counting down, and counts people
// only, never the house bots. The Thornfray's count (ADR 0035,
// server/thornfray_service.ts) stands on its own way in rather than over
// the gold button, which never leads to it: a gathering open to join, or
// people in one under way. The words are pure so a test reads them without
// a browser.

import { BOUT_SEATS } from '../sim/content/bouts/match';

export const PRESENCE_ROUTE = '/api/public/presence';
export const PRESENCE_POLL_MS = 20_000;

// The mirror of the server's shape (server/drop_in.ts and server/
// royale_service.ts): the client never imports from server/.
export interface RoyalePresence {
  // People in a battle royale; the house bots are never counted.
  playing: number;
  // Whether Play now drops into a running match.
  joinable: boolean;
  // Seconds left in the match Play now drops into; null for none.
  endsInS: number | null;
}

// People in a Thornfray under way and in the gathering open to join; the
// house bots are never counted.
export interface ThornfrayPresence {
  playing: number;
  gathering: number;
}

export interface PresenceState {
  playing: number;
  queued: number;
  joinable: boolean;
  royale?: RoyalePresence;
  thornfray?: ThornfrayPresence;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function presenceLine(p: PresenceState): string | null {
  const r = p.royale;
  if (r?.joinable && r.playing > 0) {
    return r.playing === 1
      ? 'Someone is on the Wanderseed right now. Jump in.'
      : `${r.playing} people are on the Wanderseed right now. Jump in.`;
  }
  if (r?.joinable && r.endsInS !== null && r.endsInS > 0) {
    return `A battle royale is on right now, ${clock(r.endsInS)} left. Jump in.`;
  }
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

// The Thornfray's line on its own way in: the gathering first, since the
// way in joins it, then the people in one under way; nothing when nobody
// is in either. Short enough for one line in a phone's column, upright or
// sideways.
export function thornfrayLine(p: PresenceState): string | null {
  const t = p.thornfray;
  if (!t) return null;
  if (t.gathering > 0) return `Gathering now: ${t.gathering} of ${BOUT_SEATS}. Join in.`;
  if (t.playing > 0) {
    return t.playing === 1
      ? 'Someone is playing one now.'
      : `${t.playing} people are playing one now.`;
  }
  return null;
}

const count = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;

function asThornfray(raw: unknown): ThornfrayPresence | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const playing = count(r.playing);
  const gathering = count(r.gathering);
  if (playing === null || gathering === null) return undefined;
  return { playing, gathering };
}

function asRoyale(raw: unknown): RoyalePresence | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.playing !== 'number') return undefined;
  const endsInS =
    typeof r.endsInS === 'number' && Number.isFinite(r.endsInS) && r.endsInS >= 0
      ? r.endsInS
      : null;
  return { playing: r.playing, joinable: r.joinable === true, endsInS };
}

function asPresence(raw: unknown): PresenceState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.playing !== 'number' || typeof r.queued !== 'number') return null;
  const royale = asRoyale(r.royale);
  const thornfray = asThornfray(r.thornfray);
  return {
    playing: r.playing,
    queued: r.queued,
    joinable: r.joinable === true,
    ...(royale ? { royale } : {}),
    ...(thornfray ? { thornfray } : {}),
  };
}

// The presence as it stands `elapsedMs` after it was read: the match's
// clock run down by that much.
export function presenceAfter(p: PresenceState, elapsedMs: number): PresenceState {
  const r = p.royale;
  if (!r || r.endsInS === null) return p;
  return { ...p, royale: { ...r, endsInS: Math.max(0, r.endsInS - elapsedMs / 1000) } };
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

// One line into its element's span, hidden when there is nothing to say.
function say(into: HTMLElement, line: string | null): void {
  into.hidden = line === null;
  const words = into.querySelector('span');
  if (words && line !== null && words.textContent !== line) words.textContent = line;
}

// Fills `into` with the line and keeps it current, the match's clock
// counting down between reads, and `thornfrayInto`, when given, with the
// Thornfray's line from the same read; stops by itself once the element
// has left the page.
export function mountPresence(into: HTMLElement, thornfrayInto: HTMLElement | null = null): void {
  into.hidden = true;
  if (thornfrayInto) thornfrayInto.hidden = true;
  let read: { p: PresenceState; at: number } | null = null;
  const show = (): void => {
    say(into, read ? presenceLine(presenceAfter(read.p, Date.now() - read.at)) : null);
    if (thornfrayInto) say(thornfrayInto, read ? thornfrayLine(read.p) : null);
  };
  const refresh = (): void => {
    void fetchPresence().then((p) => {
      if (!into.isConnected) return;
      read = p ? { p, at: Date.now() } : null;
      show();
    });
  };
  refresh();
  let polled = Date.now();
  const timer = window.setInterval(() => {
    if (!into.isConnected) {
      window.clearInterval(timer);
      return;
    }
    if (document.hidden) return;
    if (Date.now() - polled >= PRESENCE_POLL_MS) {
      polled = Date.now();
      refresh();
    } else show();
  }, 1000);
}
