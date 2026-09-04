// The front door: what a visitor sees before anything else, and the only
// screen reachable without an account (ADR 0006).
//
// Its shape follows the one world-of-claudecraft uses for the same job,
// because the job is the same: a browser game whose landing page IS the
// application, so the page has to say what this is, prove it is alive,
// and offer the two ways in, all above the fold and all in one screen.
// The two ways in are the load-bearing part, and they are not a design
// flourish: online needs an account because the server refuses anything
// else, and offline needs none because it opens no connection at all.
// The chrome it shares with the signed-in home lives in ui/page.ts.

import { type AuthedAccount, buildAuthForm } from './auth';
import type { DiscordResult } from './discord_entry';
import { startBackdrop } from './home_backdrop';
import { el, ensureMenuCss } from './menu';
import { buildPage, ensurePageCss, mountLiveStats, navLink, REPO } from './page';

// Only what the landing page adds to the shared chrome: two cards side by
// side whose calls to action line up however long the copy above them is.
const CSS = `
.pg.land .pg-cards { max-width: 860px; }
.pg.land .pg-card .menu-btn { margin-top: auto; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  // These screens use .menu-btn and .menu-input without opening a card.
  ensureMenuCss();
  ensurePageCss();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export type LandingResult =
  // Signed in: everything the server allows is now reachable.
  | { kind: 'account'; account: AuthedAccount }
  // Chose the offline practice match, which needs no account.
  | { kind: 'offline' };

// `discordResult` is what a round trip through Discord came back with, if
// this load came from one; the credential panel is the only thing on this
// page that has anything to say about it (ADR 0009).
export function showLanding(
  container: HTMLElement,
  discordResult: DiscordResult | null = null,
): Promise<LandingResult> {
  ensureCss();
  return new Promise((resolve) => {
    const { root, inner, bar, hero } = buildPage('land', true);
    const stopBackdrop = startBackdrop(root);
    container.appendChild(root);

    const finish = (result: LandingResult): void => {
      stopBackdrop();
      root.remove();
      resolve(result);
    };

    // --- the bar: the same one the home wears, with the little it needs ---
    const toPlay = el('button', '', 'Play');
    toPlay.type = 'button';
    toPlay.addEventListener('click', () => {
      root.querySelector('.pg-cards')?.scrollIntoView({ behavior: 'smooth' });
    });
    bar.links.appendChild(toPlay);
    bar.right.appendChild(navLink('Source', REPO));

    // --- hero ---
    hero.append(
      el('h1', 'pg-title', 'Claude of Legends'),
      el(
        'p',
        'pg-tag',
        'A 5v5 MOBA that runs in a browser tab. Three lanes, ten champions with full kits, ' +
          'jungle camps, a neutral objective and fog of war, over one deterministic simulation ' +
          'and an authoritative server. Nothing to install.',
      ),
    );
    const stats = el('div', 'pg-stats');
    hero.appendChild(stats);
    mountLiveStats(stats);

    // --- the two ways in ---
    const ways = el('div', 'pg-cards');

    const online = el('section', 'pg-card gold');
    online.append(
      el('h2', '', 'Play ranked'),
      el(
        'p',
        '',
        'An account keeps your rating, your match history and your place on the ladder, ' +
          'on any machine you sign in from.',
      ),
      buildAuthForm((account) => finish({ kind: 'account', account }), discordResult),
    );

    const offline = el('section', 'pg-card plain');
    const offlineBtn = el('button', 'menu-btn', 'Play offline now');
    offlineBtn.addEventListener('click', () => finish({ kind: 'offline' }));
    offline.append(
      el('h2', '', 'Or try it first'),
      el(
        'p',
        '',
        'One match against bots, running entirely in this tab. No account, no server, ' +
          'nothing saved. It is the same simulation the ranked game runs.',
      ),
      offlineBtn,
    );

    ways.append(online, offline);
    inner.appendChild(ways);
  });
}
