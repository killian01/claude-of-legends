// Pre-game screens: home (name + mode), queue, private lobby, and champion
// select. Pure DOM, callback-driven; the entry point owns the flow.

import { inviteUrl } from '../game/invite';
import type { LobbyPlayer, SelectPlayer } from '../net/protocol';
import { cinematicPortraitUrl } from '../render/champions';
import { championPortraitUrl } from '../render/portraits';
import { CHAMPION_LIST, type ChampionRole } from '../sim/content/champions';
import { SIGIL_LIST } from '../sim/content/sigils';
import { SKINS } from '../sim/content/skins';
import type { AbilityKey, TeamId } from '../sim/types';
import { describeAbility, describeSigil } from './describe';
import { startHomeShowcase } from './home_showcase';
import { buildLadderPanel } from './ladder_panel';
import { buildProfilePanel } from './profile_panel';
import { buildSettingsPanel } from './settings_panel';
import { attachTooltip, hideTooltip } from './tooltips';

// One color per role so classes read at a glance on the select grid.
const ROLE_COLORS: Readonly<Record<ChampionRole, string>> = {
  Tank: '#8fb3d9',
  Fighter: '#d9925a',
  Mage: '#a67ee8',
  Battlemage: '#c96fc0',
  Assassin: '#e86a6a',
  Marksman: '#e8c862',
  Support: '#6fd9a8',
  Skirmisher: '#d9d15a',
};

// Champion art resolution chain, best first: a hand-authored illustration in
// public/portraits/ (see docs/design/portrait-prompts.md), then the
// cinematic 3D render, and the instant procedural figure while both load.
function setPortrait(img: HTMLImageElement, championId: string, teamColor: number): void {
  img.src = championPortraitUrl(championId, 0, teamColor);
  const illustration = `/portraits/${championId}.png`;
  const probe = new Image();
  probe.onload = () => {
    img.src = illustration;
  };
  probe.onerror = () => {
    void cinematicPortraitUrl(championId, 0, teamColor).then((url) => {
      if (url) img.src = url;
    });
  };
  probe.src = illustration;
}

