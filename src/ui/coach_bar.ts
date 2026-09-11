// The coach bar (docs/design/bots.md): the orders a bot's owner can give
// it live. Right-click on the map already means "go there" and on an enemy
// "focus it" for a coach seat (the mirror world translates); this bar
// carries the orders that have no place to click: Warden, ring, back, group,
// hold, free. One order is active at a time. The bar also answers: which
// order stands (from the snapshot, never assumed from the click) and
// whether the bot is on it or a higher play (survival, say) comes first.
//
// It sits on the right under the KDA box: the top center belongs to the
// team score, the target frame and the announcements.

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
  const bar = document.createElement('div');
  bar.className = 'coach-bar';
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
  hint.textContent = 'Right-click: go there. Right-click an enemy: focus it.';
  bar.appendChild(hint);
  container.appendChild(bar);
  return {
    update(order, play) {
      const d = describeCoachState(order, play);
      state.textContent = d.text;
      state.classList.toggle('on', d.on);
      for (const [kind, b] of buttons)
        b.classList.toggle('on', order !== null && kind === order.kind);
    },
    remove() {
      bar.remove();
    },
  };
}
