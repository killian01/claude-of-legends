// What the left thumb sees (src/game/thumb_stick.ts): a translucent base
// where the finger landed and a knob that follows it, drawn over the
// canvas and never in its way (no pointer events). Built once per match by
// boot; touch.ts moves it.

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
`;

export interface ThumbStickView {
  show(cx: number, cy: number): void;
  knob(x: number, y: number): void;
  hide(): void;
  dispose(): void;
}

export function buildThumbStickView(container: HTMLElement): ThumbStickView {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const base = document.createElement('div');
  base.className = 'stick-base';
  const knob = document.createElement('div');
  knob.className = 'stick-knob';
  container.append(base, knob);
  const place = (el: HTMLElement, x: number, y: number): void => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  return {
    show(cx, cy) {
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
      style.remove();
    },
  };
}
