// The transient pre-game screens: queue, private lobby, champion select and
// notices. Pure DOM, callback-driven; the entry point owns the flow.
//
// Each is a card that interrupts, which is why they are cards. The two
// screens you actually land on and read (the landing page and the
// signed-in home) are full pages instead, over in ui/page.ts.

import { requestGameFullscreen } from '../game/fullscreen';
import { inviteUrl } from '../game/invite';
import type { LobbyPlayer, SelectPlayer } from '../net/protocol';
import { CHAMPION_LIST } from '../sim/content/champions';
import { SIGIL_LIST } from '../sim/content/sigils';
import { SKINS } from '../sim/content/skins';
import type { ForgedChampionDef } from '../sim/forge/forged_def';
import { resolveForgedChampion } from '../sim/forge/resolve';
import type { AbilityKey, TeamId } from '../sim/types';
import { ROLE_COLORS, setPortrait } from './champion_art';
import { describeAbility, describeSigil } from './describe';
import { startMenuBackdrop } from './menu_backdrop';
import { attachTooltip, hideTooltip } from './tooltips';

const CSS = `
.menu, .menu * { box-sizing: border-box; }
.menu {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, #1c2c4a 0%, #0a1120 75%);
  font-family: system-ui, sans-serif; color: #c9d9ee; z-index: 10;
}
.menu-backdrop-canvas { position: absolute; inset: 0; display: block; pointer-events: none; }
@keyframes menu-card-in {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.menu-card {
  position: relative; z-index: 1;
  background: rgba(9, 14, 26, 0.95); border: 1px solid #2e4468; border-radius: 12px;
  padding: 26px 30px; width: 460px; max-width: 92vw; max-height: 90vh; overflow-y: auto;
  animation: menu-card-in 0.45s ease-out;
}
.menu-title { font-size: 26px; font-weight: 800; letter-spacing: 1px; margin: 0 0 2px; }
.menu-sub { font-size: 12px; color: #7e93b2; margin: 0 0 16px; }
.menu-showcase-canvas { position: absolute; inset: 0; display: block; }
/* Gold marks the one primary action on a screen. Scoped, because .primary
   on its own is the plain blue below; both hosts have to be named or the
   full-page screens (ui/page.ts) silently fall back to it, which is exactly
   what happened when the home screen stopped being a menu card. */
.menu .menu-btn.primary, .pg .menu-btn.primary {
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  border-color: #f0deae; color: #241a08; font-weight: 800; letter-spacing: 0.5px;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25);
}
.menu .menu-btn.primary:hover:not(:disabled), .pg .menu-btn.primary:hover:not(:disabled) {
  box-shadow: 0 0 18px rgba(216, 180, 90, 0.45); border-color: #fff2c8;
}
.menu-label { font-size: 11px; color: #7e93b2; margin: 10px 0 4px; }
.menu-input {
  width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid #2e4468;
  background: #0b1220; color: #c9d9ee; font-size: 14px; outline: none;
}
.menu-input:focus { border-color: #5b84c9; }
.menu-btn {
  display: block; width: 100%; margin-top: 8px; padding: 10px; border-radius: 6px;
  border: 1px solid #2e4468; background: #142038; color: #c9d9ee;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}
.menu-btn:hover { border-color: #5b84c9; }
.menu-btn:hover:not(:disabled) { transform: translateY(-1px); }
.menu-btn.primary { background: #1d3a63; border-color: #3d6ba0; }
.menu-btn:disabled { opacity: 0.4; cursor: default; }
/* The row carries the vertical rhythm itself and strips the button's own
   top margin: inside a stretched flex row that margin made the input box
   taller than its button and shoved it up into the control above (the
   overlapping boxes on the play-with-friends card). */
.menu-row { display: flex; gap: 8px; margin-top: 8px; }
.menu-row > * { flex: 1; }
.menu-row > .menu-btn { margin-top: 0; }
.menu-status { font-size: 13px; color: #aac2dd; margin-top: 12px; min-height: 18px; }
.menu-code { font-size: 30px; font-weight: 800; letter-spacing: 6px; text-align: center; margin: 8px 0; }
.menu-players { font-size: 13px; margin: 6px 0 10px; color: #aac2dd; }
.menu-card.select { width: min(1780px, 97vw); max-height: 96vh; }
.menu-select-layout { display: flex; gap: 22px; align-items: flex-start; }
.menu-select-main { flex: 1; min-width: 0; }
.menu-select-side { width: 300px; flex: none; }
.menu-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 6px 0 4px; }
.menu-champ {
  padding: 0; border-radius: 10px; border: 1px solid #28405e; background: #0f1930;
  color: #c9d9ee; font-size: 12px; text-align: left; cursor: pointer;
  position: relative; aspect-ratio: 3 / 4; overflow: hidden; display: block;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}
.menu-champ:hover {
  border-color: #5b84c9; transform: translateY(-3px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
}
.menu-champ.picked {
  border-color: #6aa8e8;
  box-shadow: 0 0 0 2px rgba(106, 168, 232, 0.45), 0 10px 24px rgba(0, 0, 0, 0.5);
}
.menu-champ-portrait {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  background: radial-gradient(circle at 50% 38%, #1d3a63 0%, #0a1120 90%);
}
/* Forged champions have no art pipeline yet: a monogram stands where the
   portrait chain would. */
.menu-champ-monogram {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding-bottom: 26px; font-size: 46px; font-weight: 800; letter-spacing: 1px;
  background: radial-gradient(circle at 50% 38%, #3a2d63 0%, #0a1120 90%);
  color: #b9a8e8; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
}
.menu-champ-body {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 30px 10px 9px; min-width: 0;
  background: linear-gradient(180deg, rgba(3, 6, 14, 0) 0%, rgba(3, 6, 14, 0.92) 62%);
}
.menu-champ-name { font-weight: 800; font-size: 15px; letter-spacing: 0.3px; }
.menu-champ-role { font-size: 10px; font-weight: 700; margin-top: 2px; }
.menu-champ-blurb {
  font-size: 10px; color: #7e93b2; margin-top: 2px; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
@media (max-width: 1100px) {
  /* Column direction turns align-items horizontal: without stretch the main
     column collapses to the grid's min-content and the champion cards
     become unreadable slivers on a phone. */
  .menu-select-layout { flex-direction: column; align-items: stretch; }
  .menu-select-side { width: 100%; }
  .menu-grid { grid-template-columns: repeat(3, 1fr); }
}
.menu-sigils { display: flex; gap: 6px; margin: 6px 0; }
.menu-sigil {
  flex: 1; padding: 7px 4px; border-radius: 6px; border: 1px solid #55482a; background: #16141f;
  color: #d8c9a0; font-size: 11px; text-align: center; cursor: pointer;
}
.menu-sigil.picked { border-color: #d8b45a; background: #3d3312; }
.menu-skins { display: flex; gap: 6px; margin: 6px 0; flex-wrap: wrap; }
.menu-skin {
  padding: 6px 10px 6px 26px; border-radius: 6px; border: 1px solid #28405e;
  background: #0f1930; color: #c9d9ee; font-size: 11px; cursor: pointer;
  position: relative;
}
.menu-skin.picked { border-color: #6aa8e8; background: #1d3a63; }
.menu-skin-swatch {
  position: absolute; left: 7px; top: 50%; transform: translateY(-50%);
  width: 13px; height: 13px; border-radius: 3px; border: 1px solid #0008;
}
.menu-teams { display: flex; gap: 14px; font-size: 12px; margin-bottom: 6px; }
.menu-team { flex: 1; }
.menu-team h4 { margin: 0 0 3px; font-size: 12px; }
.menu-team.blue h4 { color: #9dbcf5; }
.menu-team.red h4 { color: #f5a3a3; }
`;

