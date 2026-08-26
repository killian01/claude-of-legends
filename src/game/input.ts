// Local input: right-click issues a move order at the clicked ground point.
// Attack-move and abilities join in phase 3.

import type { Renderer } from '../render/renderer';
import type { Vec2 } from '../sim/types';

export function setupInput(renderer: Renderer, onMoveOrder: (p: Vec2) => void): void {
  const el = renderer.domElement;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 2) return;
    const p = renderer.groundPointAt(e.clientX, e.clientY);
    if (p) onMoveOrder(p);
  });
}
