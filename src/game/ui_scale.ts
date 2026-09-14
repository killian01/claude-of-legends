// How big the interface is drawn (the settings panel's "Interface size").
// The HUD and the menus are laid out in pixels for a 1080p screen; on a
// 1440p or a 4K monitor at the system's 100% they come out a third to a
// half smaller than designed, and the first player on such a screen wrote
// that everything was tiny. The automatic scale follows the viewport's
// height in CSS pixels, which already carries the system's own scaling,
// so a 4K screen at 200% is a 1080p screen here and gets 1. A manual
// choice overrides it. Applied with the CSS zoom property, which scales
// layout and text together and keeps every pixel size in the stylesheets
// true at 1. The pure part is pinned by tests/ui_scale.test.ts.

export type UiScaleSetting = 'auto' | number;

export const DESIGN_HEIGHT = 1080;
export const MIN_UI_SCALE = 1;
export const MAX_UI_SCALE = 2;
// The steps the automatic scale moves in, and what the settings offer.
export const UI_SCALE_STEP = 0.05;
export const UI_SCALE_CHOICES: readonly number[] = [1, 1.25, 1.5, 1.75, 2];

// Never below 1: a laptop's 768 rows keep the designed sizes, which fit.
export function autoUiScale(viewportHeight: number): number {
  if (!(viewportHeight > 0)) return MIN_UI_SCALE;
  const raw = viewportHeight / DESIGN_HEIGHT;
  const stepped = Math.round(raw / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Number(stepped.toFixed(2))));
}

// Any junk in, a valid setting out: 'auto', or a number in range on a step.
export function clampUiScale(value: unknown): UiScaleSetting {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'auto';
  const stepped = Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Number(stepped.toFixed(2))));
}

export function effectiveUiScale(setting: UiScaleSetting, viewportHeight: number): number {
  return setting === 'auto' ? autoUiScale(viewportHeight) : (clampUiScale(setting) as number);
}

// The one place the scale touches the DOM. zoom rather than transform:
// it changes layout, so absolutely placed blocks keep their anchors and
// pointer geometry stays honest.
export function applyUiScale(el: HTMLElement, scale: number): void {
  if (scale === 1) el.style.removeProperty('zoom');
  else el.style.setProperty('zoom', String(scale));
}

// Fired on window by src/game/settings.ts whenever a setting changes, so a
// HUD on screen follows the slider without being told by hand.
export const SETTINGS_EVENT = 'loc:settings';

// Keeps an element at the interface size while it is on screen: now, on
// every resize, and whenever the setting changes. The setting comes
// through a getter rather than an import, since settings.ts reads this
// module. Returns the stop, for the element's own teardown.
export function followUiScale(el: HTMLElement, setting: () => UiScaleSetting): () => void {
  const apply = (): void => {
    applyUiScale(el, effectiveUiScale(setting(), window.innerHeight));
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener(SETTINGS_EVENT, apply);
  return (): void => {
    window.removeEventListener('resize', apply);
    window.removeEventListener(SETTINGS_EVENT, apply);
  };
}
