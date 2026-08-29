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
// Everything below that is our own: our sections, our copy, our art.

import { type AuthedAccount, buildAuthForm } from './auth';
import { startBackdrop } from './home_backdrop';
import { el, ensureMenuCss } from './menu';

const REPO = 'https://github.com/killian01/claude-of-legends';

const CSS = `
/* menu.ts scopes this to .menu, and a bare .menu-input without it draws
   its padding outside its 100% width and hangs off the card. */
.land, .land * { box-sizing: border-box; }
.land { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden;
  font-family: system-ui, sans-serif; color: #c9d9ee; background: #0a1120; z-index: 10; }
.land-inner { position: relative; z-index: 2; min-height: 100%; display: flex;
  flex-direction: column; padding: 0 clamp(16px, 5vw, 56px) 40px; }

.land-nav { display: flex; align-items: baseline; gap: 18px; padding: 20px 0 0; flex-wrap: wrap; }
.land-mark { font-family: Cinzel, Georgia, serif; font-weight: 800; letter-spacing: 3px;
  text-transform: uppercase; font-size: 15px; color: #e6d7a8; margin-right: auto; }
.land-nav a, .land-nav button {
  background: none; border: 0; padding: 0; font: inherit; font-size: 12px; cursor: pointer;
  color: #8ba1c0; text-decoration: none; letter-spacing: 0.5px;
}
.land-nav a:hover, .land-nav button:hover { color: #dceaff; }

.land-hero { padding: clamp(28px, 7vh, 72px) 0 0; max-width: 720px; }
.land-title {
  font-family: Cinzel, Georgia, 'Times New Roman', serif;
  font-size: clamp(38px, 7vw, 78px); line-height: 1.02; letter-spacing: 3px;
  text-transform: uppercase; margin: 0;
  background: linear-gradient(180deg, #f9ecc0 0%, #dcb85e 52%, #9d7429 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 6px 40px rgba(0, 0, 0, 0.55);
}
.land-tag { font-size: clamp(14px, 1.6vw, 17px); line-height: 1.55; color: #b9cbe4;
  margin: 16px 0 0; max-width: 56ch; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8); }

.land-stats { display: flex; gap: 26px; margin: 22px 0 0; flex-wrap: wrap; }
.land-stat { display: flex; align-items: baseline; gap: 7px; font-size: 12px; color: #8ba1c0; }
.land-stat b { font-size: 19px; font-weight: 800; color: #e6d7a8; font-variant-numeric: tabular-nums; }
.land-live::before {
  content: ''; width: 7px; height: 7px; border-radius: 50%; background: #6ad07a;
  display: inline-block; margin-right: 7px; box-shadow: 0 0 8px #6ad07a;
}

.land-ways { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
  gap: 18px; margin: clamp(26px, 5vh, 52px) 0 0; max-width: 860px; align-items: start; }
.land-way {
  background: rgba(8, 12, 22, 0.86); backdrop-filter: blur(7px);
  border: 1px solid #2b3f60; border-radius: 14px; padding: 20px 22px 22px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55); display: flex; flex-direction: column;
}
.land-way.online { border-color: #6b5a2e; }
.land-way h2 { font-family: Cinzel, Georgia, serif; font-size: 17px; letter-spacing: 1.6px;
  text-transform: uppercase; margin: 0 0 6px; color: #e6d7a8; }
.land-way.offline h2 { color: #9fb4d2; }
.land-way p { font-size: 12.5px; line-height: 1.55; color: #93a8c4; margin: 0 0 14px; }
.land-way .menu-btn { margin-top: auto; }

.land-why { margin: clamp(34px, 6vh, 64px) 0 0; max-width: 980px; }
.land-why h3 { font-size: 11px; letter-spacing: 2.4px; text-transform: uppercase;
  color: #6d829f; margin: 0 0 16px; font-weight: 700; }
.land-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 20px; }
.land-cell h4 { font-size: 13.5px; margin: 0 0 6px; color: #dceaff; font-weight: 700; }
.land-cell p { font-size: 12.5px; line-height: 1.6; color: #8ba1c0; margin: 0; }
.land-cell code { font-size: 11.5px; color: #c2a865; }

.land-foot { margin: clamp(30px, 6vh, 56px) 0 0; padding-top: 18px;
  border-top: 1px solid rgba(90, 115, 150, 0.24);
  display: flex; gap: 18px; flex-wrap: wrap; font-size: 11.5px; color: #6d829f; }
.land-foot a { color: #8ba1c0; text-decoration: none; }
.land-foot a:hover { color: #dceaff; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  // These screens use .menu-btn and .menu-input without opening a card.
  ensureMenuCss();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export type LandingResult =
  // Signed in: everything the server allows is now reachable.
  | { kind: 'account'; account: AuthedAccount }
  // Chose the offline practice match, which needs no account.
  | { kind: 'offline' };

// The three architecture ideas the project is actually built on
// (CLAUDE.md). A visitor who does not care scrolls past; one who does
// gets the real thing rather than marketing adjectives.
const WHY: readonly { title: string; body: string }[] = [
  {
    title: 'One simulation, every host',
    body: 'The same deterministic core runs in your browser, on the server, and headless with no browser at all. A fixed 20 Hz tick and every random number from one seeded generator, so the same seed replays the same match anywhere.',
  },
  {
    title: 'The server decides',
    body: 'Your client draws the world and never rules on it. Snapshots are cut to what your team can see, so the fog of war is enforced where it cannot be read out of memory.',
  },
  {
    title: 'Every bot is a Policy',
    body: 'One function from an observation to an action, with no I/O and no privileged view. A trained model joins a match through exactly the contract a scripted bot uses, and the decision budget is the same for bots and for people.',
  },
];

interface PublicStats {
  online: number;
  matches: number;
  accounts: number;
}

async function fetchStats(): Promise<PublicStats | null> {
  try {
    const res = await fetch('/api/public/stats', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as PublicStats;
  } catch {
    return null;
  }
}

export function showLanding(container: HTMLElement): Promise<LandingResult> {
  ensureCss();
  return new Promise((resolve) => {
    const root = el('div', 'land');
    const stopBackdrop = startBackdrop(root);
    const inner = el('div', 'land-inner');
    root.appendChild(inner);
    container.appendChild(root);

    const finish = (result: LandingResult): void => {
      stopBackdrop();
      root.remove();
      resolve(result);
    };

    // --- nav ---
    const nav = el('nav', 'land-nav');
    const mark = el('span', 'land-mark', 'Claude of Legends');
    const repo = el('a', '', 'Source');
    (repo as HTMLAnchorElement).href = REPO;
    (repo as HTMLAnchorElement).target = '_blank';
    (repo as HTMLAnchorElement).rel = 'noreferrer';
    const toPlay = el('button', '', 'Play');
    toPlay.addEventListener('click', () => {
      document.querySelector('.land-ways')?.scrollIntoView({ behavior: 'smooth' });
    });
    const toWhy = el('button', '', 'How it works');
    toWhy.addEventListener('click', () => {
      document.querySelector('.land-why')?.scrollIntoView({ behavior: 'smooth' });
    });
    nav.append(mark, toPlay, toWhy, repo);
    inner.appendChild(nav);

    // --- hero ---
    const hero = el('section', 'land-hero');
    hero.append(
      el('h1', 'land-title', 'Claude of Legends'),
      el(
        'p',
        'land-tag',
        'A 5v5 MOBA that runs in a browser tab. Three lanes, ten champions with full kits, ' +
          'jungle camps, a neutral objective and fog of war, over one deterministic simulation ' +
          'and an authoritative server. Nothing to install.',
      ),
    );
    const stats = el('div', 'land-stats');
    hero.appendChild(stats);
    inner.appendChild(hero);

    // Alive or not, the page reads the same: the counters only appear once
    // the server has answered, rather than sitting at a hopeful zero.
    void fetchStats().then((s) => {
      if (!s || !stats.isConnected) return;
      const cell = (value: number, label: string, live = false): HTMLElement => {
        const box = el('div', live ? 'land-stat land-live' : 'land-stat');
        box.append(el('b', '', String(value)), el('span', '', label));
        return box;
      };
      stats.append(
        cell(s.online, s.online === 1 ? 'player online' : 'players online', true),
        cell(s.matches, s.matches === 1 ? 'match running' : 'matches running'),
        cell(s.accounts, s.accounts === 1 ? 'account' : 'accounts'),
      );
    });

    // --- the two ways in ---
    const ways = el('div', 'land-ways');

    const online = el('section', 'land-way online');
    online.append(
      el('h2', '', 'Play ranked'),
      el(
        'p',
        '',
        'An account keeps your rating, your match history and your place on the ladder, ' +
          'on any machine you sign in from. Free, and no email.',
      ),
      buildAuthForm((account) => finish({ kind: 'account', account })),
    );

    const offline = el('section', 'land-way offline');
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

    // --- how it works ---
    const why = el('section', 'land-why');
    why.appendChild(el('h3', '', 'How it works'));
    const grid = el('div', 'land-grid');
    for (const { title, body } of WHY) {
      const cell = el('div', 'land-cell');
      cell.append(el('h4', '', title), el('p', '', body));
      grid.appendChild(cell);
    }
    why.appendChild(grid);
    inner.appendChild(why);

    // --- footer ---
    const foot = el('footer', 'land-foot');
    const src = el('a', '', 'Source and architecture decisions');
    (src as HTMLAnchorElement).href = REPO;
    (src as HTMLAnchorElement).target = '_blank';
    (src as HTMLAnchorElement).rel = 'noreferrer';
    foot.append(
      el('span', '', 'Original names and art throughout; nothing borrowed from any other game.'),
      src,
    );
    inner.appendChild(foot);
  });
}
