// Pre-game screens: home (name + mode), queue, private lobby, and champion
// select. Pure DOM, callback-driven; the entry point owns the flow.

import type { SelectPlayer } from '../net/protocol';
import { CHAMPION_LIST } from '../sim/content/champions';
import { SIGIL_LIST } from '../sim/content/sigils';
import type { AbilityKey, TeamId } from '../sim/types';
import { describeAbility, describeSigil } from './describe';
import { attachTooltip } from './tooltips';

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
.menu-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin: 6px 0 4px; }
.menu-champ {
  padding: 8px; border-radius: 6px; border: 1px solid #3a4f28; background: #17210f;
  color: #d8e6c0; font-size: 12px; text-align: left; cursor: pointer;
}
.menu-champ:hover { border-color: #7ca050; }
.menu-champ.picked { border-color: #a3c96a; background: #2c4a1c; }
.menu-sigils { display: flex; gap: 6px; margin: 6px 0; }
.menu-sigil {
  flex: 1; padding: 7px 4px; border-radius: 6px; border: 1px solid #4d451f; background: #1c190d;
  color: #d8c9a0; font-size: 11px; text-align: center; cursor: pointer;
}
.menu-sigil.picked { border-color: #d8b45a; background: #3d3312; }
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

export function showHome(container: HTMLElement): Promise<HomeChoice> {
  return new Promise((resolve) => {
    const { root, card } = screen(container);
    card.append(
      el('h1', 'menu-title', 'League of Claudegend'),
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
    join.addEventListener('click', () => {
      if (code.value.trim().length === 5) done('join', code.value.trim().toUpperCase());
    });
    row.append(code, join);

    card.append(play, practice, create, el('div', 'menu-label', 'Play with friends'), row);
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
  update(code: string, host: boolean, players: string[]): void;
  remove(): void;
}

export function showLobby(
  container: HTMLElement,
  onStart: () => void,
  onLeave: () => void,
): LobbyController {
  const { root, card } = screen(container);
  card.append(el('h1', 'menu-title', 'Private lobby'));
  const codeEl = el('div', 'menu-code', '-----');
  const players = el('div', 'menu-players', '');
  const start = el('button', 'menu-btn primary', 'Start match');
  start.style.display = 'none';
  start.addEventListener('click', onStart);
  const leave = el('button', 'menu-btn', 'Leave');
  leave.addEventListener('click', () => {
    root.remove();
    onLeave();
  });
  card.append(el('div', 'menu-label', 'Share this code'), codeEl, players, start, leave);
  return {
    update(code, host, names) {
      codeEl.textContent = code;
      players.textContent = `Players: ${names.join(', ')}`;
      start.style.display = host ? 'block' : 'none';
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
  onLock: (championId: string, sigils: [string, string]) => void,
): SelectController {
  const { root, card } = screen(container);
  card.append(el('h1', 'menu-title', 'Champion select'));

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
    card.appendChild(teams);
  }

  let championId: string | null = null;
  let takenSet = new Set<string>();
  const sigils: string[] = ['riftstep', 'mend'];

  const grid = el('div', 'menu-grid');
  const champButtons = new Map<string, HTMLButtonElement>();
  const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
  for (const c of CHAMPION_LIST) {
    const btn = el('button', 'menu-champ', c.name) as HTMLButtonElement;
    attachTooltip(btn, () => [
      c.name,
      ...ABILITY_KEYS.map((k) => describeAbility(k, c.abilities[k]).slice(0, 3).join(' ')),
    ]);
    btn.addEventListener('click', () => {
      if (takenSet.has(c.id)) return;
      championId = c.id;
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
    onLock(championId, [sigils[0]!, sigils[1]!]);
  });

  const randomBtn = el('button', 'menu-btn', 'Random champion');
  randomBtn.addEventListener('click', () => {
    const free = CHAMPION_LIST.filter((c) => !takenSet.has(c.id));
    const pick = free[Math.floor(Math.random() * free.length)];
    if (pick) champButtons.get(pick.id)?.click();
  });

  card.append(
    el('div', 'menu-label', 'Pick your champion (hover for the kit)'),
    grid,
    randomBtn,
    el('div', 'menu-label', 'Pick two sigils (first goes on D, second on F)'),
    sigilRow,
    lock,
    status,
  );

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
      root.remove();
    },
  };
}

export function showNotice(container: HTMLElement, title: string, body: string): void {
  const { card } = screen(container);
  card.append(el('h1', 'menu-title', title), el('p', 'menu-sub', body));
  const reload = el('button', 'menu-btn primary', 'Back to menu');
  reload.addEventListener('click', () => window.location.reload());
  card.appendChild(reload);
}
