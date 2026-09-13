// The three seconds between a new build being noticed and the page
// reloading (src/net/build_watch.ts). A reload with no word first reads as
// a crash; a word and no reload leaves people on the old version, which
// is the problem this exists to end. So the card says what is happening
// and the page goes, whatever was open: an online match is already gone
// with the server, a practice match costs nobody anything, and a champion
// draft in the Forge is on the server.

import { reloadWithoutAsking } from '../game/nav';
import { el, screen } from './menu';

export const RELOAD_AFTER_MS = 3000;

export function showReloadNotice(
  container: HTMLElement,
  reload: () => void = reloadWithoutAsking,
  waitMs = RELOAD_AFTER_MS,
): void {
  const { card } = screen(container);
  card.append(
    el('h1', 'menu-title', 'New version'),
    el('p', 'menu-sub', 'The game was just updated. Reloading in a moment.'),
  );
  window.setTimeout(reload, waitMs);
}
