// Local input, kept dumb: it reports ground points and key presses; the
// entry point decides what they mean (move, attack, cast, shop).

import type { Renderer } from '../render/renderer';
import type { AbilityKey, Vec2 } from '../sim/types';

export interface InputHandlers {
  onRightClick(p: Vec2): void;
  onCast(key: AbilityKey, aim: Vec2): void;
  onToggleShop(): void;
}

const ABILITY_KEYS: Readonly<Record<string, AbilityKey>> = {
  q: 'Q',
  w: 'W',
  e: 'E',
  r: 'R',
};

export function setupInput(renderer: Renderer, handlers: InputHandlers): void {
  const el = renderer.domElement;
  let mouseX = 0;
  let mouseY = 0;

  el.addEventListener('pointermove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 2) return;
    mouseX = e.clientX;
    mouseY = e.clientY;
    const p = renderer.groundPointAt(e.clientX, e.clientY);
    if (p) handlers.onRightClick(p);
  });

  window.addEventListener('keydown', (e) => {
    const lower = e.key.toLowerCase();
    if (lower === 'p' || lower === 'b') {
      handlers.onToggleShop();
      return;
    }
    const key = ABILITY_KEYS[lower];
    if (!key) return;
    const aim = renderer.groundPointAt(mouseX, mouseY);
    if (aim) handlers.onCast(key, aim);
  });
}
