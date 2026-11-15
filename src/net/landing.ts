// The landing's one request (ADR 0033): a POST that hands the visitor its
// Guest, setting the year's cookie again, and answers the ladder of every
// human, the own panel and the week's rotation. The landing asks it once
// when it opens and hands the answer to the ladder and the own panel, so
// the two never read different moments.
//
// The wire shapes are mirrored here from server/landing_page.ts and
// server/points_ladder.ts; the client never imports from server/. A reply
// is read field by field: a malformed ladder is no page at all, while a
// malformed own panel or week is that part left out, so the ladder still
// stands.
//
// An invite link's code (ADR 0036) rides in the request's JSON body, never
// in its address: the answer then says whether that private lobby can be
// joined, and nothing else about it.

export const LANDING_ROUTE = '/api/public/landing';

export interface LandingLadderRow {
  rank: number;
  name: string;
  points: number;
  guest: boolean;
}

export interface LandingLadderMe {
  rank: number | null;
  points: number;
  name: string;
  guest: boolean;
  named: boolean;
}

export interface LandingLadder {
  total: number;
  rows: LandingLadderRow[];
  me: LandingLadderMe | null;
}

// The level the line's points stand at, on the one curve the end card
// climbs (src/ui/royale_goal.ts goalStep): the level, its first point and
// the next level's.
export interface LandingLevel {
  level: number;
  from: number;
  to: number;
}

// The line one place above the reader's, and the points it takes to pass it.
export interface LandingAbove {
  rank: number;
  name: string;
  points: number;
  gap: number;
}

// Who the reader is in the game: a Guest or an account, its name, its place
// and points, its level, its Respawn best, the line above it, and since
// when it exists.
export interface LandingOwn {
  name: string;
  named: boolean;
  account: boolean;
  rank: number | null;
  points: number;
  level: LandingLevel;
  best: number;
  above: LandingAbove | null;
  since: number;
}

// The week's rotation (ADR 0018): the three champions every player may pick
// this week, the starters everyone holds, and when the week turns.
export interface LandingWeek {
  rotation: string[];
  starters: string[];
  turnsAt: number;
}

// What the landing's answer says of an invite code: an open lobby, its
// opener's name, how many hold a seat of its ten and whether it is playing
// right now; or closed (unknown, expired or closed alike); or limited, the
// connection over its wrong codes, the lobby not looked up at all. A lobby
// is full when `players >= seats`. member: the reader is one of the
// lobby's own, coming back to it; their place is kept, full or not.
export type LandingInvite =
  | {
      open: true;
      host: string;
      players: number;
      seats: number;
      phase?: LobbyPhase;
      member?: true;
    }
  | { open: false; limited?: true };

export type LobbyPhase = 'queue' | 'select' | 'match';

export interface LandingPage {
  ladder: LandingLadder;
  own: LandingOwn | null;
  week: LandingWeek | null;
  // Only when the request carried a code: null when the answer's is not
  // well formed, which the landing reads as no answer.
  invite?: LandingInvite | null;
}

type Raw = Record<string, unknown>;

function record(v: unknown): Raw | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : null;
}

