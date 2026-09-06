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
/* Two ways in, one card each. The row used to be a group of three under
   a heading that had to say "all three", which is a heading explaining a
   layout: the reader could not see what the group was until they had
   counted it, and the account read as the price of the ladder rather
   than the way in. One card carries the account and shows what it opens
   inside itself, the other is the practice match, and neither needs a
   caption over it. The account card is the wider of the two: it is the
   one with a form to type into. */
.pg.land .pg-cards { display: grid; max-width: 1180px; gap: 18px; align-items: start;
  grid-template-columns: minmax(0, 7fr) minmax(0, 4fr); }
/* What the account opens, inside the card that opens it: the same three
   paintings the home stands at full height, in the same order, so the
   door and the room behind it look alike. Upright and edge to edge, with
   no gap between them: one band of art rather than three chips, and the
   form sits on it rather than under it. */
.pg-opens { position: relative; display: grid; gap: 0; margin: 4px 0 2px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-radius: 14px; overflow: hidden; border: 1px solid #2b3f60;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55); }
/* The form, over the band. It floats in the middle so each painting keeps
   its own foot, where its name is: a panel rather than a full scrim, or
   the three names would be dimmed by the very thing standing on them. */
.pg-opens-form { position: absolute; left: 50%; top: 50%; z-index: 1;
  transform: translate(-50%, -50%); width: min(420px, calc(100% - 36px));
  padding: 18px; border-radius: 12px; border: 1px solid rgba(140, 168, 208, 0.28);
  background: rgba(6, 10, 20, 0.9);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(4, 7, 16, 0.6); }
/* Each card is its own height now, so there is no shared foot to pin the
   button to: it sits under the line that sells it. */
.pg.land .pg-card.plain .menu-btn { margin-top: 4px; }

/* One painting of the band. Not a button: all three are account features
   (ADR 0006), so they carry no call to action and none lifts under the
   pointer; the form standing on them is the thing to press.
   Upright, and taller than the 3/4 the paintings are cropped to
   elsewhere: the panel in the middle is 270px of form, and at 3/4 it
   covered all three names. The band has to be tall enough that each
   painting keeps a foot below the panel to write its name on. */
.pg-mode { position: relative; overflow: hidden; background: #0a1120;
  display: flex; align-items: flex-end; aspect-ratio: 3 / 5; }
/* Both paintings are composed upright, which is why they can fill a tall
   column edge to edge. The subject sits high in each, so the crop favours
   the top and leaves the foot scrim room to sit on sky rather than on a
   face. */
.pg-mode img { position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; object-position: 50% 32%; }
.pg-mode-body { position: relative; width: 100%; padding: 44px 13px 12px;
  background: linear-gradient(180deg, rgba(4, 7, 16, 0) 0%, rgba(4, 7, 16, 0.82) 52%,
    rgba(4, 7, 16, 0.96) 100%); }
.pg-mode h3 { font-family: Cinzel, Georgia, serif; font-size: 15px; letter-spacing: 2.2px;
  text-transform: uppercase; margin: 0; color: #e6d7a8; line-height: 1.1; }

/* Four across needs about 1120: below that the sign-in form is squeezed
   and the paintings turn into slivers. So the row folds instead of
   shrinking. Both cards take the full width and the two paintings share
   the row between them, at the 3/4 a phone gives them on the home; a card
   is only ever as wide as its form wants to be, which is what the narrower
   ceiling is for. */
@media (max-width: 1120px) {
  /* Two cards, stacked, the account one first: it is the one with the
     form, and a form pushed below the fold is a form nobody fills. */
  .pg.land .pg-cards { grid-template-columns: minmax(0, 1fr); max-width: 620px; gap: 22px; }
}
/* Narrow, three upright paintings leave the panel no room to float in, so
   it comes down and stands under the band. The art stays three across: it
   is the row the home draws, and a stack of three would be a page of its
   own. */
@media (max-width: 560px) {
  .pg-opens { border-radius: 12px 12px 0 0; }
  /* Static, the panel is a grid item again, so it has to be told to
     cross all three columns instead of standing in the first one. */
  .pg-opens-form { position: static; transform: none; width: auto;
    grid-column: 1 / -1; border-radius: 0 0 12px 12px; border-top: 0; }
  .pg-mode-body { padding: 30px 8px 8px; }
  .pg-mode h3 { font-size: 12px; letter-spacing: 1.2px; }
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

    // One card, not a row of three under a heading counting them. The
    // heading had to say "all three" because the reader could not see
    // what the group was until they had counted it themselves, and an
    // account read as the price of the ladder rather than the way in.
    // So: the card is the account, the paintings inside it are what the
    // account opens, and nothing explains what a bot or a forge is. The
    // paintings do that, and the page is not a manual.
    const online = el('section', 'pg-card gold');
    online.append(
      el('h2', '', 'Create a free account'),
      el('p', '', 'It keeps your rating and your record, and opens these.'),
    );
    // The three the home stands at full height, wearing the paintings the
    // home gives them, and the form stands ON the band rather than under
    // it: what an account opens is the backdrop of the thing that opens
    // it.
    const opens = el('div', 'pg-opens');
    for (const mode of LANDING_MODES) {
      const art = el('img', '');
      art.src = mode.art;
      // The title says which mode this is, so the painting is decoration.
      art.alt = '';
      art.loading = 'lazy';
      art.decoding = 'async';
      const body = el('div', 'pg-mode-body');
      body.append(el('h3', '', mode.title));
      const item = el('article', 'pg-mode');
      item.append(art, body);
      opens.appendChild(item);
    }
    const formPanel = el('div', 'pg-opens-form');
    formPanel.appendChild(
      buildAuthForm((account) => finish({ kind: 'account', account }), discordResult),
    );
    opens.appendChild(formPanel);
    online.appendChild(opens);

    // The other way in, and the only one that needs nothing. It says what
    // it is in one line: a visitor who has read the title of the page
    // knows what a 5v5 against bots is.
    const offline = el('section', 'pg-card plain');
    const offlineBtn = el('button', 'menu-btn', 'Play offline now');
    offlineBtn.addEventListener('click', () => finish({ kind: 'offline' }));
    offline.append(
      el('h2', '', 'Or try it first'),
      el('p', '', 'A full 5v5 against bots, in this tab, with the whole roster open.'),
      el('p', 'pg-card-fine', 'No account, nothing saved.'),
      offlineBtn,
    );

    ways.append(online, offline);
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
