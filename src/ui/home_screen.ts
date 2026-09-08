// The home (CONTEXT.md: Home): the page a signed-in account lands on. A
// bar to every section, the play tiles, the join line, and the live
// counts at the foot; everything else opens from here, as a page or a
// drawer, and comes back. Same chrome as the landing page (ui/page.ts) on
// purpose: the two used to look like two different products separated by
// one form submit.
//
// It only decides; the entry point owns the flow. Everything here resolves
// the promise with a HomeChoice and takes the page down.

import type { ForgedChampionDef } from '../sim/forge/forged_def';
import type { TeamId } from '../sim/types';
import { openAcademy } from './academy';
import { openAccountDrawer, openLiveDrawer } from './account_drawer';
import type { AuthedAccount } from './auth';
import type { DiscordResult } from './discord_entry';
import { buildDiscordWelcome } from './discord_welcome';
import { buildEmailNotice, type ConfirmResult } from './email_status';
import { openForgeEditor } from './forge_editor';
import { openGallery } from './gallery';
import { startBackdrop } from './home_backdrop';
import { type HomeSection, mountHomeBar } from './home_bar';
import { buildHomePanels } from './home_panels';
import { PLAY_TILES, type PlayTile } from './home_tiles';
import { openLadderPage, type Way } from './ladder_page';
import { el, ensureMenuCss } from './menu';
import { buildPage, ensurePageCss, fetchStats, renderStats } from './page';
import { buildJoinLine, buildPlayTiles } from './play_tiles';
import { openRosterBrowser } from './roster_browser';
import { createSectionHost } from './section_host';
import type { Drawer } from './side_drawer';