// A finite whole number from zero.
function whole(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function strings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function asRow(v: unknown): LandingLadderRow | null {
  const r = record(v);
  if (!r) return null;
  if (!whole(r.rank) || typeof r.name !== 'string' || !whole(r.points)) return null;
  return { rank: r.rank, name: r.name, points: r.points, guest: r.guest === true };
}

function asMe(v: unknown): LandingLadderMe | null | undefined {
  if (v === null) return null;
  const r = record(v);
  if (!r) return undefined;
  if (!(r.rank === null || whole(r.rank))) return undefined;
  if (!whole(r.points) || typeof r.name !== 'string') return undefined;
  return {
    rank: r.rank,
    points: r.points,
    name: r.name,
    guest: r.guest === true,
    named: r.named === true,
  };
}

function asLadder(v: unknown): LandingLadder | null {
  const r = record(v);
  if (!r || !whole(r.total) || !Array.isArray(r.rows)) return null;
  const rows: LandingLadderRow[] = [];
  for (const raw of r.rows) {
    const row = asRow(raw);
    if (!row) return null;
    rows.push(row);
  }
  const me = asMe(r.me);
  if (me === undefined) return null;
  return { total: r.total, rows, me };
}

function asLevel(v: unknown): LandingLevel | null {
  const r = record(v);
  if (!r || !whole(r.level) || !whole(r.from) || !whole(r.to)) return null;
  if (!(r.to > r.from)) return null;
  return { level: r.level, from: r.from, to: r.to };
}

function asAbove(v: unknown): LandingAbove | null | undefined {
  if (v === null) return null;
  const r = record(v);
  if (!r) return undefined;
  if (!whole(r.rank) || typeof r.name !== 'string' || !whole(r.points) || !whole(r.gap)) {
    return undefined;
  }
  return { rank: r.rank, name: r.name, points: r.points, gap: r.gap };
}

export function asLandingOwn(v: unknown): LandingOwn | null {
  const r = record(v);
  if (!r) return null;
  if (typeof r.name !== 'string' || r.name.length === 0) return null;
  if (typeof r.named !== 'boolean' || typeof r.account !== 'boolean') return null;
  if (!(r.rank === null || whole(r.rank))) return null;
  if (!whole(r.points) || !whole(r.best) || !whole(r.since)) return null;
  const level = asLevel(r.level);
  const above = asAbove(r.above);
  if (!level || above === undefined) return null;
  return {
    name: r.name,
    named: r.named,
    account: r.account,
    rank: r.rank,
    points: r.points,
    level,
    best: r.best,
    above,
    since: r.since,
  };
}

export function asLandingWeek(v: unknown): LandingWeek | null {
  const r = record(v);
  if (!r || !strings(r.rotation) || !strings(r.starters) || !whole(r.turnsAt)) return null;
  return { rotation: [...r.rotation], starters: [...r.starters], turnsAt: r.turnsAt };
}

const PHASES: readonly LobbyPhase[] = ['queue', 'select', 'match'];

export function asLandingInvite(v: unknown): LandingInvite | null {
  const r = record(v);
  if (!r) return null;
  if (r.open === false)
    return r.limited === true ? { open: false, limited: true } : { open: false };
  if (r.open !== true) return null;
  if (typeof r.host !== 'string' || r.host.length === 0) return null;
  if (!whole(r.players) || !whole(r.seats) || r.seats === 0) return null;
  const open: LandingInvite = { open: true, host: r.host, players: r.players, seats: r.seats };
  if (r.member === true) open.member = true;
  if (r.phase === undefined) return open;
  const phase = PHASES.find((p) => p === r.phase);
  return phase ? { ...open, phase } : null;
}

// The answer read, or null when the ladder in it is not one: the landing
// then leaves the ladder and the own panel out and stands as it did. The
// invitation is read only when the answer has one.
export function asLandingPage(raw: unknown): LandingPage | null {
  const r = record(raw);
  if (!r) return null;
  const ladder = asLadder(r.ladder);
  if (!ladder) return null;
  const page: LandingPage = { ladder, own: asLandingOwn(r.own), week: asLandingWeek(r.week) };
  if ('invite' in r) page.invite = asLandingInvite(r.invite);
  return page;
}

// Asks once, with the Guest cookie riding the request and the answer
// (httpOnly, so this module never sees it). Null on a refusal, a throw or
// junk. `join`: an invite link's code, sent in the body; with none the
// request has no body at all.
export async function loadLanding(
  post: typeof fetch = (input, init) => fetch(input, init),
  join: string | null = null,
): Promise<LandingPage | null> {
  const init: RequestInit = { method: 'POST', credentials: 'same-origin' };
  if (join !== null) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify({ join });
  }
  try {
    const res = await post(LANDING_ROUTE, init);
    if (!res.ok) return null;
    return asLandingPage(await res.json());
  } catch {
    return null;
  }
}

// The longest Play waits for the landing's answer before it asks for its
// Guest (POST /api/guest), so the two read the cookie the answer set.
export const LANDING_WAIT_MS = 2000;

// Settles when the landing's request has answered, or after `ms`, whichever
// comes first; never rejects.
export function untilLanded(page: Promise<unknown>, ms = LANDING_WAIT_MS): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    page.then(done, done);
  });
}
