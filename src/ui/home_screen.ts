// The screen you land on once signed in. Same chrome as the landing page
// (ui/page.ts) on purpose: it is the same kind of screen, a page you read
// and choose from, and the two used to look like two different products
// separated by one form submit.
//
// It only decides; the entry point owns the flow. Everything here resolves
// the promise with a HomeChoice and takes the page down.

import type { TeamId } from '../sim/types';
import { type AuthedAccount, signOut } from './auth';
import { buildDiscordNotice, type DiscordResult } from './discord_link';
import { buildEmailNotice, type ConfirmResult } from './email_status';
import { startBackdrop } from './home_backdrop';
import { buildLadderPanel } from './ladder_panel';
import { buildLivePanel } from './live_panel';
import { el, ensureMenuCss } from './menu';
import { buildPage, ensurePageCss, mountLiveStats, navLink, REPO } from './page';
import { buildProfilePanel } from './profile_panel';
import { openRosterBrowser } from './roster_browser';
import { buildSettingsPanel } from './settings_panel';

// Only what this page adds to the shared chrome. A panel that opens inside
// a card is given the card's full width back, since the card pads it once
// already, and a little air above the control that opened it.
const CSS = `
.pg.home .pg-card .menu-btn:first-of-type { margin-top: 0; }
.pg.home .pg-panel { margin-top: 10px; }
.pg.home .pg-note { font-size: 11.5px; color: #6d829f; margin: 12px 0 0; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  ensureMenuCss();
  ensurePageCss();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface HomeChoice {
  name: string;
  mode: 'practice' | 'queue' | 'create' | 'join' | 'replay' | 'spectate';
  code?: string;
  // For mode 'replay': the saved replay to watch.
  replayId?: number;
  // For mode 'spectate': the live match to watch, and from whose side.
  matchId?: number;
  team?: TeamId;
}

// A button that shows or hides a panel, rebuilt fresh on every open so it
// can never show a stale rating or a finished match.
function collapsible(into: HTMLElement, label: string, build: () => HTMLElement): void {
  const btn = el('button', 'menu-btn', label);
  const box = el('div', 'pg-panel');
  box.style.display = 'none';
  btn.addEventListener('click', () => {
    const open = box.style.display === 'none';
    box.style.display = open ? 'block' : 'none';
    if (open) {
      box.textContent = '';
      box.appendChild(build());
    }
  });
  into.append(btn, box);
}

function card(kind: string, title: string, blurb: string): HTMLElement {
  const section = el('section', `pg-card ${kind}`);
  section.append(el('h2', '', title), el('p', '', blurb));
  return section;
}

export function showHome(
  container: HTMLElement,
  account: AuthedAccount,
  prefillCode?: string,
  // Set only on the page load a confirmation link redirected back to.
  justConfirmed: ConfirmResult | null = null,
  // The same, for a round trip through Discord (ADR 0008).
  discordResult: DiscordResult | null = null,
): Promise<HomeChoice> {
  ensureCss();
  const accountName = account.name;
  return new Promise((resolve) => {
    const { root, inner, nav, hero } = buildPage('home');
    const stopBackdrop = startBackdrop(root);
    container.appendChild(root);

    // --- nav: who you are, and the only way back out ---
    const out = el('button', '', 'Sign out');
    out.addEventListener('click', () => {
      // A reload rather than a route back to the landing page: signing out
      // has to drop every bit of state this session built, and the entry
      // point already shows the landing page when no session answers.
      void signOut().then(() => location.reload());
    });
    nav.append(el('span', 'pg-who', accountName), out, navLink('Source', REPO));

    // --- hero ---
    hero.append(
      el('h1', 'pg-title', 'Claude of Legends'),
      el(
        'p',
        'pg-tag',
        'Queue for a ranked match, bring friends into a private lobby, or take a practice ' +
          'match against bots. Your rating and history follow the account, not this browser.',
      ),
    );
    const stats = el('div', 'pg-stats');
    hero.appendChild(stats);
    mountLiveStats(stats);

    // Between the hero and the cards: read on the way past, never in the
    // way of the button somebody came here to press.
    const notice = buildEmailNotice(account, justConfirmed);
    if (notice) inner.appendChild(notice);
    // Below it, and quieter: the address is something the account still
    // needs from its owner, while the Discord link is only ever an offer.
    inner.appendChild(buildDiscordNotice(account.discord, discordResult));

    // --- teardown, shared by every way off this page ---
    const leave = (): void => {
      window.removeEventListener('loc:replay', onWatchReplay);
      window.removeEventListener('loc:spectate', onSpectate);
      stopBackdrop();
      root.remove();
    };
    const done = (mode: HomeChoice['mode'], code?: string): void => {
      leave();
      resolve({ name: accountName, mode, code });
    };

    // A Watch button on a career or ladder panel fires these; this page
    // owns the flow, so it is the one that resolves.
    function onWatchReplay(e: Event): void {
      const id = (e as CustomEvent<number>).detail;
      if (typeof id !== 'number') return;
      leave();
      resolve({ name: accountName, mode: 'replay', replayId: id });
    }
    function onSpectate(e: Event): void {
      const detail = (e as CustomEvent<{ matchId: number; team: TeamId }>).detail;
      if (typeof detail?.matchId !== 'number') return;
      leave();
      resolve({
        name: accountName,
        mode: 'spectate',
        matchId: detail.matchId,
        team: detail.team === 1 ? 1 : 0,
      });
    }
    window.addEventListener('loc:replay', onWatchReplay);
    window.addEventListener('loc:spectate', onSpectate);

    const cards = el('div', 'pg-cards');

    // --- play ---
    const play = card(
      'gold',
      'Play',
      'The public queue, filled with bots for any seat nobody takes. Only queued matches ' +
        'with a human on each side move your rating.',
    );
    const playBtn = el('button', 'menu-btn primary', 'Play online');
    playBtn.addEventListener('click', () => done('queue'));
    const practice = el('button', 'menu-btn', 'Practice vs dummies (offline)');
    practice.addEventListener('click', () => done('practice'));
    play.append(playBtn, practice);

    // --- friends ---
    const friends = card(
      'plain',
      'Play with friends',
      'Open a private lobby and share its code, or join one you were given. A private ' +
        'match is never rated, so nothing you do in one touches the ladder.',
    );
    const create = el('button', 'menu-btn', 'Create private lobby');
    create.addEventListener('click', () => done('create'));
    const row = el('div', 'menu-row');
    const code = el('input', 'menu-input');
    code.placeholder = 'CODE';
    code.maxLength = 5;
    const join = el('button', 'menu-btn', 'Join lobby');
    if (prefillCode) {
      code.value = prefillCode;
      join.classList.add('primary');
      join.focus();
    }
    join.addEventListener('click', () => {
      if (code.value.trim().length === 5) done('join', code.value.trim().toUpperCase());
    });
    row.append(code, join);
    friends.append(create, row);

    // --- career ---
    const career = card(
      'plain',
      'Career and ladder',
      'Your rating and every match you have played, the top of the ladder, and anything ' +
        'running on the server right now.',
    );
    collapsible(career, 'Profile and history', buildProfilePanel);
    collapsible(career, 'Ladder', buildLadderPanel);
    collapsible(career, 'Watch a live match', buildLivePanel);

    // --- champions and options ---
    const learn = card(
      'plain',
      'Champions and settings',
      'Every champion with their role, passive and full kit, readable before you ever ' +
        'queue. Audio and display options live here too.',
    );
    const roster = el('button', 'menu-btn', 'Browse the champions');
    roster.addEventListener('click', () => openRosterBrowser(container));
    learn.appendChild(roster);
    collapsible(learn, 'Settings', buildSettingsPanel);

    cards.append(play, friends, career, learn);
    inner.appendChild(cards);
  });
}
