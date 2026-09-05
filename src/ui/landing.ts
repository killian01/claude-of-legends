// The front door: what a visitor sees before anything else, and the screen
// every other one stands behind (ADR 0006).
//
// Its shape follows the one world-of-claudecraft uses for the same job,
// because the job is the same: a browser game whose landing page IS the
// application, so the page has to say what this is, prove it is alive, and
// offer the way in, all above the fold and all in one screen.
//
// There is one way in and it is the account. The page used to offer the
// offline practice match beside it, and that door cost more than it paid:
// a visitor could not tell from out here what was in there, and it sent
// the curious ones into a match instead of into the game. Signing up is a
// name and a password, or one click on Discord, so the shorter road is
// through the door rather than around it. Practice did not go anywhere; it
// is a play tile on the home, where somebody can see what it is first.
// The chrome this shares with the signed-in home lives in ui/page.ts.

import { type AuthedAccount, buildAuthForm } from './auth';
import type { DiscordResult } from './discord_entry';
import { startBackdrop } from './home_backdrop';
import { LANDING_MODES } from './landing_modes';
import { DISCORD, REPO } from './links';
import { el, ensureMenuCss } from './menu';
import { buildPage, ensurePageCss, mountLiveStats, navLink } from './page';

// Only what the landing page adds to the shared chrome: the one card, at a
// form's width rather than the page's, and the strip of modes under it.
const CSS = `
/* One card now, so it is sized like the form it holds; the row of cards
   the width used to serve went with the offline door. */
.pg.land .pg-cards { max-width: 460px; }

/* Under the two ways in, the two modes behind them. Not buttons: both are
   account features (ADR 0006), so out here they are things to look at and
   the card above is still the only thing to press. The strip shares the
   cards' width so it lines up with them. */
.pg-behind { max-width: 860px; margin: clamp(20px, 3.5vh, 34px) 0 0; }
.pg-behind > h2 {
  font-family: Cinzel, Georgia, serif; font-size: 12px; letter-spacing: 2.4px;
  text-transform: uppercase; color: #8ba1c0; font-weight: 700; margin: 0 0 12px;
}
.pg-modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px; }
.pg-mode { display: flex; overflow: hidden; border-radius: 14px; border: 1px solid #2b3f60;
  background: rgba(8, 12, 22, 0.86); backdrop-filter: blur(7px); min-height: 168px;
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.5); }
/* Both paintings are composed upright: the home stands these two tiles at
   the full height of its row and a phone gives them 3/4, so a wide crop
   takes the subject off at the knees. The panel hangs the painting as a
   portrait plate and sets the words beside it rather than over it. 126 by
   the 168 floor above is that same 3/4; longer copy grows the plate taller
   still, never wider, so it cannot fall back to a landscape crop. */
.pg-mode img { flex: none; width: 126px; align-self: stretch; object-fit: cover; display: block; }
.pg-mode-body { min-width: 0; padding: 16px 18px; display: flex; flex-direction: column;
  justify-content: center; }
.pg-mode h3 { font-family: Cinzel, Georgia, serif; font-size: 16px; letter-spacing: 1.8px;
  text-transform: uppercase; margin: 0; color: #e6d7a8; }
.pg-mode p { font-size: 12.5px; line-height: 1.5; color: #b9cbe4; margin: 6px 0 0; }
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

// Signed in: everything the server allows is now reachable. The page has
// one way off it, so this is a record rather than a union.
export interface LandingResult {
  account: AuthedAccount;
}

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

    // --- the way in ---
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
      buildAuthForm((account) => finish({ account }), discordResult),
    );

    ways.appendChild(online);
    inner.appendChild(ways);

    // --- and what the door opens onto ---
    const behind = el('section', 'pg-behind');
    behind.appendChild(el('h2', '', 'Also inside'));
    const modes = el('div', 'pg-modes');
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
      modes.appendChild(item);
    }
    behind.appendChild(modes);
    inner.appendChild(behind);
  });
}
