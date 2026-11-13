// The pause menu (the Escape menu): the title, then its boxes laid over the
// screen (ui/pause_layout.ts has the grid): the actions (Resume, Toggle
// fullscreen, Leave match), the settings panel, and the ladder box over the
// feedback box. While a Respawn champion is down, the title's row says when
// it comes back (pauseWaitLine), so the menu opened over a fall does not
// read as the match's end. The HUD makes the overlay, the ladder box, the feedback box
// and the settings panel, and keeps their behavior; this places them and
// gives the menu its look. A box shows what it holds: the ladder box stays
// hidden in a match that does not score, and the feedback box takes the
// stack's height then.

import { pauseLayoutCss } from './pause_layout';
import { backLine } from './royale_text';

export const PAUSE_TITLE = 'Paused view';
export const PAUSE_RESUME = 'Resume (Esc)';
export const PAUSE_FULLSCREEN = 'Toggle fullscreen';
export const PAUSE_LEAVE = 'Leave match';
export const PAUSE_SETTINGS = 'Settings';

// The title row's line over a fall: in Respawn, while the own champion is
// down and the match goes on, when it comes back and that it keeps its
// level and build (royale_text.ts backLine); null anywhere else, the line
// hidden.
export function pauseWaitLine(
  variant: 'respawn' | 'one_life' | null,
  dead: boolean,
  over: boolean,
  left: number,
): string | null {
  if (variant !== 'respawn' || !dead || over) return null;
  return backLine(left, true);
}

// Every rule under the menu's own class, at a weight above the HUD's
// rules for its modal overlays and the boxes' rules on the end screen
// (ui/hud.ts), whichever stylesheet the page added last.
const M = '.hud .hud-overlay.modal.hud-pause';
const C = '.hud.compact .hud-overlay.modal.hud-pause';

