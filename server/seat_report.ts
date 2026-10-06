// The seat report (PRIVACY.md): one line per seat a person held in an
// online match, written when the seat ends, in seats.jsonl under the data
// directory. Visitors were leaving after a minute and nothing said whether
// they had moved, waited on a slow load, or fought a laggy connection (the
// maintainer, 2026-10-01): this says, and nothing more. No name, no account
// id, no address: whether the seat was a Guest's, what the seat did, how
// long the match took to load, the measured round trip to the server, the
// country Cloudflare names for the connection and whether the browser said
// it was a phone, the seat's first moments (a blow given and taken, a
// takedown, a fall, a cache), the frames a second the page drew and how
// finely it drew them. Pure, so a test reads every field without a socket.

import type { DrawnQualityWire } from '../src/net/protocol';
import type { RoyaleVariant } from '../src/net/royale_wire';
import { DT } from '../src/sim/types';
import type { SeatStats } from './match';

// 2: the seat's first moments and the page's frame rate (2026-10-03).
// 3: how finely the page drew, its quality step and pixels (2026-10-06).
export const SEAT_REPORT_VERSION = 3;

// How the seat ended: the pause menu's Leave or the end screen's way out
// ('menu'), the socket closing with no word (a closed tab, a lost network:
// 'closed'), the AFK sweep ('idle'), or the match ending with the seat
// still held ('ended').
export type SeatEnd = 'menu' | 'closed' | 'idle' | 'ended';
// 'royale': a battle royale seat (server/royale_service.ts), its variant
// beside it.
export type SeatQueue = 'public' | 'lobby' | 'forge' | 'royale';

export interface SeatReport {
  v: number;
  at: number;
  how: SeatEnd;
  queue: SeatQueue;
  // A battle royale's variant (ADR 0031); absent on every other seat.
  variant?: RoyaleVariant;
  guest: boolean;
  dropIn: boolean;
  mobile: boolean;
  country: string | null;
  // Seconds the seat was held, and the match clock when it ended.
  heldS: number;
  matchS: number;
  // Seconds from the seat's start to the client saying its match was on
  // screen; null when it never said so.
  loadS: number | null;
  // Seconds from the seat's start to its first command; null for none.
  firstOrderS: number | null;
  orders: number;
  // The orders by kind (server/match.ts SEAT_ORDER_KINDS).
  kinds: Record<string, number>;
  // The first steps the player did in this seat, in the order they did
  // them, and 'off' when they hid the guide (src/ui/first_steps.ts); a
  // browser that did a step in an earlier match does not tell it again.
  steps: string[];
  walkedM: number;
  points: number;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  // The measured round trip (the game's own probe, echoed by the page),
  // median and worst, in ms.
  pingMs: number | null;
  pingMaxMs: number | null;
  // The seat's first moments, in seconds from its start (server/match.ts
  // noteMoments): a blow given to a champion, one taken from a champion, a
  // takedown, the champion's first fall, the first cache it opened; null
  // for one that never came. What a visitor who left had met by then.
  firstHitS: number | null;
  firstHurtS: number | null;
  firstTakedownS: number | null;
  diedS: number | null;
  firstCacheS: number | null;
  // The frames a second the page drew, as the probe's echo said, median
  // and lowest; null when it never said.
  fps: number | null;
  fpsLow: number | null;
  // How finely the page drew, as the probe's echo said
  // (src/game/quality_ladder.ts): the step it last stood on (0 the
  // device's best) and the deepest it went, the lean level its context
  // was made with (src/game/quality_memory.ts), its pixels per CSS pixel,
  // the picture's size in pixels ('1920x1080') and whether the ground
  // showed shadows; null when it never said.
  step: number | null;
  stepDeep: number | null;
  lean: number | null;
  ratio: number | null;
  px: string | null;
  shadows: boolean | null;
}

// Cloudflare's country header, a two-letter code; its own codes for
// "unknown" (XX) and Tor (T1) say nothing about where anyone is.
export function countryOf(header: unknown): string | null {
  const v = Array.isArray(header) ? header[0] : header;
  if (typeof v !== 'string' || !/^[A-Z]{2}$/.test(v)) return null;
  return v === 'XX' || v === 'T1' ? null : v;
}

