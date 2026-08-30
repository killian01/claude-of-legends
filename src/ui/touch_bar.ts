// The touch bar: the handful of orders that only live on keys with no
// finger equivalent (B recall, P shop, Esc menu, Space recenter) as
// buttons on the right screen edge, clear of the minimap in the corner.
// Boot builds it on coarse-pointer devices only.

export interface TouchBarActions {
  onRecall(): void;
  onToggleShop(): void;
  onToggleMenu(): void;
  onRecenterCamera(): void;
}

const CSS = `
.touchbar {
  /* Above the vertical middle: the minimap owns the bottom-right corner. */
  position: absolute; right: 8px; top: 40%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 8px; z-index: 30;
}
.touchbar-btn {
  min-width: 54px; min-height: 38px; padding: 0 8px;
  border-radius: 8px; border: 1px solid #466030;
  background: rgba(20, 30, 12, 0.72); color: #d8e6c0;
  font: 700 12px system-ui, sans-serif; letter-spacing: 0.04em;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.touchbar-btn:active { background: rgba(70, 96, 48, 0.9); }
`;

// Returns a teardown removing the bar and its stylesheet, like the HUD's.
export function buildTouchBar(container: HTMLElement, actions: TouchBarActions): () => void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'touchbar';
  const add = (label: string, onTap: () => void): void => {
    const btn = document.createElement('button');
    btn.className = 'touchbar-btn';
    btn.textContent = label;
    btn.addEventListener('click', onTap);
    root.appendChild(btn);
  };
  add('Menu', actions.onToggleMenu);
  add('Shop', actions.onToggleShop);
  add('Recall', actions.onRecall);
  add('Center', actions.onRecenterCamera);
  container.appendChild(root);
  return () => {
    root.remove();
    style.remove();
  };
}
