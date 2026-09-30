// The rotated view (CONTEXT.md: Rotated view). Safari on iOS grants a
// page neither fullscreen nor the landscape lock (game/orientation.ts),
// so every iPhone held upright met the wall asking for a turn, and one
// with its rotation lock on could not play at all; iPhones are more than
// half of the phones that come to play. Instead, when a touchscreen is
// upright and the browser refused the lock, the match's stage
// (game/match_stage.ts) is laid out as the landscape box the phone would
// have if the page turned, innerHeight wide and innerWidth tall, and
// rotated a quarter clockwise about its center so it covers the page
// exactly. Held sideways, the top of the phone to the left, the match
// reads upright whatever the rotation lock says. Turned to landscape for
// real, the page is landscape and the stage stands straight again.
//
// Every screen point the match is handed (a pointer, a touch, an
// element's rect) is a client point of the page; the match itself works
// in the stage's own pixels, the ones its canvas and HUD are laid out in.
// This is the one place that maps between the two, and the one place
// that decides when the stage turns. Pure, no DOM: tests/rotated_view.test.ts.

import { needsTurnPrompt } from './orientation';

// What the browser answered when the match asked for landscape: nothing
// yet, the lock (the phone turned itself, an Android in fullscreen), or
// a refusal (every iPhone, a desktop, a page that is not fullscreen).
export type LockAnswer = 'asking' | 'granted' | 'refused';

// The page the stage sits in, in CSS pixels, and whether it is turned.
export interface ViewFrame {
  width: number;
  height: number;
  turned: boolean;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// Upright, the way the stylesheet's (orientation: portrait) means it: a
// square counts.
export function isPortrait(width: number, height: number): boolean {
  return height >= width;
}

export interface TurnInputs {
  // The setting (game/settings.ts): on unless the player chose the wall.
  enabled: boolean;
  coarsePointer: boolean;
  portrait: boolean;
  lock: LockAnswer;
}

// The stage turns for a touchscreen held upright that the browser would
// not turn itself. While the browser is still answering it waits, so a
// phone about to be locked to landscape is never drawn turned for the
// moment before it rotates.
export function stageTurns(p: TurnInputs): boolean {
  return p.enabled && p.coarsePointer && p.portrait && p.lock === 'refused';
}

// Whether the match still leans on the wall asking for a turn: a
// touchscreen the browser has not turned (game/orientation.ts), unless the
// stage turns for it instead. The HUD's stylesheet adds the other half,
// the phone upright (ui/hud.ts, .turn-needed under a portrait media
// query). So the wall is only ever the fallback: the setting off, or the
// moment before the browser's answer.
export function wallFallback(coarsePointer: boolean, lock: LockAnswer, enabled: boolean): boolean {
  return needsTurnPrompt(coarsePointer, lock === 'granted') && !(enabled && lock === 'refused');
}

// Whether the wall stands right now: the fallback, and the phone upright.
// The stylesheet shows it on the same conditions; this is the same answer
// for what has to know without looking at the page (the practice clock,
// the hint's clock).
export function turnWallUp(
  coarsePointer: boolean,
  lock: LockAnswer,
  enabled: boolean,
  portrait: boolean,
): boolean {
  return portrait && wallFallback(coarsePointer, lock, enabled);
}

// The frame the stage takes on a page of this size.
export function frameFor(
  width: number,
  height: number,
  p: Omit<TurnInputs, 'portrait'>,
): ViewFrame {
  return { width, height, turned: stageTurns({ ...p, portrait: isPortrait(width, height) }) };
}

// Whether the stage has to be laid out again: it turned or stood up, or
// the page changed size under a turned stage. A straight stage is the
// page's own size in the stylesheet, so a resize alone asks nothing of it.
export function frameMoved(prev: ViewFrame, next: ViewFrame): boolean {
  if (prev.turned !== next.turned) return true;
  return next.turned && (prev.width !== next.width || prev.height !== next.height);
}

// The stage's own size: the page, or the page on its side.
export function stageSize(frame: ViewFrame): { width: number; height: number } {
  return frame.turned
    ? { width: frame.height, height: frame.width }
    : { width: frame.width, height: frame.height };
}

// A client point (a pointer event's clientX and clientY) on the stage.
// Standing straight the stage is the page, from its top left corner.
// Turned a quarter clockwise, the stage's top left corner is the page's
// top right, its top edge runs down the page's right edge, and its left
// edge along the page's top.
export function toStage(frame: ViewFrame, x: number, y: number): ScreenPoint {
  return frame.turned ? { x: y, y: frame.width - x } : { x, y };
}

// And back: a stage point where the page shows it.
export function toClient(frame: ViewFrame, x: number, y: number): ScreenPoint {
  return frame.turned ? { x: frame.width - y, y: x } : { x, y };
}

// A client rect (getBoundingClientRect) on the stage. A quarter turn
// keeps a rect a rect: its corners trade places.
export function rectToStage(
  frame: ViewFrame,
  r: { left: number; top: number; right: number; bottom: number },
): ScreenRect {
  if (!frame.turned) {
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.right - r.left,
      height: r.bottom - r.top,
    };
  }
  const left = r.top;
  const right = r.bottom;
  const top = frame.width - r.right;
  const bottom = frame.width - r.left;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export type Edge = 'top' | 'right' | 'bottom' | 'left';

// Which edge of the page a stage edge lies along, for the safe area's
// insets (a notch, the home bar): the same edge while the stage stands
// straight; turned, the stage's left is the page's top, where an upright
// phone keeps its notch, and the stage's right the page's bottom, where it
// keeps the home bar.
export function pageEdgeOf(turned: boolean, edge: Edge): Edge {
  if (!turned) return edge;
  const turn: Record<Edge, Edge> = { top: 'right', right: 'bottom', bottom: 'left', left: 'top' };
  return turn[edge];
}

// Where the stage is laid out in the page, in CSS pixels, before its
// rotation: centered on the page's center, so the quarter turn about its
// own center lands it exactly on the page.
export interface StagePlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: 0 | 90;
}

export function stagePlacement(frame: ViewFrame): StagePlacement {
  const { width, height } = stageSize(frame);
  if (!frame.turned) return { left: 0, top: 0, width, height, rotate: 0 };
  return {
    left: (frame.width - width) / 2,
    top: (frame.height - height) / 2,
    width,
    height,
    rotate: 90,
  };
}