// Only what this page adds to the shared chrome: one column under the
// bar, the tiles' width and centered on anything wider, so a wide window
// does not leave everything hugging its left edge. The tiles stand first,
// the panels under them, the foot at the bottom of whatever is left; the
// page scrolls once the panels need it to.
const CSS = `
.pg.home .pg-inner { padding-bottom: 16px; }
.home-col { flex: 1; display: flex; flex-direction: column; width: 100%; max-width: 1180px;
  margin: 0 auto; }
.pg.home .home-main { display: flex; flex-direction: column; padding: 18px 0 0; }
.home-kicker { font-family: Cinzel, Georgia, serif; font-size: 13px; font-weight: 800;
  letter-spacing: 3.5px; text-transform: uppercase; color: #9fb4d2; margin: 0 0 12px; }
.home-foot { display: flex; align-items: baseline; gap: 26px; flex-wrap: wrap;
  margin-top: auto; padding-top: 26px; }
.home-foot .pg-stats { margin: 0; }
.home-foot .pg-stat b { font-size: 15px; }
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

export function showHome(
  container: HTMLElement,
  account: AuthedAccount,
  prefillCode?: string,
  // Set only on the page load a confirmation link redirected back to.
  justConfirmed: ConfirmResult | null = null,
  // Set only on the page load a round trip through Discord came back on
  // (ADR 0009); 'created' is the one that earns a welcome.
  discordResult: DiscordResult | null = null,
  // Open the Academy on this bot at once: the way back from a replay it
  // handed over.
  reopen: { botId: string } | null = null,
): Promise<HomeChoice> {
  ensureCss();
  const accountName = account.name;
  return new Promise((resolve) => {
    const { root, inner, bar } = buildPage('home', false);
    const stopBackdrop = startBackdrop(root);
    container.appendChild(root);

    // A drawer open when the page leaves would keep its Escape listener.
    const drawers = new Set<Drawer>();
    const openDrawer = (open: () => Drawer): void => {
      for (const d of drawers) d.close();
      drawers.clear();
      drawers.add(open());
    };

    // The sections open under the bar, which stays live above them, so one
    // click goes from any section to the next (ui/section_host.ts).
    const sections = createSectionHost(root, bar.root, (key) => {
      homeBar.setActive(key);
      // Back on the tiles: the section may have moved a number the
      // panels show (a champion sealed, an Arena match played).
      if (key === null) panels.refresh();
    });

    // --- teardown, shared by every way off this page ---
    const leave = (): void => {
      window.removeEventListener('loc:replay', onWatchReplay);
      window.removeEventListener('loc:spectate', onSpectate);
      window.removeEventListener('loc:forge-test', onForgeTest);
      for (const d of drawers) d.close();
      sections.destroy();
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

    // --- the bar: the sections, Live, and the account's own drawer ---
    const showAcademy = (botId?: string): void =>
      sections.open('academy', (host) => openAcademy(host, botId ? { botId } : {}));
    const onWatch = (id: number, follow?: number): void => {
      window.dispatchEvent(
        new CustomEvent('loc:replay', {
          detail: { id, ...(follow !== undefined ? { follow } : {}) },
        }),
      );
    };
    const showLadder = (way: Way = 'hand'): void =>
      sections.open('ladder', (host) =>
        openLadderPage(
          host,
          {
            onPlay: (mode) => done(mode),
            onWatch,
            openAcademy: () => showAcademy(),
          },
          way,
        ),
      );
    const showGallery = (pick?: string): void =>
      sections.open('gallery', (host) => openGallery(host, pick ? { pick } : {}));
    // The two sections that spend leave the bar's balances behind them, so
    // the bar asks the account sheet again on the way out rather than
    // being told from inside: a section that has just spent knows its own
    // number, not both, and the bar carries both.
    const spending = (open: (host: HTMLElement) => () => void) => (host: HTMLElement) => {
      const close = open(host);
      return (): void => {
        close();
        homeBar.refreshBalances();
      };
    };
    const showForge = (): void => sections.open('forge', spending(openForgeEditor));
    const barSections: HomeSection[] = [
      { key: 'ladder', label: 'Ladder', open: () => showLadder() },
      { key: 'academy', label: 'Academy', open: () => showAcademy() },
      { key: 'forge', label: 'Forge', open: showForge },
      { key: 'gallery', label: 'Gallery', open: () => showGallery() },
      {
        key: 'champions',
        label: 'Champions',
        open: () => sections.open('champions', spending(openRosterBrowser)),
      },
    ];
    const showAccount = (): void =>
      openDrawer(() =>
        openAccountDrawer(container, {
          name: accountName,
          openLadder: () => {
            sections.close();
            showLadder();
          },
        }),
      );
    const homeBar = mountHomeBar(bar, {
      name: accountName,
      sections: barSections,
      onLive: () => openDrawer(() => openLiveDrawer(container)),
      onAccount: showAccount,
      onHome: () => sections.close(),
    });

    // Everything under the bar stands in one column (the CSS above), so
    // hiding the column is hiding the page while a section is open.
    const col = el('div', 'home-col');
    inner.appendChild(col);

    // Between the bar and the tiles: read on the way past, never in the
    // way of the tile somebody came here to press.
    const notice = buildEmailNotice(account, justConfirmed);
    if (notice) col.appendChild(notice);
    const welcome = buildDiscordWelcome(discordResult);
    if (welcome) col.appendChild(welcome);

    // --- play ---
    const onTile = (tile: PlayTile): void => {
      if (tile.goes.to === 'mode') done(tile.goes.mode);
      else if (tile.goes.key === 'academy') showAcademy();
    };
    const main = el('section', 'home-main');
    main.append(
      el('h2', 'home-kicker', 'Play'),
      buildPlayTiles(PLAY_TILES, onTile),
      buildJoinLine(prefillCode, (code) => done('join', code)),
    );
    col.appendChild(main);

    // --- the panels: the reader, the ladder, the bots, the Forge ---
    const panels = buildHomePanels({
      name: accountName,
      openLadder: showLadder,
      openAcademy: () => showAcademy(),
      openForge: showForge,
      openGallery: showGallery,
      openCareer: showAccount,
      onWatch,
    });
    col.appendChild(panels.root);

    // --- the foot: the counts, and Live in the bar told the same number ---
    const foot = el('footer', 'home-foot');
    const stats = el('div', 'pg-stats');
    foot.appendChild(stats);
    col.appendChild(foot);
    void fetchStats().then((s) => {
      if (!s || !stats.isConnected) return;
      renderStats(stats, s);
      homeBar.setLiveCount(s.matches);
    });

    if (reopen) showAcademy(reopen.botId);
  });
}
