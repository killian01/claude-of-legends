// The touch bar: the handful of orders that only live on keys with no
// finger equivalent (B recall, P shop, Esc menu, Space recenter) as
// buttons on the right screen edge, clear of the minimap in the corner.
// Boot builds it on coarse-pointer devices only. Its buttons are a
// finger's size (MIN_TAP_PX; they were 38 px tall), and it keeps clear of
// a phone's notch and rounded corners (the safe area: index.html asks for
// the whole screen with viewport-fit=cover, so the page has to step in
// from the edges itself). The insets are the match stage's
// (game/match_stage.ts), which trade edges when the stage is turned.

import { MIN_TAP_PX } from '../game/ui_scale';

// The recall and the shop are absent in a battle royale (ADR 0031), and
// so are their buttons. Drink shows only while a Sapdraught is carried.
export interface TouchBarActions {
  onRecall?(): void;
  onToggleShop?(): void;
  onDrink?(): void;
  onToggleMenu(): void;
  onRecenterCamera(): void;
}

export const TOUCH_BAR_CSS = `
.touchbar {
  /* Above the vertical middle: the minimap owns the bottom-right corner. */
  position: absolute; right: calc(8px + var(--safe-right, env(safe-area-inset-right, 0px)));
  top: 40%;
  transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 8px; z-index: 30;
}
.touchbar-btn {
  min-width: 56px; min-height: ${MIN_TAP_PX}px; padding: 0 8px;
  border-radius: 8px; border: 1px solid #466030;
  background: rgba(20, 30, 12, 0.72); color: #d8e6c0;
  font: 700 12px system-ui, sans-serif; letter-spacing: 0.04em;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.touchbar-btn:active { background: rgba(70, 96, 48, 0.9); }
/* With the thumb controls the right edge belongs to the casting thumb. */
.touchbar.left {
  right: auto; left: calc(8px + var(--safe-left, env(safe-area-inset-left, 0px))); top: 38%;
}
/* On the right, Drink sits beside the bottom button so the column keeps its
   height between the score box and the minimap; on the left the column has
   the room, and beside it is the stick's. */
.touchbar-btn.drink { position: absolute; bottom: 0; right: calc(100% + 8px); }
.touchbar.left .touchbar-btn.drink { position: static; }
`;

export interface TouchBar {
  // Shows the Drink button or hides it; the match calls it every tick.
  showDrink(on: boolean): void;
  // Removes the bar and its stylesheet, like the HUD's teardown.
  dispose(): void;
}

export function buildTouchBar(
  container: HTMLElement,
  actions: TouchBarActions,
  opts: { side?: 'left' | 'right' } = {},
): TouchBar {
  const style = document.createElement('style');
  style.textContent = TOUCH_BAR_CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = opts.side === 'left' ? 'touchbar left' : 'touchbar';
  const add = (label: string, onTap: () => void): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.className = 'touchbar-btn';
    btn.textContent = label;
    btn.addEventListener('click', onTap);
    root.appendChild(btn);
    return btn;
  };
  add('Menu', actions.onToggleMenu);
  if (actions.onToggleShop) add('Shop', actions.onToggleShop);
  if (actions.onRecall) add('Recall', actions.onRecall);
  add('Center', actions.onRecenterCamera);
  const drink = actions.onDrink ? add('Drink', actions.onDrink) : null;
  if (drink) {
    drink.classList.add('drink');
    drink.style.display = 'none';
  }
  let drinkShown = false;
  container.appendChild(root);
  return {
    showDrink(on) {
      if (!drink || on === drinkShown) return;
      drinkShown = on;
      drink.style.display = on ? '' : 'none';
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
