// The seat report (PRIVACY.md): one line per seat a person held in an
// online match, written when the seat ends, in seats.jsonl under the data
// directory. Visitors were leaving after a minute and nothing said whether
// they had moved, waited on a slow load, or fought a laggy connection (the
// maintainer, 2026-10-01): this says, and nothing more. No name, no account
// id, no address: whether the seat was a Guest's, what the seat did, how
// long the match took to load, the measured round trip to the server, the
// country Cloudflare names for the connection and whether the browser said
// it was a phone. Pure, so a test reads every field without a socket.

import type { RoyaleVariant } from '../src/net/royale_wire';
import { DT } from '../src/sim/types';
import type { SeatStats } from './match';

export const SEAT_REPORT_VERSION = 1;

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
}

export function buildSeatReport(i: SeatReportInput): SeatReport {
  const s = i.stats;
  const ping = median(i.pings);
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
  };
}
