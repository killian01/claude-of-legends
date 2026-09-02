// The coach bar (docs/design/bots.md): the orders a bot's owner can give
// it live. Right-click on the map already means "go there" and on an enemy
// "focus it" for a coach seat (the mirror world translates); this bar
// carries the orders that have no place to click: Warden, back, group,
// hold, free. One order is active at a time; the bot's plate shows the
// play it is running.

import type { CoachOrderKind } from '../sim/coach';

const CSS = `
.coach-bar {
  position: absolute; left: 50%; top: 10px; transform: translateX(-50%); z-index: 12;
  display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-radius: 10px;
  background: rgba(6, 12, 16, 0.86); border: 1px solid #2c4d60; font-family: system-ui, sans-serif;
}
.coach-bar .coach-title { color: #8ed6f0; font-weight: 800; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; margin-right: 4px; }
.coach-bar button {
  padding: 5px 10px; border-radius: 6px; border: 1px solid #2c4d60; background: #0c161d;
  color: #d8e4ec; font-size: 12px; font-weight: 700; cursor: pointer;
}
.coach-bar button:hover { border-color: #8ed6f0; }
.coach-bar .coach-hint { color: #7f9cae; font-size: 10.5px; margin-left: 6px; }
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
  { kind: 'back', label: 'Back', title: 'Run home' },
  { kind: 'group', label: 'Group', title: 'Stick to the nearest ally' },
  { kind: 'hold', label: 'Hold', title: 'Hold where it stands' },
  { kind: 'free', label: 'Free', title: 'Release the order; the playbook decides again' },
];

export function buildCoachBar(
  container: HTMLElement,
  sendOrder: (kind: CoachOrderKind) => void,
): () => void {
  ensureCss();
  const bar = document.createElement('div');
  bar.className = 'coach-bar';
  const title = document.createElement('span');
  title.className = 'coach-title';
  title.textContent = 'Coach';
  bar.appendChild(title);
  for (const o of ORDERS) {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.title = o.title;
    b.addEventListener('click', () => sendOrder(o.kind));
    bar.appendChild(b);
  }
  const hint = document.createElement('span');
  hint.className = 'coach-hint';
  hint.textContent = 'Right-click: go there. Right-click an enemy: focus it.';
  bar.appendChild(hint);
  container.appendChild(bar);
  return () => bar.remove();
}
