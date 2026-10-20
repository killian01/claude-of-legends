// A Thornfray's gathering on screen (CONTEXT.md: Thornfray; ADR 0035;
// docs/design/thornfray.md, Entering): the planet's first wait, one card in
// the joining card's dress ("Thornfray · 2 of 8 people · starts in 14 s"),
// its opener's Start now, and Cancel. It stays over the match it starts
// until the match's first frame is drawn (game/first_frame.ts), as the
// battle royale's joining card does. The words are ui/bout_text.ts's; the
// server's thornfray_gather tells the numbers, each second and on a change.

import type { ThornfrayGather } from '../net/royale_wire';
import { GATHER_FILL, gatherLine, THORNFRAY_TITLE } from './bout_text';
import { el, screen } from './menu';
import { planetEmblem } from './planet_emblem';

const CSS = `
.menu-card.tf-gather { width: min(440px, 92vw); text-align: center; }
.tf-gather .planet-emblem { --planet: 64px; margin: 2px auto 12px;
  animation: tf-gather-turn 6s linear infinite; }
@keyframes tf-gather-turn { to { transform: rotate(360deg); } }
.tf-gather .menu-progress i { width: 40%; animation: tf-gather-sweep 1.4s ease-in-out infinite alternate; }
@keyframes tf-gather-sweep { from { margin-left: 0; } to { margin-left: 60%; } }
.tf-gather .tf-gather-line { font-weight: 700; color: #f0dca0; font-variant-numeric: tabular-nums; }
.tf-gather-btns { display: flex; gap: 8px; }
.tf-gather-btns .menu-btn { flex: 1 1 0; min-height: 44px; margin-top: 10px; }
.tf-gather-btns [hidden] { display: none; }
.menu.tf-gather-over { z-index: 45; }
@media (prefers-reduced-motion: reduce) {
  .tf-gather .planet-emblem, .tf-gather .menu-progress i { animation: none; }
}
`;

let cssInstalled = false;

export interface GatherController {
  // What the server told of the gathering.
  update(g: ThornfrayGather): void;
  // The match is built under the card: it rises over the match until it
  // is removed.
  overMatch(): void;
  remove(): void;
}

export function showThornfrayGathering(
  container: HTMLElement,
  opts: { onCancel: () => void; onStart: () => void },
): GatherController {
  if (!cssInstalled) {
    cssInstalled = true;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const { root, card } = screen(container);
  card.classList.add('tf-gather');
  const line = el('p', 'menu-sub tf-gather-line', 'Opening a gathering');
  const bar = el('div', 'menu-progress');
  bar.appendChild(el('i', ''));
  const start = el('button', 'menu-btn primary', 'Start now') as HTMLButtonElement;
  start.type = 'button';
  start.hidden = true;
  start.addEventListener('click', () => {
    start.disabled = true;
    opts.onStart();
  });
  const cancel = el('button', 'menu-btn', 'Cancel') as HTMLButtonElement;
  cancel.type = 'button';
  cancel.addEventListener('click', opts.onCancel);
  const btns = el('div', 'tf-gather-btns');
  btns.append(start, cancel);
  card.append(
    planetEmblem('thornfray'),
    el('h1', 'menu-title', THORNFRAY_TITLE),
    line,
    el('p', 'menu-sub', GATHER_FILL),
    bar,
    btns,
  );
  return {
    update: (g) => {
      const text = gatherLine(g.people, g.of, g.startsIn);
      if (line.textContent !== text) line.textContent = text;
      start.hidden = !g.opener;
    },
    overMatch: () => root.classList.add('tf-gather-over'),
    remove: () => root.remove(),
  };
}
