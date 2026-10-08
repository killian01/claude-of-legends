// The goal's bar on Respawn's end card (ui/royale_goal.ts decides it): the
// level line, the bar from the last level to the next with the part this
// match filled lighter, and what the match earned and what is left. The
// bar fills from where the match found it once the card is in.

import type { GoalModel } from './royale_goal';

// When the fill starts after the card shows (its own entry is 0.45 s), and
// how long it takes.
export const GOAL_FILL_DELAY_MS = 450;
export const GOAL_FILL_MS = 1100;

const CSS = `
.br-goal { margin: 10px auto 0; width: min(420px, 100%); text-align: left; }
.br-goal-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  font-size: 12px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #c9a84a; }
.br-goal-head b { color: #f2e6c0; letter-spacing: 1.2px; }
.br-goal.reached .br-goal-head b { color: #ffe08a; text-shadow: 0 0 14px rgba(240, 206, 120, 0.6); }
.br-goal-track { position: relative; height: 10px; margin-top: 4px; border-radius: 999px;
  overflow: hidden; background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 0 0 1px rgba(201, 168, 74, 0.45); }
.br-goal-track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; }
.br-goal-now { background: linear-gradient(90deg, #f0d27a, #fff1b8);
  box-shadow: 0 0 10px rgba(255, 220, 120, 0.7);
  transition: width ${GOAL_FILL_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1) ${GOAL_FILL_DELAY_MS}ms; }
.br-goal-was { background: linear-gradient(90deg, #8a6a24, #c9a84a); }
.br-goal-line { margin: 4px 0 0; font-size: 12.5px; color: #c9bd93;
  font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .br-goal-now { transition: none; } }
.hud.compact .br-goal { margin-top: 6px; }
.hud.compact .br-goal-head { font-size: 10.5px; }
.hud.compact .br-goal-track { height: 8px; margin-top: 3px; }
.hud.compact .br-goal-line { font-size: 11px; margin-top: 2px; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const pct = (share: number): string => `${(Math.max(0, Math.min(1, share)) * 100).toFixed(1)}%`;

export function goalBar(model: GoalModel): HTMLElement {
  ensureCss();
  const root = el('div', `br-goal${model.reached !== null ? ' reached' : ''}`);
  const head = el('div', 'br-goal-head');
  head.append(el('b', '', model.title), el('span', '', `Level ${model.next}`));
  const track = el('div', 'br-goal-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(Math.round(model.now * 100)));
  track.setAttribute('aria-label', `Level ${model.next}`);
  const now = el('i', 'br-goal-now');
  const was = el('i', 'br-goal-was');
  now.style.width = pct(model.was);
  was.style.width = pct(model.was);
  track.append(now, was);
  root.append(head, track, el('p', 'br-goal-line', model.line));
  // From where the match found it to where it leaves it, once laid out.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      now.style.width = pct(model.now);
    });
  });
  return root;
}
