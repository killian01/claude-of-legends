// The arrow beside the player's champion that points toward the seat's lane
// until the player arrives (ui/lane_guide.ts; ADR 0026): a gold arrowhead
// on the screen, placed each frame by the host from the renderer's
// projection (game/boot.ts). Under the HUD and the minimap, never in the
// way of a click. Presentation only.

import type { ArrowPlace } from './lane_guide';

const CSS = `
.lane-arrow {
  position: fixed; left: 0; top: 0; width: 28px; height: 28px; margin: -14px 0 0 -14px;
  pointer-events: none; z-index: 4; display: none;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.85));
}
.lane-arrow.on { display: block; }
.lane-arrow svg { width: 100%; height: 100%; animation: lane-arrow-lead 1.1s ease-in-out infinite; }
@keyframes lane-arrow-lead {
  0%, 100% { transform: translateX(-2px); opacity: 0.85; }
  50% { transform: translateX(3px); opacity: 1; }
}
@media (pointer: coarse) {
  .lane-arrow { width: 22px; height: 22px; margin: -11px 0 0 -11px; }
}
`;

// Pointing right; the host's angle turns it.
const SHAPE =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M3 3 L21 12 L3 21 L8 12 Z" fill="#ffd94a" stroke="#3a2e08" stroke-width="1.6" ' +
  'stroke-linejoin="round"/></svg>';

// Half the arrow's size on screen, for keeping it clear of the card.
export function laneArrowHalf(): number {
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse ? 11 : 14;
}

export class LaneArrow {
  private readonly el: HTMLElement;
  private readonly style: HTMLStyleElement;
  private shown = false;

  constructor(container: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.el = document.createElement('div');
    this.el.className = 'lane-arrow';
    this.el.innerHTML = SHAPE;
    container.appendChild(this.el);
  }

  // Where the arrow stands this frame, in client pixels; null hides it.
  place(at: ArrowPlace | null): void {
    if (!at) {
      if (this.shown) this.el.classList.remove('on');
      this.shown = false;
      return;
    }
    this.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) rotate(${at.angle.toFixed(3)}rad)`;
    if (!this.shown) this.el.classList.add('on');
    this.shown = true;
  }

  dispose(): void {
    this.el.remove();
    this.style.remove();
  }
}
