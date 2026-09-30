// What the left thumb sees (src/game/thumb_stick.ts): a translucent base
// where the finger landed and a knob that follows it, drawn over the
// canvas and never in its way (no pointer events). Built once per match by
// boot; touch.ts moves it. In a newcomer's first matches it also draws the
// Move ring (game/move_ring.ts), a ghost of the stick low on the left that
// says where the thumb goes, under the HUD so the shop and the wall cover
// it, and gone the first time the stick is used.

import { MOVE_RING } from '../game/move_ring';
import { STICK_RADIUS } from '../game/thumb_stick';

const CSS = `
.stick-base, .stick-knob {
  position: absolute; left: 0; top: 0; border-radius: 50%; pointer-events: none;
  z-index: 25; transform: translate(-50%, -50%); display: none;
}
.stick-base {
  width: ${STICK_RADIUS * 2 + 24}px; height: ${STICK_RADIUS * 2 + 24}px;
  border: 2px solid rgba(216, 230, 192, 0.35); background: rgba(10, 16, 8, 0.28);
}
.stick-knob {
  width: 52px; height: 52px;
  background: rgba(216, 230, 192, 0.55); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
.stick-base.on, .stick-knob.on { display: block; }
.stick-ghost {
  position: absolute; pointer-events: none; z-index: 5; border-radius: 50%;
  left: calc(${MOVE_RING.left}px + env(safe-area-inset-left, 0px));
  bottom: calc(${MOVE_RING.bottom}px + env(safe-area-inset-bottom, 0px));
  width: ${MOVE_RING.r * 2}px; height: ${MOVE_RING.r * 2}px; transform: translate(-50%, 50%);
  box-sizing: border-box; border: 2px dashed rgba(216, 230, 192, 0.6);
  background: radial-gradient(circle, rgba(216, 230, 192, 0.22) 0 24px, rgba(10, 16, 8, 0.3) 25px);
  display: flex; align-items: center; justify-content: center;
  font: 800 13px system-ui, sans-serif; letter-spacing: 1.5px; text-transform: uppercase;
  color: rgba(242, 246, 228, 0.9); text-shadow: 0 1px 3px #000;
  transition: opacity 0.6s ease-out;
  animation: stick-ghost-breathe 1.6s ease-in-out infinite alternate;
}
.stick-ghost.gone { opacity: 0; }
@keyframes stick-ghost-breathe {
  from { box-shadow: 0 0 0 0 rgba(216, 230, 192, 0); }
  to { box-shadow: 0 0 16px 2px rgba(216, 230, 192, 0.35); }
}
`;

export interface ThumbStickView {
  show(cx: number, cy: number): void;
  knob(x: number, y: number): void;
  hide(): void;
  dispose(): void;
}

export function buildThumbStickView(
  container: HTMLElement,
  opts: { moveRing?: boolean } = {},
): ThumbStickView {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const base = document.createElement('div');
  base.className = 'stick-base';
  const knob = document.createElement('div');
  knob.className = 'stick-knob';
  container.append(base, knob);
  let ghost: HTMLElement | null = null;
  if (opts.moveRing) {
    ghost = document.createElement('div');
    ghost.className = 'stick-ghost';
    ghost.textContent = 'Move';
    container.appendChild(ghost);
  }
  // The first touch of the stick: the ring has said what it had to.
  const dropGhost = (): void => {
    const g = ghost;
    if (!g) return;
    ghost = null;
    g.classList.add('gone');
    setTimeout(() => g.remove(), 700);
  };
  const place = (el: HTMLElement, x: number, y: number): void => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  return {
    show(cx, cy) {
      dropGhost();
      place(base, cx, cy);
      place(knob, cx, cy);
      base.classList.add('on');
      knob.classList.add('on');
    },
    knob(x, y) {
      place(knob, x, y);
    },
    hide() {
      base.classList.remove('on');
      knob.classList.remove('on');
    },
    dispose() {
      base.remove();
      knob.remove();
      ghost?.remove();
      style.remove();
    },
  };
}
