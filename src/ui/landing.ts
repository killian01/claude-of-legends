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
import { LANDING_MODES } from './landing_modes';
import { DISCORD, REPO } from './links';
import { el, ensureMenuCss } from './menu';
import { buildPage, ensurePageCss, mountLiveStats, navLink } from './page';

// Only what the landing page adds to the shared chrome: the bento, which
// is the home's row of tiles as a visitor can have it.
const CSS = `
/* The row reads the way the home's tiles do (ui/play_tiles.ts): the way
   in widest on the left, then Bots and the Forge standing beside it, then
   the smaller way in at the far right. Thirteen columns so 4, 3, 3 and 3
   divide the row with the gaps; the sign-in form is what sets the widest
   track, since it is the one thing here somebody has to type into. */
.pg.land .pg-cards { display: grid; max-width: 1180px; gap: 16px; align-items: stretch;
  grid-template-columns: minmax(0, 4fr) minmax(0, 3fr) minmax(0, 3fr) minmax(0, 3fr); }
.pg.land .pg-card .menu-btn { margin-top: auto; }

/* Bots and the Forge, standing between the two ways in the way they stand
   on the home. Not buttons: both are account features (ADR 0006), so they
   carry no call to action and neither lifts under the pointer; the cards
   on either side are the only things to press. */
.pg-mode { position: relative; overflow: hidden; border-radius: 14px; border: 1px solid #2b3f60;
  background: #0a1120; box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55);
  display: flex; align-items: flex-end; min-height: 300px; }
/* Both paintings are composed upright, which is why they can fill a tall
   column edge to edge. The subject sits high in each, so the crop favours
   the top and leaves the foot scrim room to sit on sky rather than on a
   face. */
.pg-mode img { position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; object-position: 50% 26%; }
.pg-mode-body { position: relative; width: 100%; padding: 74px 16px 16px;
  background: linear-gradient(180deg, rgba(4, 7, 16, 0) 0%, rgba(4, 7, 16, 0.82) 46%,
    rgba(4, 7, 16, 0.96) 100%); }
.pg-mode h3 { font-family: Cinzel, Georgia, serif; font-size: 17px; letter-spacing: 2.2px;
  text-transform: uppercase; margin: 0; color: #e6d7a8; line-height: 1.1; }
.pg-mode p { font-size: 12px; line-height: 1.45; color: #b9cbe4; margin: 6px 0 0; }

/* Four across needs about 1120: below that the sign-in form is squeezed
   and the paintings turn into slivers. So the row folds instead of
   shrinking. Both cards take the full width and the two paintings share
   the row between them, at the 3/4 a phone gives them on the home; a card
   is only ever as wide as its form wants to be, which is what the narrower
   ceiling is for. */
@media (max-width: 1120px) {
  .pg.land .pg-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: 620px; }
  .pg.land .pg-card { grid-column: 1 / -1; }
  .pg-mode { min-height: 0; aspect-ratio: 3 / 4; }
}
/* One column, and the panel goes square: the paintings are square to
   begin with, so at 1/1 the tile is the whole painting and nothing is
   cropped at all. */
@media (max-width: 620px) {
  .pg.land .pg-cards { grid-template-columns: minmax(0, 1fr); }
  .pg-mode { aspect-ratio: 1 / 1; }
}
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
    bar.right.appendChild(navLink('Discord', DISCORD));
    bar.right.appendChild(navLink('Source', REPO));

    // --- hero: the lockup, and the copy beside it ---
    // The name is art here rather than text: the lockup carries the crest
    // over the wordmark, so the bar needs no crest of its own. Still an h1,
    // because the page's heading is the game's name either way.
    const logo = el('img', '');
    logo.src = '/logo.webp';
    logo.alt = 'Claude of Legends';
    logo.width = 960;
    logo.height = 1181;
    logo.decoding = 'async';
    // The one image above the fold, and the largest thing on the page.
    logo.fetchPriority = 'high';
    const title = el('h1', 'pg-lockup');
    title.appendChild(logo);

    const copy = el('div', 'pg-hero-copy');
    copy.appendChild(
      el(
        'p',
        'pg-tag',
        'A 5v5 MOBA that runs in a browser tab. Three lanes, ten champions, ' +
          'jungle camps and fog of war. Nothing to install.',
      ),
    );
    const stats = el('div', 'pg-stats');
    copy.appendChild(stats);
    mountLiveStats(stats);
    hero.append(title, copy);

    // --- the two ways in ---
    const ways = el('div', 'pg-cards');

    const online = el('section', 'pg-card gold');
    online.append(
      el('h2', '', 'Play ranked'),
      el(
        'p',
        '',
        'Your rating, your match history and your place on the ladder, kept on any ' +
          'machine you sign in from.',
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
        'One match against bots, entirely in this tab. No account, nothing saved, ' +
          'same simulation as ranked.',
      ),
      offlineBtn,
    );

    // Between the two ways in, the two modes behind them, standing where
    // the home stands their tiles.
    ways.appendChild(online);
    for (const mode of LANDING_MODES) {
      const art = el('img', '');
      art.src = mode.art;
      // The title says which mode this is, so the painting is decoration.
      art.alt = '';
      art.loading = 'lazy';
      art.decoding = 'async';
      const body = el('div', 'pg-mode-body');
      body.append(el('h3', '', mode.title), el('p', '', mode.line));
      const item = el('article', 'pg-mode');
      item.append(art, body);
      ways.appendChild(item);
    }
    ways.appendChild(offline);
    inner.appendChild(ways);
  });
}
