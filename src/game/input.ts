// Local input, kept dumb: it reports ground points and key presses; the
// entry point decides what they mean. Keys: right-click move/attack, A
// attack-move, B recall, QWER abilities, DF sigils, P shop, Tab scoreboard,
// Enter chat, G ping, Escape menu.

import type { Renderer } from '../render/renderer';
import type { AbilityKey, Vec2 } from '../sim/types';

export interface InputHandlers {
  onRightClick(p: Vec2): void;
  onCast(key: AbilityKey, aim: Vec2): void;
  onCastSigil(slot: number, aim: Vec2): void;
  onAttackMove(aim: Vec2): void;
  onRecall(): void;
  onToggleShop(): void;
  onToggleScoreboard(): void;
  onToggleMenu(): void;
  onOpenChat(): void;
  onPing(aim: Vec2): void;
  isTyping(): boolean;
}

const ABILITY_KEYS: Readonly<Record<string, AbilityKey>> = {
  q: 'Q',
  w: 'W',
  e: 'E',
  r: 'R',
};

const SIGIL_KEYS: Readonly<Record<string, number>> = { d: 0, f: 1 };

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
    if (handlers.isTyping()) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.repeat) handlers.onToggleScoreboard();
      return;
    }
    if (e.key === 'Escape') {
      handlers.onToggleMenu();
      return;
    }
    if (e.key === 'Enter') {
      handlers.onOpenChat();
      return;
    }
    if (e.repeat) return;
    const aim = (): Vec2 | null => renderer.groundPointAt(mouseX, mouseY);
    const lower = e.key.toLowerCase();
    if (lower === 'p') {
      handlers.onToggleShop();
      return;
    }
    if (lower === 'b') {
      handlers.onRecall();
      return;
    }
    if (lower === 'a') {
      const p = aim();
      if (p) handlers.onAttackMove(p);
      return;
    }
    if (lower === 'g') {
      const p = aim();
      if (p) handlers.onPing(p);
      return;
    }
    const sigilSlot = SIGIL_KEYS[lower];
    if (sigilSlot !== undefined) {
      const p = aim();
      if (p) handlers.onCastSigil(sigilSlot, p);
      return;
    }
    const key = ABILITY_KEYS[lower];
    if (!key) return;
    const p = aim();
    if (p) handlers.onCast(key, p);
  });
}
