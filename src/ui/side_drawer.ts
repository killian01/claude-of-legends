// A sheet that slides in from the right over a page and holds a panel not
// worth a page of its own: the account's own things, the live matches.
// The scrim, Escape and the close button all take it down; the page that
// opened it closes it too when it leaves, so no listener outlives it.

import { el } from './menu';

const CSS = `
@keyframes dr-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dr-in { from { transform: translateX(28px); opacity: 0; } to { transform: none; opacity: 1; } }
/* Above the section host (ui/section_host.ts, z-index 30): the account's
   drawer opens over whatever section is open, not behind it. */
.dr-scrim { position: fixed; inset: 0; z-index: 50; background: rgba(4, 7, 16, 0.55);
  backdrop-filter: blur(2px); animation: dr-fade 0.2s ease-out; }
.dr {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 51; width: min(460px, 94vw);
  background: rgba(8, 12, 22, 0.97); border-left: 1px solid #2b3f60;
  box-shadow: -24px 0 60px rgba(0, 0, 0, 0.55); display: flex; flex-direction: column;
  font-family: system-ui, sans-serif; color: #c9d9ee; animation: dr-in 0.25s ease-out;
}
.dr, .dr * { box-sizing: border-box; }
.dr-head { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 18px 22px 12px; border-bottom: 1px solid #1f2f4a; }
/* No case change on the title: an account's name is its identity as typed. */
.dr-title { font-family: Cinzel, Georgia, serif; font-size: 16px; letter-spacing: 1.2px;
  color: #e6d7a8; margin: 0; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.dr-close { background: none; border: 1px solid #2b3f60; border-radius: 6px; color: #8ba1c0;
  font: inherit; font-size: 12px; font-weight: 700; padding: 4px 10px; cursor: pointer; flex: none; }
.dr-close:hover { border-color: #5b84c9; color: #dceaff; }
.dr-body { flex: 1; overflow-y: auto; padding: 4px 22px 22px; }
.dr-section { font-family: Cinzel, Georgia, serif; font-size: 12px; letter-spacing: 1.6px;
  text-transform: uppercase; color: #9fb4d2; margin: 20px 0 6px; }
.dr-section:first-child { margin-top: 14px; }
.dr-foot { display: flex; gap: 20px; padding: 14px 22px; border-top: 1px solid #1f2f4a; }
.dr-foot a, .dr-foot button {
  background: none; border: 0; padding: 0; font: inherit; font-size: 12px; font-weight: 700;
  letter-spacing: 1.2px; text-transform: uppercase; cursor: pointer; color: #8ba1c0;
  text-decoration: none;
}
.dr-foot a:hover, .dr-foot button:hover { color: #dceaff; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface Drawer {
  body: HTMLElement;
  foot: HTMLElement;
  close(): void;
}

// A heading inside the body, one per thing the drawer holds.
export function drawerSection(title: string): HTMLElement {
  return el('div', 'dr-section', title);
}

export function openDrawer(host: HTMLElement, title: string): Drawer {
  ensureCss();
  const scrim = el('div', 'dr-scrim');
  const sheet = el('aside', 'dr');
  const head = el('div', 'dr-head');
  const closeBtn = el('button', 'dr-close', 'Close');
  closeBtn.type = 'button';
  head.append(el('h2', 'dr-title', title), closeBtn);
  const body = el('div', 'dr-body');
  const foot = el('div', 'dr-foot');
  sheet.append(head, body, foot);
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    window.removeEventListener('keydown', onKey);
    scrim.remove();
    sheet.remove();
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  window.addEventListener('keydown', onKey);
  scrim.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  host.append(scrim, sheet);
  return { body, foot, close };
}