let cssInstalled = false;
// Exported because the landing page and the sign-in form use .menu-btn and
// .menu-input without ever opening a menu card: without this they render
// as bare browser controls, which is exactly the bug it was written for.
export function ensureMenuCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// backdrop: every pre-game screen gets the animated canvas behind its card.
// Exported so the sign-in screen (ui/auth.ts) is the same card as the rest
// of the pre-game flow rather than a second look bolted in front of it.
export function screen(
  container: HTMLElement,
  backdrop = true,
): { root: HTMLElement; card: HTMLElement } {
  ensureMenuCss();
  const root = document.createElement('div');
  root.className = 'menu';
  if (backdrop) startMenuBackdrop(root);
  const card = document.createElement('div');
  card.className = 'menu-card';
  root.appendChild(card);
  container.appendChild(root);
  return { root, card };
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface QueueController {
  setStatus(count: number, needed: number, startsIn: number | null, ready: boolean): void;
  remove(): void;
}

export function showQueue(
  container: HTMLElement,
  onStartNow: () => void,
  onCancel: () => void,
): QueueController {
  const { root, card } = screen(container);
  card.append(el('h1', 'menu-title', 'In queue'));
  const status = el('div', 'menu-status', 'Waiting for players...');
  const startNow = el('button', 'menu-btn primary', 'Start now with bots') as HTMLButtonElement;
  startNow.addEventListener('click', () => {
    // Inside the click gesture, so the match opens already fullscreen.
    requestGameFullscreen();
    onStartNow();
  });
  const cancel = el('button', 'menu-btn', 'Cancel');
  cancel.addEventListener('click', () => {
    root.remove();
    onCancel();
  });
  card.append(status, startNow, cancel);
  return {
    setStatus(count, needed, startsIn, ready) {
      let line = `${count} / ${needed} in queue.`;
      if (startsIn !== null) {
        line += ready
          ? ` Starting with bots in ${startsIn}s; others can still join.`
          : ` A bot-filled match starts in ${startsIn}s. Join it, or keep waiting for humans.`;
      }
      status.textContent = line;
      startNow.textContent =
        startsIn !== null && !ready ? `Join the bot match (${startsIn}s)` : 'Start now with bots';
      startNow.disabled = ready;
    },
    remove() {
      root.remove();
    },
  };
}

export interface LobbyController {
  update(code: string, host: boolean, selfTeam: TeamId, players: readonly LobbyPlayer[]): void;
  remove(): void;
}

export function showLobby(
  container: HTMLElement,
  onStart: () => void,
  onLeave: () => void,
  onPickTeam: (team: TeamId) => void,
  onQueueParty: () => void,
): LobbyController {
  const { root, card } = screen(container);
  card.append(el('h1', 'menu-title', 'Private lobby'));
  const codeEl = el('div', 'menu-code', '-----');

  // The invite link: one click to share, one click for the friend to land
  // here (src/main.ts consumes ?join=CODE at boot).
  let link = '';
  const copy = el('button', 'menu-btn', 'Copy invite link');
  copy.addEventListener('click', () => {
    if (!link) return;
    void navigator.clipboard?.writeText(link).then(() => {
      copy.textContent = 'Link copied!';
      window.setTimeout(() => {
        copy.textContent = 'Copy invite link';
      }, 1600);
    });
  });

  // Two team columns with a switch button each: friends duo on one side
  // against the bot fill, or split into two human sides.
  const teamsWrap = el('div', 'menu-teams');
  const cols = ([0, 1] as const).map((team) => {
    const box = el('div', `menu-team ${team === 0 ? 'blue' : 'red'}`);
    box.appendChild(el('h4', '', `Team ${team + 1}`));
    const list = el('div', '');
    const btn = el('button', 'menu-btn', 'Play on this side');
    btn.addEventListener('click', () => onPickTeam(team));
    box.append(list, btn);
    teamsWrap.appendChild(box);
    return { list, btn };
  });

  const start = el('button', 'menu-btn primary', 'Start match');
  start.style.display = 'none';
  start.addEventListener('click', () => {
    // Inside the click gesture, so the match opens already fullscreen.
    requestGameFullscreen();
    onStart();
  });
  // Host only, parties of up to five: the whole lobby queues publicly
  // on ONE side (the two-column split above is for private matches).
  const party = el('button', 'menu-btn', 'Queue as a party') as HTMLButtonElement;
  party.style.display = 'none';
  party.addEventListener('click', onQueueParty);
  const leave = el('button', 'menu-btn', 'Leave');
  leave.addEventListener('click', () => {
    root.remove();
    onLeave();
  });
  card.append(
    el('div', 'menu-label', 'Share this code'),
    codeEl,
    copy,
    teamsWrap,
    start,
    party,
    leave,
  );
  return {
    update(code, host, selfTeam, players) {
      codeEl.textContent = code;
      link = inviteUrl(window.location.origin, code);
      for (const team of [0, 1] as const) {
        const col = cols[team]!;
        const members = players.filter((p) => p.team === team);
        col.list.textContent =
          members.length > 0 ? members.map((p) => p.name).join(', ') : 'Empty (bots fill in)';
        // Your own side needs no button; a full side takes nobody else.
        col.btn.style.display = selfTeam === team ? 'none' : 'block';
        col.btn.disabled = members.length >= 5;
      }
      start.style.display = host ? 'block' : 'none';
      party.style.display = host ? 'block' : 'none';
      party.disabled = players.length > 5;
    },
    remove() {
      root.remove();
    },
  };
}

export interface SelectController {
  setLocked(locked: number, total: number, taken?: readonly string[]): void;
  remove(): void;
}

// One community card at Forge-queue select: another creator's shared
// champion (the gallery's playable listing), liked ones pinned first.
export interface CommunityPick {
  def: ForgedChampionDef;
  creator: string;
  likes: number;
  likedByMe: boolean;
}

export function showSelect(
  container: HTMLElement,
  roster: SelectPlayer[] | null,
  team: TeamId,
  deadline: number | null,
  onLock: (championId: string, sigils: [string, string], skin: number) => void,
  // Forge queue: the account's finalized forged champions, offered in
  // their own section under the roster grid.
  forged?: readonly ForgedChampionDef[],
  // Forge queue: the community tab, every shared champion popular first.
  community?: readonly CommunityPick[],
): SelectController {
  const { root, card } = screen(container);
  card.classList.add('select');
  card.append(el('h1', 'menu-title', 'Champion select'));

  let teamsBox: HTMLElement | null = null;
  if (roster) {
    const teams = el('div', 'menu-teams');
    for (const t of [0, 1] as const) {
      const box = el('div', `menu-team ${t === 0 ? 'blue' : 'red'}`);
      box.appendChild(el('h4', '', t === team ? `Team ${t + 1} (you)` : `Team ${t + 1}`));
      box.appendChild(
        el(
          'div',
          '',
          roster
            .filter((p) => p.team === t)
            .map((p) => p.name)
            .join(', ') || '-',
        ),
      );
      teams.appendChild(box);
    }
    teamsBox = teams;
  }

  let championId: string | null = null;
  let skinIndex = 0;
  let takenSet = new Set<string>();
  const sigils: string[] = ['riftstep', 'mend'];

  // Skin picker: cosmetic variants of the picked champion (CONTEXT.md).
  const teamCss = team === 0 ? '#4a7dd6' : '#d65c5c';
  const skinRow = el('div', 'menu-skins');
  const renderSkins = (): void => {
    skinRow.textContent = '';
    const list = championId ? (SKINS[championId] ?? []) : [];
    for (const [i, s] of list.entries()) {
      const btn = el('button', 'menu-skin', s.name) as HTMLButtonElement;
      btn.classList.toggle('picked', i === skinIndex);
      const swatch = el('span', 'menu-skin-swatch');
      const body = s.body === null ? teamCss : `#${s.body.toString(16).padStart(6, '0')}`;
      const accent = `#${s.accent.toString(16).padStart(6, '0')}`;
      swatch.style.background = `linear-gradient(135deg, ${body} 55%, ${accent} 55%)`;
      btn.appendChild(swatch);
      btn.addEventListener('click', () => {
        skinIndex = i;
        renderSkins();
      });
      skinRow.appendChild(btn);
    }
  };

  const grid = el('div', 'menu-grid');
  const champButtons = new Map<string, HTMLButtonElement>();
  const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
  for (const c of CHAMPION_LIST) {
    const btn = el('button', 'menu-champ') as HTMLButtonElement;
    const portrait = document.createElement('img');
    portrait.className = 'menu-champ-portrait';
    setPortrait(portrait, c.id, team === 0 ? 0x4a7dd6 : 0xd65c5c);
    portrait.alt = '';
    btn.appendChild(portrait);
    const body = el('div', 'menu-champ-body');
    body.appendChild(el('div', 'menu-champ-name', c.name));
    const role = el('div', 'menu-champ-role', c.role);
    role.style.color = ROLE_COLORS[c.role] ?? '#c9d8ae';
    body.appendChild(role);
    body.appendChild(el('div', 'menu-champ-blurb', c.blurb));
    btn.appendChild(body);
    attachTooltip(btn, () => [
      `${c.name} (${c.role})`,
      c.blurb,
      `Passive, ${c.passive.name}: ${c.passive.description}`,
      ...ABILITY_KEYS.map((k) => describeAbility(k, c.abilities[k]).slice(0, 3).join(' ')),
    ]);
    btn.addEventListener('click', () => {
      if (takenSet.has(c.id)) return;
      championId = c.id;
      skinIndex = 0;
      renderSkins();
      for (const [id, b] of champButtons) b.classList.toggle('picked', id === c.id);
      lock.disabled = false;
    });
    champButtons.set(c.id, btn);
    grid.appendChild(btn);
  }

  const sigilRow = el('div', 'menu-sigils');
  const sigilButtons = new Map<string, HTMLButtonElement>();
  const syncSigils = (): void => {
    for (const [id, b] of sigilButtons) b.classList.toggle('picked', sigils.includes(id));
  };
  for (const s of SIGIL_LIST) {
    const btn = el('button', 'menu-sigil', s.name) as HTMLButtonElement;
    attachTooltip(btn, () => describeSigil(s));
    btn.addEventListener('click', () => {
      const idx = sigils.indexOf(s.id);
      if (idx !== -1) sigils.splice(idx, 1);
      else {
        sigils.push(s.id);
        if (sigils.length > 2) sigils.shift();
      }
      syncSigils();
    });
    sigilButtons.set(s.id, btn);
    sigilRow.appendChild(btn);
  }
  syncSigils();

  const status = el('div', 'menu-status', '');
  const lock = el('button', 'menu-btn primary', 'Lock in') as HTMLButtonElement;
  lock.disabled = true;
  lock.addEventListener('click', () => {
    if (!championId || sigils.length !== 2) return;
    lock.disabled = true;
    lock.textContent = 'Locked';
    onLock(championId, [sigils[0]!, sigils[1]!], skinIndex);
  });

  // Forge queue: forged cards (own and community) share one builder wired
  // into the same pick, taken, and lock machinery as the roster cards.
  const forgedCard = (def: ForgedChampionDef, meta: string): HTMLButtonElement => {
    const btn = el('button', 'menu-champ') as HTMLButtonElement;
    btn.appendChild(el('div', 'menu-champ-monogram', (def.name[0] ?? '?').toUpperCase()));
    const body = el('div', 'menu-champ-body');
    body.appendChild(el('div', 'menu-champ-name', def.name));
    const role = el('div', 'menu-champ-role', meta);
    role.style.color = ROLE_COLORS[def.role] ?? '#c9d8ae';
    body.appendChild(role);
    body.appendChild(el('div', 'menu-champ-blurb', def.tagline));
    btn.appendChild(body);
    const resolved = resolveForgedChampion(def);
    attachTooltip(btn, () => [
      `${def.name}, ${def.title} (${def.role})`,
      def.tagline,
      `Passive, ${resolved.passive.name}: ${resolved.passive.description}`,
      ...ABILITY_KEYS.map((k) => describeAbility(k, resolved.abilities[k]).slice(0, 3).join(' ')),
    ]);
    btn.addEventListener('click', () => {
      if (takenSet.has(def.id)) return;
      championId = def.id;
      skinIndex = 0;
      renderSkins();
      for (const [id, b] of champButtons) b.classList.toggle('picked', id === def.id);
      lock.disabled = false;
    });
    champButtons.set(def.id, btn);
    return btn;
  };

  let forgedBlock: HTMLElement[] = [];
  if (forged && forged.length > 0) {
    const forgedGrid = el('div', 'menu-grid');
    for (const def of forged) forgedGrid.appendChild(forgedCard(def, def.role));
    forgedBlock = [el('div', 'menu-label', 'Your forged champions'), forgedGrid];
  }

  // The community tab (plan-forge phase 7): every shared champion, popular
  // first (the server's order), your liked ones pinned in front, and a
  // search over names and creators.
  let communityBlock: HTMLElement[] = [];
  if (community && community.length > 0) {
    const communityGrid = el('div', 'menu-grid');
    const searchBox = el('input', 'menu-input') as HTMLInputElement;
    searchBox.placeholder = 'Search shared champions or creators';
    const renderCommunity = (): void => {
      communityGrid.textContent = '';
      const needle = searchBox.value.trim().toLowerCase();
      const list = community
        .filter(
          (c) =>
            needle === '' ||
            c.def.name.toLowerCase().includes(needle) ||
            c.creator.toLowerCase().includes(needle),
        )
        // Stable, so the server's popular order holds within each half.
        .sort((a, b) => Number(b.likedByMe) - Number(a.likedByMe));
      for (const c of list) {
        communityGrid.appendChild(
          forgedCard(c.def, `${c.def.role}, by ${c.creator} (${c.likes} likes)`),
        );
      }
    };
    searchBox.addEventListener('input', renderCommunity);
    renderCommunity();
    communityBlock = [
      el('div', 'menu-label', 'Community champions (popular first, your liked ones pinned)'),
      searchBox,
      communityGrid,
    ];
  }

  const randomBtn = el('button', 'menu-btn', 'Random champion');
  randomBtn.addEventListener('click', () => {
    const free = CHAMPION_LIST.filter((c) => !takenSet.has(c.id));
    const pick = free[Math.floor(Math.random() * free.length)];
    if (pick) champButtons.get(pick.id)?.click();
  });

  // Full-width layout: the champion cards own the screen; team rosters,
  // skins, sigils, and the lock live in a side rail.
  const layout = el('div', 'menu-select-layout');
  const main = el('div', 'menu-select-main');
  const side = el('div', 'menu-select-side');
  main.append(el('div', 'menu-label', 'Pick your champion (hover for the kit)'), grid);
  main.append(...forgedBlock, ...communityBlock, randomBtn);
  if (teamsBox) side.appendChild(teamsBox);
  side.append(
    el('div', 'menu-label', 'Skin (cosmetic only)'),
    skinRow,
    el('div', 'menu-label', 'Pick two sigils (first goes on D, second on F)'),
    sigilRow,
    lock,
    status,
  );
  layout.append(main, side);
  card.appendChild(layout);

  let timer: number | null = null;
  if (deadline !== null) {
    const update = (): void => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      status.textContent = `${status.dataset.locked ?? ''} Auto-lock in ${left}s`;
    };
    update();
    timer = window.setInterval(update, 500);
  }

  return {
    setLocked(locked, total, taken) {
      status.dataset.locked = `${locked}/${total} locked.`;
      if (deadline === null) status.textContent = `${locked}/${total} locked.`;
      if (taken) {
        takenSet = new Set(taken.filter((id) => id !== championId));
        for (const [id, b] of champButtons) {
          const isTaken = takenSet.has(id);
          b.style.opacity = isTaken ? '0.35' : '';
          b.style.pointerEvents = isTaken ? 'none' : '';
        }
      }
    },
    remove() {
      if (timer !== null) window.clearInterval(timer);
      hideTooltip();
      root.remove();
    },
  };
}

// Resolves when the player dismisses the notice; the caller decides what
// "back to menu" means (no reload: the app routes on the same page now).
export function showNotice(container: HTMLElement, title: string, body: string): Promise<void> {
  return new Promise((resolve) => {
    const { root, card } = screen(container);
    card.append(el('h1', 'menu-title', title), el('p', 'menu-sub', body));
    const back = el('button', 'menu-btn primary', 'Back to menu');
    back.addEventListener('click', () => {
      root.remove();
      resolve();
    });
    card.appendChild(back);
  });
}
