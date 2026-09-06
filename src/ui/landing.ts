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
import { CONTRIBUTE_LEAD, CONTRIBUTE_TITLE, CONTRIBUTE_WAYS } from './landing_contribute';
import { LANDING_MODES } from './landing_modes';
import { DISCORD, PRIVACY, REPO } from './links';
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

/* The second line of a way-in card: the caveats, which have to be read
   before the button but must not compete with the offer above them. */
.pg.land .pg-card .pg-card-fine { color: #8ea4c4; font-size: 12px; }

/* The contribution band, under the two ways in. It is the one section
   here that is not about playing, so it is set apart rather than made
   into a fifth tile: a rule above it, no card, no painting, and the width
   of the bento so the page keeps one edge. */
.pg-give { max-width: 1180px; margin: 46px auto 0; padding-top: 34px;
  border-top: 1px solid #22314e; }
.pg-give h2 { font-family: Cinzel, Georgia, serif; font-size: 21px; letter-spacing: 2px;
  text-transform: uppercase; color: #e6d7a8; margin: 0; line-height: 1.15; }
.pg-give > p { font-size: 13.5px; line-height: 1.6; color: #b9cbe4;
  margin: 10px 0 0; max-width: 66ch; }
.pg-give-row { display: grid; gap: 16px; margin-top: 26px;
  grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pg-give-way { display: flex; flex-direction: column; border-radius: 12px;
  border: 1px solid #22314e; background: rgba(10, 17, 32, 0.72); padding: 16px 18px 18px; }
.pg-give-way h3 { font-family: Cinzel, Georgia, serif; font-size: 15px; letter-spacing: 1.6px;
  text-transform: uppercase; color: #dfe7f5; margin: 0; }
.pg-give-way p { font-size: 12.5px; line-height: 1.5; color: #9db2cf; margin: 8px 0 16px; }
/* The link sits at the foot of every card whatever the line above it
   runs to, so the three read as one row rather than three heights. */
.pg-give-way a { margin-top: auto; align-self: flex-start; color: #e6d7a8;
  text-decoration: none; font-size: 12.5px; letter-spacing: 0.4px;
  border-bottom: 1px solid rgba(230, 215, 168, 0.35); padding-bottom: 1px; }
.pg-give-way a:hover { border-bottom-color: #e6d7a8; }
.pg-give-way a::after { content: ' \\2192'; }
@media (max-width: 900px) {
  .pg-give-row { grid-template-columns: minmax(0, 1fr); }
  .pg-give { max-width: 620px; }
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
    // The other verb. "Source" on the right names a place and asks
    // nothing; this one scrolls to the section that actually makes the
    // case, because being open is the thing this game has that the genre
    // does not and a five letter nav link was hiding it.
    const toGive = el('button', '', 'Contribute');
    toGive.type = 'button';
    toGive.addEventListener('click', () => {
      root.querySelector('.pg-give')?.scrollIntoView({ behavior: 'smooth' });
    });
    bar.links.appendChild(toGive);
    bar.right.appendChild(navLink('Discord', DISCORD));
    bar.right.appendChild(navLink('Source', REPO));
    // Last, and quiet, but on the page a first-time visitor actually
    // reads: a site that counts anything owes them somewhere to look.
    bar.right.appendChild(navLink('Privacy', PRIVACY));

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
    // "One match against bots" undersold this badly, and the card had the
    // empty half to prove it: next to a sign-in form, three short lines
    // read as the lesser thing rather than the free one. It is a whole
    // 5v5 on the same simulation, and with the collection wall in front
    // of an account (ADR 0018) the practice match is now the only place
    // the whole roster is open, which is worth saying out loud.
    offline.append(
      el('h2', '', 'Or try it first'),
      el(
        'p',
        '',
        'A full 5v5: you and four bot allies against five more. Take a lane, ' +
          'buy from the same shop, and pick any champion in the roster, with ' +
          'nothing to unlock first.',
      ),
      el(
        'p',
        'pg-card-fine',
        'The ranked simulation exactly, running in this tab. No account, ' + 'nothing saved.',
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

    // --- and the thing the genre does not offer ---
    const give = el('section', 'pg-give');
    give.append(el('h2', '', CONTRIBUTE_TITLE), el('p', '', CONTRIBUTE_LEAD));
    const giveRow = el('div', 'pg-give-row');
    for (const way of CONTRIBUTE_WAYS) {
      const card = el('article', 'pg-give-way');
      const link = el('a', '', way.cta) as HTMLAnchorElement;
      link.href = way.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      card.append(el('h3', '', way.title), el('p', '', way.line), link);
      giveRow.appendChild(card);
    }
    give.appendChild(giveRow);
    inner.appendChild(give);
  });
}
