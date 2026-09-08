// One section of the home open at a time, under the home's bar.
//
// The sections (the Ladder, the Academy, the Forge, the Gallery, the
// champions) are full pages that used to cover the bar, so the only way
// from one to the next was Back and then a second click. They now open
// into a host that starts under the bar, which stays live above them: one
// click switches sections.
//
// Nothing about the pages themselves changes. Each opener appends its own
// root and hands back its close, which is all this needs to swap one for
// another. A page that closes itself (its own Back, or Escape) leaves the
// host empty, and the observer reports that as the section being gone.
//
// The open section is a layer of the navigation (src/game/nav.ts, ADR
// 0020) with the section's key for an address: the browser's Back closes
// it back to the tiles, a reload on #ladder reopens the ladder, and
// switching sections swaps the one entry rather than piling up two.

import { appNav, type Frame } from '../game/nav';

// What a bar entry does: mount the section into `host` and hand back the
// close, exactly the shape every ui/*.ts open function has.
export type OpenSection = (host: HTMLElement) => () => void;

export interface SectionHost {
  // Opens `key`, closing whatever was open. Opening the section already
  // open closes it instead, so a bar entry toggles back to the tiles.
  open(key: string, open: OpenSection): void;
  close(): void;
  current(): string | null;
  // Takes the host and its listeners down with the page that owns it.
  destroy(): void;
}

const CSS = `
.home-section { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function createSectionHost(
  // The home page, whose bar sets where the host starts and which wears
  // the class that gets everything but the bar out of the way.
  page: HTMLElement,
  bar: HTMLElement,
  onChange: (key: string | null) => void,
): SectionHost {
  ensureCss();
  const host = document.createElement('div');
  host.className = 'home-section';
  let key: string | null = null;
  let closeCurrent: (() => void) | null = null;
  let frame: Frame | null = null;

  // The host starts at the bar's foot, measured rather than assumed: the
  // bar is one row on a desktop and two on a phone.
  const place = (): void => {
    host.style.top = `${Math.round(bar.getBoundingClientRect().bottom)}px`;
  };
  window.addEventListener('resize', place);

  const settle = (next: string | null): void => {
    key = next;
    page.classList.toggle('with-section', next !== null);
    if (next === null) host.remove();
    onChange(next);
  };

  // The page down and the host emptied, the nav left alone: this is what
  // the nav calls when Back closes the section, and what a swap runs on
  // the section it swaps out.
  const tearDown = (): void => {
    const stop = closeCurrent;
    closeCurrent = null;
    frame = null;
    // Emptying the host is the page's own job; this only asks for it.
    if (stop) stop();
    host.textContent = '';
    settle(null);
  };

  // A page that closed itself leaves the host empty; that is the signal,
  // and it needs no cooperation from the five pages. The nav is told, so
  // the history steps back with it.
  const watch = new MutationObserver(() => {
    if (key !== null && host.childElementCount === 0) {
      const gone = frame;
      closeCurrent = null;
      frame = null;
      settle(null);
      gone?.closed();
    }
  });
  watch.observe(host, { childList: true });

  const close = (): void => {
    if (key === null) return;
    const gone = frame;
    tearDown();
    gone?.closed();
  };

  return {
    open(next: string, open: OpenSection): void {
      if (next === key) {
        close();
        return;
      }
      // One entry for the section that is open, whichever it is: a swap
      // replaces the layer (and tears the old page down through it)
      // rather than closing one and pushing the next.
      const nav = appNav();
      const was = frame;
      frame = was ? nav.replace(was, next, tearDown, next) : nav.push(next, tearDown, next);
      (page.parentElement ?? document.body).appendChild(host);
      place();
      closeCurrent = open(host);
      settle(next);
    },
    close,
    current: () => key,
    destroy(): void {
      close();
      watch.disconnect();
      window.removeEventListener('resize', place);
      host.remove();
    },
  };
}
