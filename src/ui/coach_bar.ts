// The coach bar (docs/design/bots.md): the orders a bot's owner can give
// it live. The click that orders (a right-click, a left one unless the
// settings say otherwise, a tap) already means "go there" on the map and
// "focus it" on an enemy for a coach seat (the mirror world translates); this bar
// carries the orders that have no place to click: Warden, ring, back, group,
// hold, free. One order is active at a time. The bar also answers: which
// order stands (from the snapshot, never assumed from the click) and
// whether the bot is on it or a higher play (survival, say) comes first.
//
// It sits on the right under the KDA box: the top center belongs to the
// team score, the target frame and the announcements. On a touchscreen the
// right side is the minimap's and the casting thumb's (or the touch bar's),
// so there the bar stands at the top left, its buttons a finger's size in
// a grid of three, above the stick (coachLayout below).

import { getSettings } from '../game/settings';
import type { TouchScheme } from '../game/touch';
import { MIN_TAP_PX } from '../game/ui_scale';
import type { CoachOrder, CoachOrderKind } from '../sim/coach';
import { COACH_PLAY_ID } from '../sim/content/playbooks/new_bot';

const CSS = `
.coach-bar {
  position: absolute; right: 12px; top: 84px; width: 156px; z-index: 12;
  display: flex; flex-direction: column; gap: 5px; padding: 8px 8px 7px; border-radius: 10px;
  background: rgba(6, 12, 16, 0.86); border: 1px solid #2c4d60; font-family: system-ui, sans-serif;
}
.coach-bar .coach-title { color: #8ed6f0; font-weight: 800; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; }
.coach-bar button {
  padding: 5px 10px; border-radius: 6px; border: 1px solid #2c4d60; background: #0c161d;
  color: #d8e4ec; font-size: 12px; font-weight: 700; cursor: pointer; text-align: left;
}
.coach-bar button:hover { border-color: #8ed6f0; }
.coach-bar button.on { background: #163646; border-color: #8ed6f0; color: #eaf7ff; }
.coach-bar .coach-state { color: #cfe6f2; font-size: 11px; line-height: 1.35; min-height: 28px; }
.coach-bar .coach-state.on { color: #9fe8b0; }
.coach-bar .coach-hint { color: #7f9cae; font-size: 10px; line-height: 1.3; }
/* A touchscreen: top left, beside the touch bar's column when the thumbs
   play (its buttons are 56 px and more, 8 px in), at the edge otherwise. */
.coach-bar.touch {
  right: auto; top: calc(46px + var(--safe-top, env(safe-area-inset-top, 0px)));
  left: calc(8px + var(--safe-left, env(safe-area-inset-left, 0px)));
  box-sizing: border-box; width: 168px; padding: 6px; gap: 4px;
  display: grid; grid-template-columns: repeat(3, 1fr);
}
.coach-bar.touch.thumbs { left: calc(84px + var(--safe-left, env(safe-area-inset-left, 0px))); }
.coach-bar.touch .coach-title { display: none; }
.coach-bar.touch button {
  min-height: ${MIN_TAP_PX}px; padding: 0 2px; text-align: center; font-size: 11.5px;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.coach-bar.touch .coach-state, .coach-bar.touch .coach-hint { grid-column: 1 / -1; }
.coach-bar.touch .coach-state { min-height: 0; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const ORDERS: readonly { kind: CoachOrderKind; label: string; title: string }[] = [
  { kind: 'warden', label: 'Warden', title: 'Go take the Warden, now' },
  { kind: 'creature', label: 'Ring', title: "Go take the ring's creature, now" },
  { kind: 'back', label: 'Back', title: 'Run home' },
  { kind: 'group', label: 'Group', title: 'Stick to the nearest ally' },
  { kind: 'hold', label: 'Hold', title: 'Hold where it stands' },
  { kind: 'free', label: 'Free', title: 'Release the order; the playbook decides again' },
];

const ORDER_NAMES: Record<CoachOrder['kind'], string> = {
  goto: 'Go there',
  warden: 'Warden',
  creature: 'Ring',
  focus: 'Focus',
  back: 'Back',
  group: 'Group',
  hold: 'Hold',
};

// What the state line says: the standing order and whether the bot is on
// it. The play id comes from the snapshot; the obeying play is the one the
// new bot ships with, so a renamed one reads as "comes first" here while
// the plate still tells the truth.
export function describeCoachState(
  order: CoachOrder | null,
  play: string | null,
): { text: string; on: boolean } {
  if (!order) {
    return {
      text: play ? `No order. Playbook: ${play}.` : 'No order. The playbook decides.',
      on: false,
    };
  }
  const name = ORDER_NAMES[order.kind];
  if (play === COACH_PLAY_ID) return { text: `${name}: on it.`, on: true };
  return { text: `${name}: waiting, ${play ?? 'something else'} comes first.`, on: false };
}

// Where the bar stands: beside the mouse's HUD, or on a touchscreen out of
// the thumbs' way ('thumbs' leaves the left edge to the touch bar's column).
export type CoachLayout = 'mouse' | 'thumbs' | 'tap';

export function coachLayout(coarsePointer: boolean, scheme: TouchScheme): CoachLayout {
  return coarsePointer ? scheme : 'mouse';
}

// The line under the state: how the map gives the two orders with a place,
// said the way this player gives them (a tap, or the click the settings
// make the order's: game/boot.ts clickOrder).
export function coachHint(layout: CoachLayout, leftClickMoves: boolean): string {
  if (layout !== 'mouse') return 'Tap the map: go there. Tap an enemy: focus it.';
  const click = leftClickMoves ? 'Click' : 'Right-click';
  return `${click} the map: go there. ${click} an enemy: focus it.`;
}

export interface CoachBar {
  // Called on every snapshot with the coached bot's order and active play.
  update(order: CoachOrder | null, play: string | null): void;
  remove(): void;
}

export function buildCoachBar(
  container: HTMLElement,
  sendOrder: (kind: CoachOrderKind) => void,
): CoachBar {
  ensureCss();
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const layout = coachLayout(coarse, getSettings().touchScheme);
  const bar = document.createElement('div');
  bar.className = layout === 'mouse' ? 'coach-bar' : `coach-bar touch ${layout}`;
  const title = document.createElement('span');
  title.className = 'coach-title';
  title.textContent = 'Coach';
  bar.appendChild(title);
  const buttons = new Map<CoachOrderKind, HTMLButtonElement>();
  for (const o of ORDERS) {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.title = o.title;
    b.addEventListener('click', () => {
      sendOrder(o.kind);
      // Optimistic until the next snapshot answers.
      for (const [kind, other] of buttons)
        other.classList.toggle('on', kind === o.kind && kind !== 'free');
    });
    buttons.set(o.kind, b);
    bar.appendChild(b);
  }
  const state = document.createElement('div');
  state.className = 'coach-state';
  state.textContent = 'No order. The playbook decides.';
  bar.appendChild(state);
  const hint = document.createElement('div');
  hint.className = 'coach-hint';
  const showHint = (): void => {
    const text = coachHint(layout, getSettings().leftClickMoves);
    if (hint.textContent !== text) hint.textContent = text;
  };
  showHint();
  bar.appendChild(hint);
  container.appendChild(bar);
  return {
    update(order, play) {
      const d = describeCoachState(order, play);
      state.textContent = d.text;
      state.classList.toggle('on', d.on);
      // The settings can turn the left click's orders off mid-match.
      showHint();
      for (const [kind, b] of buttons)
        b.classList.toggle('on', order !== null && kind === order.kind);
    },
    remove() {
      bar.remove();
    },
  };
}