// What the browser says it is: a phone or a tablet, or not.
export function isMobileAgent(userAgent: unknown): boolean {
  return typeof userAgent === 'string' && /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent);
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const seconds = (ticks: number): number => Math.round(ticks * DT * 10) / 10;

export interface SeatReportInput {
  at: number;
  how: SeatEnd;
  queue: SeatQueue;
  variant?: RoyaleVariant;
  guest: boolean;
  dropIn: boolean;
  mobile: boolean;
  country: string | null;
  stats: Readonly<SeatStats>;
  tickCount: number;
  unit: { level: number; kills: number; deaths: number; assists: number; cs: number } | null;
  pings: readonly number[];
  fps: readonly number[];
  quality: readonly DrawnQualityWire[];
}

export function buildSeatReport(i: SeatReportInput): SeatReport {
  const s = i.stats;
  const ping = median(i.pings);
  const fps = median(i.fps);
  const since = (tick: number | null): number | null =>
    tick === null ? null : seconds(tick - s.startTick);
  const q = i.quality.at(-1) ?? null;
  return {
    v: SEAT_REPORT_VERSION,
    at: i.at,
    how: i.how,
    queue: i.queue,
    ...(i.variant !== undefined ? { variant: i.variant } : {}),
    guest: i.guest,
    dropIn: i.dropIn,
    mobile: i.mobile,
    country: i.country,
    heldS: seconds(i.tickCount - s.startTick),
    matchS: seconds(i.tickCount),
    loadS: s.loadedTick === null ? null : seconds(s.loadedTick - s.startTick),
    firstOrderS: s.firstOrderTick === null ? null : seconds(s.firstOrderTick - s.startTick),
    orders: s.orders,
    kinds: { ...s.kinds },
    steps: [...s.steps],
    walkedM: Math.round(s.walked),
    points: s.points,
    level: i.unit?.level ?? 0,
    kills: i.unit?.kills ?? 0,
    deaths: i.unit?.deaths ?? 0,
    assists: i.unit?.assists ?? 0,
    cs: i.unit?.cs ?? 0,
    pingMs: ping === null ? null : Math.round(ping),
    pingMaxMs: i.pings.length === 0 ? null : Math.round(Math.max(...i.pings)),
    firstHitS: since(s.firstHitTick),
    firstHurtS: since(s.firstHurtTick),
    firstTakedownS: since(s.firstTakedownTick),
    diedS: since(s.firstDeathTick),
    firstCacheS: since(s.firstCacheTick),
    fps: fps === null ? null : Math.round(fps),
    fpsLow: i.fps.length === 0 ? null : Math.round(Math.min(...i.fps)),
    step: q?.step ?? null,
    stepDeep: q === null ? null : Math.max(...i.quality.map((x) => x.step)),
    lean: q?.lean ?? null,
    ratio: q?.ratio ?? null,
    px: q === null ? null : `${q.w}x${q.h}`,
    shadows: q?.shadows ?? null,
  };
}

// A frame rate off the probe's echo: a number of frames a second a page
// can draw, or nothing.
export function fpsOnWire(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000 ? v : null;
}

const whole = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

// How finely a page drew, off the probe's echo: a step and a lean level
// a ladder can have, a ratio a canvas can draw at, a picture a screen can
// hold, or nothing. Only these fields are kept, whatever else came along.
export function qualityOnWire(v: unknown): DrawnQualityWire | null {
  if (typeof v !== 'object' || v === null) return null;
  const { step, lean, ratio, w, h, shadows } = v as Record<string, unknown>;
  if (!whole(step, 16) || !whole(lean, 4)) return null;
  if (typeof ratio !== 'number' || !(ratio >= 0.25 && ratio <= 4)) return null;
  if (!whole(w, 16384) || !whole(h, 16384) || w === 0 || h === 0) return null;
  if (typeof shadows !== 'boolean') return null;
  return { step, lean, ratio, w, h, shadows };
}
