// The match's stage (CONTEXT.md: Rotated view): the one box a match is
// built in, canvas, HUD, minimap, thumb stick and bars, so that turning it
// turns all of it (game/rotated_view.ts has the decision and the
// geometry). Standing straight it is the page; turned, it is the landscape
// box laid over a phone held upright, rotated a quarter about its center.
//
// Whatever in the match reads a screen point asks here for it in the
// stage's own pixels: a pointer or a touch (pointOnStage), an element's
// rect (rectOnStage), the size of "the screen" (stageSizeOf). Off a stage
// (the spectator's view, the dev pages) the three answer the page's own
// numbers, which is also what they answer on a stage standing straight:
// only a turned stage changes anything.
//
// Inside it the stylesheets size by --vw and --vh, a hundredth of the
// screen's width and height, and step in from the safe area by
// --safe-top/right/bottom/left. On a straight stage those are the page's
// own (vw, vh, the insets); on a turned one they are the stage's
// (container units), and the insets trade edges, an upright phone's top
// being the stage's left.

import {
  type Edge,
  frameFor,
  frameMoved,
  type LockAnswer,
  pageEdgeOf,
  rectToStage,
  type ScreenPoint,
  type ScreenRect,
  stagePlacement,
  stageSize,
  toStage,
  type ViewFrame,
} from './rotated_view';
import { getSettings } from './settings';
import { SETTINGS_EVENT } from './ui_scale';

const STAGE_CLASS = 'match-stage';

const EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];
const insets = (turned: boolean): string =>
  EDGES.map((e) => `--safe-${e}: env(safe-area-inset-${pageEdgeOf(turned, e)}, 0px);`).join(' ');

const CSS = `
.match-stage {
  position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden;
  --vw: 1vw; --vh: 1vh; ${insets(false)}
}
.match-stage.turned {
  container-type: size; transform-origin: 50% 50%;
  --vw: 1cqw; --vh: 1cqh; ${insets(true)}
}
`;

export interface MatchStage {
  readonly el: HTMLElement;
  // The page, and whether the stage is turned in it, as last laid out.
  frame(): ViewFrame;
  // The browser's answer to the landscape ask (game/orientation.ts): the
  // stage waits for it before it turns.
  setLandscapeLocked(locked: boolean): void;
  dispose(): void;
}

const stages = new WeakMap<Element, MatchStage>();

// Builds the stage inside the container (the page's root, which fills the
// page) and keeps it laid out: on every resize, when the setting changes
// (the pause menu has it), and when the browser answers the lock. A change
// that did not come with a resize announces one, so everything sized from
// the stage (the renderer, the interface scale) reads it again.
export function buildMatchStage(
  container: HTMLElement,
  opts: { coarsePointer: boolean; enabled?: () => boolean },
): MatchStage {
  const enabled = opts.enabled ?? ((): boolean => getSettings().rotatedView);
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.className = STAGE_CLASS;
  container.appendChild(el);

  let lock: LockAnswer = 'asking';
  let frame: ViewFrame = { width: 0, height: 0, turned: false };
  const layout = (): boolean => {
    const next = frameFor(container.clientWidth, container.clientHeight, {
      enabled: enabled(),
      coarsePointer: opts.coarsePointer,
      lock,
    });
    const moved = frameMoved(frame, next);
    frame = next;
    if (!moved) return false;
    el.classList.toggle('turned', frame.turned);
    if (frame.turned) {
      const at = stagePlacement(frame);
      el.style.left = `${at.left}px`;
      el.style.top = `${at.top}px`;
      el.style.width = `${at.width}px`;
      el.style.height = `${at.height}px`;
      el.style.transform = `rotate(${at.rotate}deg)`;
    } else {
      for (const prop of ['left', 'top', 'width', 'height', 'transform']) {
        el.style.removeProperty(prop);
      }
    }
    return true;
  };
  const relayout = (): void => {
    if (layout()) window.dispatchEvent(new Event('resize'));
  };
  const onResize = (): void => {
    layout();
  };
  layout();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', relayout);
  window.addEventListener(SETTINGS_EVENT, relayout);

  const stage: MatchStage = {
    el,
    frame: () => frame,
    setLandscapeLocked: (locked) => {
      lock = locked ? 'granted' : 'refused';
      relayout();
    },
    dispose: () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', relayout);
      window.removeEventListener(SETTINGS_EVENT, relayout);
      stages.delete(el);
      el.remove();
      style.remove();
    },
  };
  stages.set(el, stage);
  return stage;
}

// The stage an element stands on, or null off the match.
export function stageOf(el: Element | null): MatchStage | null {
  const host = el?.closest(`.${STAGE_CLASS}`) ?? null;
  return host ? (stages.get(host) ?? null) : null;
}

const STRAIGHT: ViewFrame = { width: 0, height: 0, turned: false };

// A client point (a pointer event's clientX and clientY) in the pixels of
// the stage the element stands on: every input entry point of the match
// goes through this.
export function pointOnStage(el: Element, x: number, y: number): ScreenPoint {
  return toStage(stageOf(el)?.frame() ?? STRAIGHT, x, y);
}

// A client rect (getBoundingClientRect) in the same pixels.
export function rectOnStage(
  el: Element,
  r: { left: number; top: number; right: number; bottom: number },
): ScreenRect {
  return rectToStage(stageOf(el)?.frame() ?? STRAIGHT, r);
}

// What "the screen" is to the element: the turned stage's own size, the
// page's otherwise.
export function stageSizeOf(el: Element): { width: number; height: number } {
  const frame = stageOf(el)?.frame();
  return frame?.turned
    ? stageSize(frame)
    : { width: window.innerWidth, height: window.innerHeight };
}