export const PAUSE_MENU_CSS = `
/* While the menu is up, the HUD's own blocks and what the match stage
   draws over the HUD (the battle royale's edge arrows, the minimap) stand
   down: between the boxes only the dimmed match shows, and nothing stands
   over them. Hidden rather than removed, so nothing moves under the menu.
   The turn wall keeps its dark ground under the menu, its words already
   let go (ui/hud.ts). At once, not at the end of a block's own fade (the
   first steps' card fades out over 0.4 s): fading, it still showed and
   its button still took the keyboard's Tab. */
.hud.paused > :not(.hud-pause):not(.hud-turn), .hud.paused ~ * {
  visibility: hidden; transition: none;
}
${M} {
  justify-content: flex-start; align-items: stretch; gap: 0; overflow-y: auto;
  background: radial-gradient(ellipse at 50% 45%, rgba(6, 10, 4, 0.58), rgba(2, 4, 1, 0.8));
  text-shadow: none; scrollbar-width: thin; scrollbar-color: #6e5a24 transparent;
}
${C} { justify-content: flex-start; overflow-y: auto; gap: 0; }
${M} .hud-pause-sheet { width: 100%; margin: auto; flex: none; min-height: 0; }
${M} .hud-pause-head { display: flex; align-items: center; gap: 16px; min-width: 0; }
/* The title in the menus' display face, like the battle royale's. */
${M} .hud-pause-title {
  font-family: Cinzel, Georgia, serif; font-size: 30px; font-weight: 700; letter-spacing: 2px;
  line-height: 1; color: #f2e6c0; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8); white-space: nowrap;
}
/* The wait's line beside the title: one line, cut short before it wraps. */
${M} .hud-pause-wait {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 15px; font-weight: 700; color: #f0d27a; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
}
${M} .hud-pause-head::after {
  content: ''; flex: 1; height: 1px;
  background: linear-gradient(90deg, rgba(201, 168, 74, 0.6), rgba(201, 168, 74, 0));
}
${M} .hud-pause-card {
  pointer-events: auto; min-width: 0; margin: 0; width: auto; border-style: solid;
  border-color: #3c5228; border-radius: 12px; color: #d8e6c0; text-align: left;
  background: linear-gradient(180deg, rgba(24, 35, 16, 0.97), rgba(13, 19, 9, 0.97));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
${M} .hud-pause-label {
  display: flex; align-items: flex-start; gap: 10px; font-size: 11px; font-weight: 800;
  letter-spacing: 1.6px; text-transform: uppercase; color: #c9a84a;
}
${M} .hud-pause-label::after {
  content: ''; flex: 1; height: 1px; margin-top: 7px; background: rgba(201, 168, 74, 0.22);
}
/* The actions: Resume first and lit, Leave match at the foot in a
   warning's color. */
${M} .hud-pause-actions { display: flex; flex-direction: column; }
${M} .hud-pause-btn {
  margin: 0; width: 100%; flex: none; padding: 0 14px; display: flex; align-items: center;
  justify-content: center; font-size: 14px; font-weight: 700; border-radius: 8px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
${M} .hud-pause-btn.resume {
  border-color: #8fb860; color: #f4f9e8;
  background: linear-gradient(180deg, #44692a, #2d4a1b);
}
${M} .hud-pause-btn.resume:hover { border-color: #c9e09a; }
${M} .hud-pause-btn.leave {
  margin-top: auto; border-color: #6e3a2c; color: #f0cbbf; background: #2a1611;
}
${M} .hud-pause-btn.leave:hover { border-color: #c0604a; }
${M} .hud-menu-btn:focus-visible { outline: 2px solid #c9a84a; outline-offset: 2px; }
/* The settings: their rows, scrolled inside the box when the screen is
   shorter than the list. */
${M} .hud-pause-settings {
  display: flex; flex-direction: column; min-height: 0; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: #6e5a24 transparent;
}
${M} .hud-pause-settings .set-panel { margin: 0; flex: none; }
${M} .hud-pause-settings .set-row { font-size: 13px; }
${M} .hud-pause-settings .set-row label { color: #c9d8ae; }
${M} .hud-pause-settings .set-row select { min-height: 26px; min-width: 0; }
${M} .hud-pause-settings .set-row input[type='range'] { min-width: 0; }
/* The ladder box over the feedback box; the feedback field takes the
   height the ladder leaves. */
${M} .hud-pause-stack { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
${M} .hud-ladder {
  flex: none; border-color: #6e5c26;
  background: linear-gradient(180deg, rgba(44, 37, 15, 0.97), rgba(26, 22, 10, 0.97));
}
${M} .hud-feedback { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
/* Send at the field's foot, a button's height, rather than stretched
   along a field that grows with the box. */
${M} .hud-feedback-row { flex: 1 1 auto; min-height: 0; align-items: flex-end; }
${M} .hud-feedback-row .hud-menu-btn { margin: 0; }
${M} .hud-feedback-row .hud-menu-btn { align-self: flex-end; min-height: 40px; }
${M} .hud-feedback-field { align-self: stretch; min-height: 72px; }
/* A phone: smaller words, the buttons still a finger wide. */
${C} .hud-pause-title { font-size: 20px; letter-spacing: 1.5px; }
${C} .hud-pause-head { gap: 10px; }
${C} .hud-pause-card { border-radius: 10px; }
${C} .hud-pause-label { font-size: 10px; letter-spacing: 1.3px; }
${C} .hud-pause-label::after { margin-top: 6px; }
${C} .hud-pause-btn { font-size: 13px; padding: 0 8px; border-radius: 7px; }
${C} .hud-pause-settings .set-row { font-size: 12px; gap: 8px; }
${C} .hud-pause-settings .set-row select { min-height: 28px; }
${C} .hud-feedback-field { min-height: 44px; }
${C} .hud-feedback-row .hud-menu-btn { min-height: 44px; padding: 0 16px; }
${pauseLayoutCss()}
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = PAUSE_MENU_CSS;
  document.head.appendChild(style);
}

export interface PauseMenuParts {
  settings: HTMLElement;
  ladder: HTMLElement;
  feedback: HTMLElement;
  // The wait's line (pauseWaitLine), kept by the HUD.
  wait: HTMLElement;
  onResume: () => void;
  onFullscreen: () => void;
  onLeave: () => void;
}

function div(cls: string, text?: string): HTMLElement {
  const e = document.createElement('div');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `hud-menu-btn hud-pause-btn ${cls}`;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

// Where the keyboard stands as the menu opens or closes (the HUD calls it
// on every toggle): on Resume when it opens, so Enter resumes and Tab
// walks the boxes from the top; out of the menu when it closes, so no key
// is left in a hidden field, whose keys never reach the match.
export function settlePauseFocus(overlay: HTMLElement, open: boolean): void {
  if (open) {
    overlay.querySelector<HTMLElement>('.hud-pause-btn.resume')?.focus({ preventScroll: true });
    return;
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && overlay.contains(active)) active.blur();
}

// Fills the HUD's pause overlay with the menu's sheet.
export function fillPauseMenu(overlay: HTMLElement, parts: PauseMenuParts): void {
  ensureCss();
  overlay.classList.add('hud-pause');
  const sheet = div('hud-pause-sheet');

  const head = div('hud-pause-head');
  parts.wait.classList.add('hud-pause-wait');
  head.append(div('hud-pause-title', PAUSE_TITLE), parts.wait);

  const actions = div('hud-pause-card hud-pause-actions');
  actions.append(
    button('resume', PAUSE_RESUME, parts.onResume),
    button('fullscreen', PAUSE_FULLSCREEN, parts.onFullscreen),
    button('leave', PAUSE_LEAVE, parts.onLeave),
  );

  const settings = div('hud-pause-card hud-pause-settings');
  settings.append(div('hud-pause-label', PAUSE_SETTINGS), parts.settings);

  const stack = div('hud-pause-stack');
  parts.ladder.classList.add('hud-pause-card');
  parts.feedback.classList.add('hud-pause-card');
  stack.append(parts.ladder, parts.feedback);

  sheet.append(head, actions, settings, stack);
  overlay.appendChild(sheet);
}