const CSS = `
.menu, .menu * { box-sizing: border-box; }
.menu {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, #22371a 0%, #101a0a 75%);
  font-family: system-ui, sans-serif; color: #d8e6c0; z-index: 10;
}
.menu-card {
  background: rgba(14, 20, 9, 0.95); border: 1px solid #466030; border-radius: 12px;
  padding: 26px 30px; width: 460px; max-width: 92vw; max-height: 90vh; overflow-y: auto;
}
.menu-title { font-size: 26px; font-weight: 800; letter-spacing: 1px; margin: 0 0 2px; }
.menu-sub { font-size: 12px; color: #93a87c; margin: 0 0 16px; }
.menu.home { justify-content: flex-start; padding-left: clamp(24px, 7vw, 140px); }
.menu-showcase-canvas { position: absolute; inset: 0; display: block; }
.menu.home::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at 62% 45%, transparent 40%, rgba(5, 9, 3, 0.65) 100%);
}
.menu-card.home {
  position: relative; z-index: 1; width: 440px;
  background: rgba(10, 15, 7, 0.84); backdrop-filter: blur(6px);
  border: 1px solid #6b5a2e; box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
}
.menu-card.home .menu-title {
  font-family: Cinzel, Georgia, 'Times New Roman', serif;
  font-size: 38px; line-height: 1.1; letter-spacing: 3px; text-transform: uppercase;
  background: linear-gradient(180deg, #f7e7b0 0%, #d8b45a 55%, #a07830 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
}
.menu-card.home .menu-sub { letter-spacing: 0.5px; margin-bottom: 20px; }
.menu .menu-btn.primary {
  background: linear-gradient(180deg, #e8cc74 0%, #c9a84a 55%, #a07830 100%);
  border-color: #f0deae; color: #241a08; font-weight: 800; letter-spacing: 0.5px;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25);
}
.menu .menu-btn.primary:hover:not(:disabled) {
  box-shadow: 0 0 18px rgba(216, 180, 90, 0.45); border-color: #fff2c8;
}
.menu-label { font-size: 11px; color: #93a87c; margin: 10px 0 4px; }
.menu-input {
  width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid #466030;
  background: #10160c; color: #d8e6c0; font-size: 14px; outline: none;
}
.menu-input:focus { border-color: #7ca050; }
.menu-btn {
  display: block; width: 100%; margin-top: 8px; padding: 10px; border-radius: 6px;
  border: 1px solid #466030; background: #1d2a14; color: #d8e6c0;
  font-size: 14px; font-weight: 600; cursor: pointer;
}
.menu-btn:hover { border-color: #7ca050; }
.menu-btn.primary { background: #2c4a1c; border-color: #5d8038; }
.menu-btn:disabled { opacity: 0.4; cursor: default; }
.menu-row { display: flex; gap: 8px; }
.menu-row > * { flex: 1; }
.menu-status { font-size: 13px; color: #c9d8ae; margin-top: 12px; min-height: 18px; }
.menu-code { font-size: 30px; font-weight: 800; letter-spacing: 6px; text-align: center; margin: 8px 0; }
.menu-players { font-size: 13px; margin: 6px 0 10px; color: #c9d8ae; }
.menu-card.select { width: min(1500px, 96vw); max-height: 94vh; }
.menu-select-layout { display: flex; gap: 22px; align-items: flex-start; }
.menu-select-main { flex: 1; min-width: 0; }
.menu-select-side { width: 300px; flex: none; }
.menu-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 6px 0 4px; }
.menu-champ {
  padding: 0; border-radius: 10px; border: 1px solid #3a4f28; background: #17210f;
  color: #d8e6c0; font-size: 12px; text-align: left; cursor: pointer;
  position: relative; aspect-ratio: 3 / 4; overflow: hidden; display: block;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
}
.menu-champ:hover {
  border-color: #7ca050; transform: translateY(-3px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
}
.menu-champ.picked {
  border-color: #a3c96a;
  box-shadow: 0 0 0 2px rgba(163, 201, 106, 0.45), 0 10px 24px rgba(0, 0, 0, 0.5);
}
.menu-champ-portrait {
  position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
  background: radial-gradient(circle at 50% 38%, #2c4a1c 0%, #101a09 90%);
}
.menu-champ-body {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 30px 10px 9px; min-width: 0;
  background: linear-gradient(180deg, rgba(4, 8, 2, 0) 0%, rgba(4, 8, 2, 0.92) 62%);
}
.menu-champ-name { font-weight: 800; font-size: 15px; letter-spacing: 0.3px; }
.menu-champ-role { font-size: 10px; font-weight: 700; margin-top: 2px; }
.menu-champ-blurb {
  font-size: 10px; color: #93a87c; margin-top: 2px; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
@media (max-width: 1100px) {
  .menu-select-layout { flex-direction: column; }
  .menu-select-side { width: 100%; }
  .menu-grid { grid-template-columns: repeat(3, 1fr); }
}
.menu-sigils { display: flex; gap: 6px; margin: 6px 0; }
.menu-sigil {
  flex: 1; padding: 7px 4px; border-radius: 6px; border: 1px solid #4d451f; background: #1c190d;
  color: #d8c9a0; font-size: 11px; text-align: center; cursor: pointer;
}
.menu-sigil.picked { border-color: #d8b45a; background: #3d3312; }
.menu-skins { display: flex; gap: 6px; margin: 6px 0; flex-wrap: wrap; }
.menu-skin {
  padding: 6px 10px 6px 26px; border-radius: 6px; border: 1px solid #3a4f28;
  background: #17210f; color: #d8e6c0; font-size: 11px; cursor: pointer;
  position: relative;
}
.menu-skin.picked { border-color: #a3c96a; background: #2c4a1c; }
.menu-skin-swatch {
  position: absolute; left: 7px; top: 50%; transform: translateY(-50%);
  width: 13px; height: 13px; border-radius: 3px; border: 1px solid #0008;
}
.menu-roster { margin-top: 10px; }
.menu-roster-champ {
  padding: 9px 10px; border-radius: 6px; border: 1px solid #3a4f28; background: #17210f;
  margin-bottom: 6px; font-size: 12px; line-height: 1.45;
  display: flex; gap: 10px; align-items: flex-start;
}
.menu-roster-portrait {
  width: 56px; height: 56px; border-radius: 6px; flex: none;
  background: radial-gradient(circle at 40% 35%, #2c4a1c 0%, #101a09 90%);
  border: 1px solid #2c3d1e;
}
.menu-roster-body { min-width: 0; }
.menu-roster-name { font-weight: 700; font-size: 13px; }
.menu-roster-role { font-size: 11px; font-weight: 700; margin-left: 6px; }
.menu-roster-blurb { color: #93a87c; margin: 2px 0 4px; }
.menu-roster-line { color: #c9d8ae; font-size: 11px; }
.menu-roster-line b { color: #e8dfae; font-weight: 700; }
.menu-teams { display: flex; gap: 14px; font-size: 12px; margin-bottom: 6px; }
.menu-team { flex: 1; }
.menu-team h4 { margin: 0 0 3px; font-size: 12px; }
.menu-team.blue h4 { color: #9dbcf5; }
.menu-team.red h4 { color: #f5a3a3; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

function screen(container: HTMLElement): { root: HTMLElement; card: HTMLElement } {
  ensureCss();
  const root = document.createElement('div');
  root.className = 'menu';
  const card = document.createElement('div');
  card.className = 'menu-card';
  root.appendChild(card);
  container.appendChild(root);
  return { root, card };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface HomeChoice {
  name: string;
  mode: 'practice' | 'queue' | 'create' | 'join';
  code?: string;
}

// prefillCode: an invite link's lobby code (?join=CODE) when the visitor
// has no stored name yet; the join field arrives filled, one click left.
export function showHome(container: HTMLElement, prefillCode?: string): Promise<HomeChoice> {
  return new Promise((resolve) => {
    const { root, card } = screen(container);
    root.classList.add('home');
    card.classList.add('home');
    // The living backdrop: champions idling behind the card.
    const stopShowcase = startHomeShowcase(root);
    card.append(
      el('h1', 'menu-title', 'Claude of Legends'),
      el('p', 'menu-sub', '5v5 in the browser. No account, no install.'),
      el('div', 'menu-label', 'Your name'),
    );
    const name = el('input', 'menu-input') as HTMLInputElement;
    name.maxLength = 24;
    try {
      name.value = localStorage.getItem('loc-name') ?? '';
    } catch {
      // storage may be unavailable
    }
    card.appendChild(name);

    const done = (mode: HomeChoice['mode'], code?: string): void => {
      const trimmed = name.value.trim() || 'guest';
      try {
        localStorage.setItem('loc-name', trimmed);
      } catch {
        // ignore
      }
      stopShowcase();
      root.remove();
      resolve({ name: trimmed, mode, code });
    };

    const play = el('button', 'menu-btn primary', 'Play online');
    play.addEventListener('click', () => done('queue'));
    const practice = el('button', 'menu-btn', 'Practice vs dummies (offline)');
    practice.addEventListener('click', () => done('practice'));
    const create = el('button', 'menu-btn', 'Create private lobby');
    create.addEventListener('click', () => done('create'));

    const row = el('div', 'menu-row');
    const code = el('input', 'menu-input') as HTMLInputElement;
    code.placeholder = 'CODE';
    code.maxLength = 5;
    const join = el('button', 'menu-btn', 'Join lobby');
    if (prefillCode) {
      code.value = prefillCode;
      join.classList.add('primary');
      name.focus();
    }
    join.addEventListener('click', () => {
      if (code.value.trim().length === 5) done('join', code.value.trim().toUpperCase());
    });
    row.append(code, join);

    card.append(play, practice, create, el('div', 'menu-label', 'Play with friends'), row);

    // Options: audio settings, collapsible like the roster browser.
    const settingsBtn = el('button', 'menu-btn', 'Settings');
    const settingsBox = el('div', '');
    settingsBox.style.display = 'none';
    let settingsBuilt = false;
    settingsBtn.addEventListener('click', () => {
      const open = settingsBox.style.display === 'none';
      settingsBox.style.display = open ? 'block' : 'none';
      if (!settingsBuilt) {
        settingsBuilt = true;
        settingsBox.appendChild(buildSettingsPanel());
      }
    });
    card.append(el('div', 'menu-label', 'Options'), settingsBtn, settingsBox);

    // Career and ladder: rebuilt fresh on every open so they never stale.
    const freshSection = (label: string, build: () => HTMLElement): void => {
      const btn = el('button', 'menu-btn', label);
      const boxEl = el('div', '');
      boxEl.style.display = 'none';
      btn.addEventListener('click', () => {
        const open = boxEl.style.display === 'none';
        boxEl.style.display = open ? 'block' : 'none';
        if (open) {
          boxEl.textContent = '';
          boxEl.appendChild(build());
        }
      });
      card.append(btn, boxEl);
    };
    card.append(el('div', 'menu-label', 'Career and ladder'));
    freshSection('Profile and history', buildProfilePanel);
    freshSection('Ladder', buildLadderPanel);

    // The out-of-game roster browser: every champion with role, passive,
    // and kit, readable before ever entering a queue.
    const rosterBtn = el('button', 'menu-btn', 'Browse the champions');
    const roster = el('div', 'menu-roster');
    roster.style.display = 'none';
    let rosterBuilt = false;
    rosterBtn.addEventListener('click', () => {
      const open = roster.style.display === 'none';
      roster.style.display = open ? 'block' : 'none';
      rosterBtn.textContent = open ? 'Hide the champions' : 'Browse the champions';
      if (!rosterBuilt) {
        rosterBuilt = true;
        const keys: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
        for (const c of CHAMPION_LIST) {
          const box = el('div', 'menu-roster-champ');
          const portrait = document.createElement('img');
          portrait.className = 'menu-roster-portrait';
          setPortrait(portrait, c.id, 0x4a7dd6);
          portrait.alt = '';
          box.appendChild(portrait);
          const body = el('div', 'menu-roster-body');
          const head = el('div', '');
          head.appendChild(el('span', 'menu-roster-name', c.name));
          const role = el('span', 'menu-roster-role', c.role);
          role.style.color = ROLE_COLORS[c.role] ?? '#c9d8ae';
          head.appendChild(role);
          body.appendChild(head);
          body.appendChild(el('div', 'menu-roster-blurb', c.blurb));
          const passive = el('div', 'menu-roster-line');
          passive.innerHTML = `<b>Passive, ${c.passive.name}:</b> ${c.passive.description}`;
          body.appendChild(passive);
          for (const k of keys) {
            const lines = describeAbility(k, c.abilities[k]);
            const line = el('div', 'menu-roster-line');
            line.innerHTML = `<b>${lines[0] ?? ''}</b> ${lines.slice(2).join(' ')}`;
            body.appendChild(line);
          }
          box.appendChild(body);
          roster.appendChild(box);
        }
      }
    });
    card.append(el('div', 'menu-label', 'Learn the game'), rosterBtn, roster);
  });
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
  startNow.addEventListener('click', onStartNow);
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
  start.addEventListener('click', onStart);
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

export function showSelect(
  container: HTMLElement,
  roster: SelectPlayer[] | null,
  team: TeamId,
  deadline: number | null,
  onLock: (championId: string, sigils: [string, string], skin: number) => void,
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
  main.append(el('div', 'menu-label', 'Pick your champion (hover for the kit)'), grid, randomBtn);
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
