// The screen you land on once signed in. Same chrome as the landing page
// (ui/page.ts) on purpose: it is the same kind of screen, a page you read
// and choose from, and the two used to look like two different products
// separated by one form submit.
//
// It only decides; the entry point owns the flow. Everything here resolves
// the promise with a HomeChoice and takes the page down.

import type { ForgedChampionDef } from '../sim/forge/forged_def';
import type { TeamId } from '../sim/types';
import { openAcademy } from './academy';
import { type AuthedAccount, signOut } from './auth';
import { buildEmailNotice, type ConfirmResult } from './email_status';
import { openForgeEditor } from './forge_editor';
import { openGallery } from './gallery';
import { startBackdrop } from './home_backdrop';
import { buildLadderCard } from './ladder_card';
import { openLadderPage } from './ladder_page';
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
  // 'forge-queue' is the Forge's own public queue (plan-forge phase 6):
  // same flow as 'queue', a separate ladder, forged champions in select.
  mode: 'practice' | 'queue' | 'forge-queue' | 'create' | 'join' | 'replay' | 'spectate';
  code?: string;
  // For mode 'replay': the saved replay to watch, and the tick to open it
  // at when a Match sheet asked for one (a death, a few seconds before).
  replayId?: number;
  replayAt?: number;
  // The unit the replay follows (the Record's bot): the picks alone
  // cannot say which seat that is when both versions of one bot played
  // (src/game/replay_seat.ts).
  replayFollow?: number;
  // For a replay opened from the Academy: the bot to reopen it on when
  // the replay ends.
  academy?: { botId: string };
  // For mode 'spectate': the live match to watch, and from whose side.
  matchId?: number;
  team?: TeamId;
  // For mode 'practice': a Forge draft to test drive as the picked champion.
  forged?: ForgedChampionDef;
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
  // Open the Academy on this bot at once: the way back from a replay it
  // handed over.
  reopen: { botId: string } | null = null,
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

    // --- teardown, shared by every way off this page ---
    const leave = (): void => {
      window.removeEventListener('loc:replay', onWatchReplay);
      window.removeEventListener('loc:spectate', onSpectate);
      window.removeEventListener('loc:forge-test', onForgeTest);
      stopBackdrop();
      root.remove();
    };
    const done = (mode: HomeChoice['mode'], code?: string): void => {
      leave();
      resolve({ name: accountName, mode, code });
    };

    // A Watch button on a career or ladder panel fires these; this page
    // owns the flow, so it is the one that resolves.
    // A bare id, or the Academy's form: the id, the tick to open at, and
    // the bot to come back to.
    function onWatchReplay(e: Event): void {
      const detail = (
        e as CustomEvent<number | { id: number; tick?: number; botId?: string; follow?: number }>
      ).detail;
      const id = typeof detail === 'number' ? detail : detail?.id;
      if (typeof id !== 'number') return;
      leave();
      resolve({
        name: accountName,
        mode: 'replay',
        replayId: id,
        ...(typeof detail === 'object' && typeof detail.tick === 'number'
          ? { replayAt: detail.tick }
          : {}),
        ...(typeof detail === 'object' && typeof detail.follow === 'number'
          ? { replayFollow: detail.follow }
          : {}),
        ...(typeof detail === 'object' && typeof detail.botId === 'string'
          ? { academy: { botId: detail.botId } }
          : {}),
      });
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
    // The Forge editor's test drive: straight into an offline practice
    // match with the draft as the picked champion.
    function onForgeTest(e: Event): void {
      const def = (e as CustomEvent<ForgedChampionDef>).detail;
      if (typeof def !== 'object' || def === null) return;
      leave();
      resolve({ name: accountName, mode: 'practice', forged: def });
    }
    window.addEventListener('loc:replay', onWatchReplay);
    window.addEventListener('loc:spectate', onSpectate);
    window.addEventListener('loc:forge-test', onForgeTest);

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

    // --- bots ---
    const botsCard = card(
      'plain',
      'Bots',
      'Field a bot instead of playing by hand. Write its playbook in the Academy, by ' +
        'talking to the coach or editing the plays, spar it against house bots in seconds, ' +
        'and watch the replay with what it was thinking on its plate.',
    );
    const academyBtn = el('button', 'menu-btn', 'Open the Academy');
    academyBtn.addEventListener('click', () => openAcademy(container));
    botsCard.append(academyBtn);

    // --- the Forge ---
    const forge = card(
      'plain',
      'The Forge',
      'Create your own champion: kit, stats, and passive, composed from the same ' +
        'primitives the roster runs on, all under one power budget. Drafts are free and ' +
        'unlimited; test drive any valid kit against bots. The Forge queue is where ' +
        'finalized creations play, on its own rating.',
    );
    const forgeBtn = el('button', 'menu-btn', 'Open the Forge');
    forgeBtn.addEventListener('click', () => openForgeEditor(container));
    const forgeQueueBtn = el('button', 'menu-btn', 'Forge queue');
    forgeQueueBtn.addEventListener('click', () => done('forge-queue'));
    const galleryBtn = el('button', 'menu-btn', 'Browse the gallery');
    galleryBtn.addEventListener('click', () => openGallery(container));
    forge.append(forgeBtn, forgeQueueBtn, galleryBtn);

    // --- career ---
    const career = card(
      'plain',
      'Career',
      'Every match you have played by hand, your champions, and anything running on the ' +
        'server right now.',
    );
    collapsible(career, 'Profile and history', buildProfilePanel);
    collapsible(career, 'Watch a live match', buildLivePanel);

    // --- the ladder (docs/design/ladder.md): your place, and the page ---
    const ladder = card(
      'gold',
      'The Ladder',
      'Four ladders, one per way you play: by hand, your bot live, your bot in the Arena, ' +
        'the Forge queue. Three rated matches place you; five tiers from Recruit to Legend.',
    );
    ladder.appendChild(
      buildLadderCard(() =>
        openLadderPage(container, {
          onPlay: (mode) => done(mode),
          onWatch: (id, follow) =>
            window.dispatchEvent(
              new CustomEvent('loc:replay', {
                detail: { id, ...(follow !== undefined ? { follow } : {}) },
              }),
            ),
          openAcademy: () => openAcademy(container),
        }),
      ),
    );

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

    cards.append(play, ladder, friends, botsCard, forge, career, learn);
    inner.appendChild(cards);
    if (reopen) openAcademy(container, { botId: reopen.botId });
  });
}
