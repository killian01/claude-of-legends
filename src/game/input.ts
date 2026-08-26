// Local input, kept dumb: it reports ground points and key presses; the
// entry point decides what they mean. Keys: right-click move/attack, A
// attack-move, B recall, QWER abilities, DF sigils, P shop, Tab scoreboard,
// Enter chat, G ping, Space center camera, Escape menu.

import type { Renderer } from '../render/renderer';
import type { AbilityKey, Vec2 } from '../sim/types';

export interface InputHandlers {
  onRightClick(p: Vec2, screenX: number, screenY: number): void;
  // Left-click selects a unit (target frame) or clears the selection.
  onLeftClick(screenX: number, screenY: number): void;
  onHover(screenX: number, screenY: number): void;
  // Quickcast with indicator: keydown casts AT ONCE at the cursor (and
  // shows the range preview while held); keyup only hides the preview.
  onCast(key: AbilityKey, aim: Vec2): void;
  onAimEnd(key: AbilityKey): void;
  onLevelAbility(key: AbilityKey): void;
  onCastSigil(slot: number, aim: Vec2): void;
  onStop(): void;
  onAttackMove(aim: Vec2): void;
  onRecall(): void;
  onRecenterCamera(): void;
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
    handlers.onHover(e.clientX, e.clientY);
  });

  el.addEventListener('contextmenu', (e) => e.preventDefault());

  el.addEventListener('pointerdown', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (e.button === 0) {
      handlers.onLeftClick(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 2) return;
    const p = renderer.groundPointAt(e.clientX, e.clientY);
    if (p) handlers.onRightClick(p, e.clientX, e.clientY);
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
    if (e.key === ' ') {
      handlers.onRecenterCamera();
      return;
    }
    if (e.repeat) return;
    const aim = (): Vec2 | null => renderer.groundPointAt(mouseX, mouseY);
    const lower = e.key.toLowerCase();
    // Alt + ability key spends a skill point (Ctrl is browser-reserved).
    if (e.altKey) {
      const levelKey = ABILITY_KEYS[lower];
      if (levelKey) {
        e.preventDefault();
        handlers.onLevelAbility(levelKey);
        return;
      }
    }
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
    if (lower === 's') {
      handlers.onStop();
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

  window.addEventListener('keyup', (e) => {
    if (handlers.isTyping()) return;
    const key = ABILITY_KEYS[e.key.toLowerCase()];
    if (key) handlers.onAimEnd(key);
  });
}
