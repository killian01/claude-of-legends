// Local input. Right-click on an enemy: attack order; right-click on ground:
// move order. Q/W/E/R: cast aimed at the current mouse ground point.

import type { Renderer } from '../render/renderer';
import type { AbilityKey, Vec2 } from '../sim/types';

export interface InputHandlers {
  onMove(p: Vec2): void;
  onAttackUnit(unitId: number): void;
  onCast(key: AbilityKey, aim: Vec2): void;
  selfTeam: number;
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
    const unit = renderer.unitAt(e.clientX, e.clientY);
    if (unit && unit.team !== handlers.selfTeam) {
      handlers.onAttackUnit(unit.id);
      return;
    }
    const p = renderer.groundPointAt(e.clientX, e.clientY);
    if (p) handlers.onMove(p);
  });

  window.addEventListener('keydown', (e) => {
    const key = ABILITY_KEYS[e.key.toLowerCase()];
    if (!key) return;
    const aim = renderer.groundPointAt(mouseX, mouseY);
    if (aim) handlers.onCast(key, aim);
  });
}
