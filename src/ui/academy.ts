// The Academy (docs/design/bots.md, plan-bots phase 4): where an account
// writes and tests a bot. Conversation first, the play list always visible
// and editable beside it; every bot starts as the Laner on its champion;
// local sparring plays a whole match against house bots at full speed in a
// worker and opens the replay with the active play on every plate. The
// playbook on screen is always one the engine can run: every edit and
// every coach operation goes through the validator before it lands.

import { runSparring } from '../game/sparring';
import type { SparResult } from '../game/sparring_core';
import { type CoachTurn, commentOf } from '../net/coach_chat';
import type { ReplayRecord } from '../net/replay';
import { CHAMPION_LIST, CHAMPIONS } from '../sim/content/champions';
import { SIGIL_LIST } from '../sim/content/sigils';
import {
  applyPatchOp,
  type Behavior,
  type PatchOp,
  type PlaybookDef,
  type PlayDef,
  type Trigger,
  validatePlaybook,
} from '../sim/playbook';
import { el } from './menu';
import { startMenuBackdrop } from './menu_backdrop';
import {
  BEHAVIOR_FORMS,
  BEHAVIOR_KINDS,
  describeBehavior,
  describeOp,
  describeTrigger,
  freshBehavior,
  freshTrigger,
  type KindForm,
  TRIGGER_FORMS,
  TRIGGER_KINDS,
} from './playbook_text';

const CSS = `
.ac, .ac * { box-sizing: border-box; }
.ac {
  position: absolute; inset: 0; z-index: 30; overflow: hidden;
  display: flex; flex-direction: column;
  background: radial-gradient(ellipse at center, #101c24 0%, #05090c 80%);
  font-family: system-ui, sans-serif; color: #c8d6e0; font-size: 12px;
}
.ac *::-webkit-scrollbar { width: 10px; height: 10px; }
.ac *::-webkit-scrollbar-track { background: #070d12; }
.ac *::-webkit-scrollbar-thumb { background: #1f3644; border-radius: 5px; }
.ac * { scrollbar-width: thin; scrollbar-color: #1f3644 #070d12; }
.ac-head {
  position: relative; z-index: 1; display: flex; align-items: baseline; gap: 14px;
  padding: 14px 22px 10px; border-bottom: 1px solid #1f3644;
}
.ac-title { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 1px; color: #8ed6f0; }
.ac-sub { color: #5f8299; font-size: 12px; }
.ac-back {
  margin-left: auto; padding: 6px 16px; border-radius: 6px; border: 1px solid #2c4d60;
  background: #0c161d; color: #c8d6e0; font-size: 13px; font-weight: 700; cursor: pointer;
}
.ac-back:hover { border-color: #8ed6f0; }
.ac-body { position: relative; z-index: 1; flex: 1; display: flex; gap: 14px; padding: 12px 22px; min-height: 0; }
.ac-rail { width: 230px; flex: none; overflow-y: auto; }
.ac-main { flex: 1; min-width: 0; overflow-y: auto; padding-right: 6px; }
.ac-side { width: 330px; flex: none; overflow-y: auto; display: flex; flex-direction: column; }
.ac-panel {
  background: rgba(6, 12, 16, 0.86); border: 1px solid #1f3644; border-radius: 10px;
  padding: 12px 14px; margin-bottom: 10px;
}
.ac-panel h3 { margin: 0 0 8px; font-size: 12px; color: #6cc3e0; letter-spacing: 0.6px; text-transform: uppercase; }
.ac-lead { color: #8fa6b6; font-size: 12.5px; line-height: 1.5; margin: 0 0 10px; }
.ac-status { color: #e0c070; font-size: 12px; min-height: 16px; margin: 6px 0; }
.ac-status.bad { color: #f09090; }
.ac-bot {
  display: block; width: 100%; text-align: left; margin-bottom: 6px; padding: 7px 9px;
  border-radius: 6px; border: 1px solid #1f3644; background: #0b141a; color: #c8d6e0;
  font-size: 12px; cursor: pointer;
}
.ac-bot:hover { border-color: #3d7a94; }
.ac-bot.picked { border-color: #8ed6f0; background: #122431; }
.ac-bot small { display: block; color: #5f8299; font-size: 10px; }
.ac-btn {
  display: inline-block; margin: 4px 6px 4px 0; padding: 7px 12px; border-radius: 6px;
  border: 1px solid #2c4d60; background: #0c161d; color: #d8e4ec;
  font-size: 12px; font-weight: 700; cursor: pointer;
}
.ac-btn:hover:not(:disabled) { border-color: #8ed6f0; }
.ac-btn:disabled { opacity: 0.4; cursor: default; }
.ac-btn.primary { background: linear-gradient(180deg, #8ed6f0 0%, #4fa8c8 55%, #2c7590 100%); color: #06141c; border-color: #b8e8f8; }
.ac-btn.danger { border-color: #7a3a2e; color: #e0a898; }
.ac-btn.mini { padding: 2px 7px; font-size: 11px; margin: 0 2px; }
.ac-input, .ac-select {
  padding: 6px 8px; border-radius: 6px; border: 1px solid #1f3644;
  background: #070d12; color: #d8e4ec; font-size: 12px; outline: none;
}
.ac-input:focus, .ac-select:focus { border-color: #8ed6f0; }
.ac-input.wide { width: 100%; margin-bottom: 6px; }
.ac-num { width: 76px; }
.ac-field { display: inline-flex; flex-direction: column; gap: 2px; margin: 0 8px 6px 0; font-size: 10.5px; color: #7f9cae; }
.ac-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.ac-play {
  border: 1px solid #1f3644; border-radius: 8px; background: #0b141a; padding: 6px 8px; margin-bottom: 6px;
}
.ac-play.off { opacity: 0.55; }
.ac-play-head { display: flex; align-items: center; gap: 8px; }
.ac-play-id { font-weight: 800; color: #8ed6f0; min-width: 90px; }
.ac-play-text { flex: 1; min-width: 0; color: #c8d6e0; }
.ac-play-text b { color: #e0c070; font-weight: 600; }
.ac-play-tools { flex: none; white-space: nowrap; }
.ac-editor { border-top: 1px dashed #1f3644; margin-top: 6px; padding-top: 6px; }
.ac-editor h4 { margin: 4px 0; font-size: 11px; color: #6cc3e0; text-transform: uppercase; letter-spacing: 0.5px; }
.ac-branch { border-left: 2px solid #1f3644; padding-left: 8px; margin: 4px 0; }
.ac-chatlog { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; min-height: 120px; }
.ac-bubble { padding: 7px 10px; border-radius: 10px; font-size: 12px; line-height: 1.45; max-width: 95%; white-space: pre-wrap; }
.ac-bubble.user { align-self: flex-end; background: #17303d; color: #e0ecf3; }
.ac-bubble.ai { align-self: flex-start; background: #0e1a21; border: 1px solid #1f3644; color: #c8d6e0; }
.ac-bubble small { display: block; color: #f09090; font-size: 10.5px; margin-top: 4px; }
.ac-chatrow { display: flex; gap: 6px; align-items: center; }
.ac-chatrow .ac-input { flex: 1; }
.ac-check { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #7f9cae; }
.ac-table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 6px; }
.ac-table td, .ac-table th { padding: 3px 4px; border-bottom: 1px solid #1f3644; text-align: left; }
.ac-table th { color: #6cc3e0; font-size: 10.5px; text-transform: uppercase; }
.ac-table td.num { text-align: right; }
.ac-form { display: flex; flex-direction: column; gap: 4px; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// A bot as the API returns it (server/bot_store.ts BotRow, over JSON).
interface BotView {
  id: string;
  name: string;
  championId: string;
  sigils: [string, string];
  skin: number;
  playbook: PlaybookDef;
  version: number;
  deposited: boolean;
  autoApply?: boolean;
}

// The Briefing as the API returns it (server/night_coach.ts Briefing).
interface BriefingView {
  since: number;
  matches: { at: number; win: boolean; delta: number; replayId?: number }[];
  wins: number;
  losses: number;
  ratingDelta: number;
  rating: number;
  plays: Record<string, { ticks: number; deaths: number }>;
  proposal: {
    id: number;
    comment: string;
    ops: PatchOp[];
    currentWins: number;
    candidateWins: number;
    matches: number;
  } | null;
  autoApply: boolean;
}

interface ChatBubble {
  role: 'user' | 'assistant';
  // What the model saw or wrote, replayed verbatim next turn.
  text: string;
  bubble: string;
  refused?: string[];
}

type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string };

async function api<T>(path: string, body?: unknown): Promise<Outcome<T>> {
  try {
    const res = await fetch(
      path,
      body === undefined
        ? { credentials: 'same-origin' }
        : {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    return (await res.json()) as Outcome<T>;
  } catch {
    return { ok: false, error: 'the server did not answer' };
  }
}

// One line of the coach's streamed answer.
interface CoachLine {
  progress?: 'stage' | 'text' | 'op' | 'refused';
  text?: string;
  op?: unknown;
  error?: string;
}

// The coach's request: a POST whose answer streams as NDJSON, progress
// lines first (the comment as it is written, each operation as it
// applies) and the outcome last.
async function coachStream<T>(body: unknown, onLine: (line: CoachLine) => void): Promise<T | null> {
  try {
    const res = await fetch('/api/bots/suggest', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.body) return (await res.json()) as T;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let last: T | null = null;
    const take = (line: string): void => {
      if (line.trim() === '') return;
      const parsed = JSON.parse(line) as CoachLine;
      if (parsed.progress) onLine(parsed);
      else last = parsed as unknown as T;
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let cut = pending.indexOf('\n');
      while (cut >= 0) {
        take(pending.slice(0, cut));
        pending = pending.slice(cut + 1);
        cut = pending.indexOf('\n');
      }
    }
    if (pending.trim() !== '') take(pending);
    return last;
  } catch {
    return null;
  }
}

function clamp(v: number, min: number, max: number, step: number): number {
  const c = Math.min(max, Math.max(min, v));
  return step >= 1 ? Math.round(c) : Math.round(c / step) * step;
}

function fmtSeconds(ticks: number): string {
  const s = Math.round(ticks / 20);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

// The last sparring result per bot, kept while the page lives: watching
// the replay leaves the Academy and comes back to it.
const lastSpar = new Map<string, SparResult>();

export function openAcademy(container: HTMLElement, opts: { botId?: string } = {}): void {
  ensureCss();
  const root = el('div', 'ac');
  const stopBackdrop = startMenuBackdrop(root);
  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    stopBackdrop();
    root.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);

  const head = el('div', 'ac-head');
  const back = el('button', 'ac-back', 'Back');
  back.addEventListener('click', close);
  head.append(
    el('h1', 'ac-title', 'The Academy'),
    el('span', 'ac-sub', 'Write a bot, spar it, send it to play'),
    back,
  );
  const body = el('div', 'ac-body');
  const rail = el('div', 'ac-rail');
  const main = el('div', 'ac-main');
  const side = el('div', 'ac-side');
  body.append(rail, main, side);
  root.append(head, body);
  container.appendChild(root);

  // --- state ---
  let bots: BotView[] = [];
  let current: BotView | null = null;
  // The editable copy of the current bot's playbook; saved on demand.
  let working: PlaybookDef | null = null;
  let dirty = false;
  let editingId: string | null = null;
  let status = '';
  let statusBad = false;
  let confirmDelete = false;
  let versions: { version: number; author: string; at: number }[] | null = null;
  const chat: ChatBubble[] = [];
  let chatLoading = false;
  let chatDraft = '';
  let coaching = false;
  let coachText = '';
  let coachStage = '';
  let coachRefused: string[] = [];
  let deep = false;
  let sparRunning = false;
  let sparResult: SparResult | null = null;
  let sparError: string | null = null;
  let arenaRunning = false;
  let briefing: BriefingView | null = null;
  let briefingLoading = false;
  let arenaResult: { text: string; replayId: number | null } | null = null;

  const say = (text: string, bad = false): void => {
    status = text;
    statusBad = bad;
    renderMain();
  };

  const select = (bot: BotView | null): void => {
    current = bot;
    working = bot ? structuredClone(bot.playbook) : null;
    dirty = false;
    editingId = null;
    confirmDelete = false;
    versions = null;
    chat.length = 0;
    chatDraft = '';
    coachText = '';
    coachRefused = [];
    sparResult = bot ? (lastSpar.get(bot.id) ?? null) : null;
    // The conversation lives with the bot on the server: fetched on every
    // open, so a new session starts where the last one stopped.
    chatLoading = bot !== null;
    if (bot) {
      const id = bot.id;
      void api<{ turns: CoachTurn[] }>('/api/bots/chat', { id }).then((r) => {
        if (current?.id !== id) return;
        chatLoading = false;
        if (r.ok) {
          for (const t of r.turns) {
            chat.push({
              role: t.role,
              text: t.text,
              bubble: t.role === 'user' ? t.text : commentOf(t.text),
              ...(t.refused ? { refused: t.refused } : {}),
            });
          }
        }
        renderSide();
      });
    }
    sparError = null;
    arenaResult = null;
    briefing = null;
    briefingLoading = false;
    status = '';
    renderAll();
  };

  async function load(keepId: string | null): Promise<void> {
    const r = await api<{ bots: BotView[] }>('/api/bots');
    if (!r.ok) {
      say(r.error, true);
      return;
    }
    bots = r.bots;
    const keep = keepId ? (bots.find((b) => b.id === keepId) ?? null) : null;
    select(keep ?? bots[0] ?? null);
  }

  // Every edit to the working playbook goes through here: the mutation
  // runs on a copy, the validator judges it, and only a valid result
  // replaces what is on screen.
  const edit = (mutate: (plays: PlayDef[]) => void): void => {
    if (!working) return;
    const plays = structuredClone(working.plays);
    mutate(plays);
    const v = validatePlaybook({ version: working.version, plays });
    if (!v.ok) {
      say(v.errors[0] ?? 'invalid playbook', true);
      return;
    }
    working = v.def;
    dirty = true;
    status = '';
    renderMain();
  };

  const uniqueId = (base: string): string => {
    if (!working) return base;
    const taken = new Set(working.plays.map((p) => p.id));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const id = `${base}-${i}`;
      if (!taken.has(id)) return id;
    }
  };

  // --- the rail: your bots, and a new one ---
  function renderRail(): void {
    rail.textContent = '';
    const list = el('div', 'ac-panel');
    list.append(el('h3', '', 'Your bots'));
    if (bots.length === 0) list.append(el('p', 'ac-lead', 'No bots yet. Make one below.'));
    for (const b of bots) {
      const btn = el('button', `ac-bot${current?.id === b.id ? ' picked' : ''}`);
      const champ = CHAMPIONS[b.championId];
      btn.append(
        document.createTextNode(b.name),
        el(
          'small',
          '',
          `${champ?.name.split(',')[0] ?? b.championId} · v${b.version}${b.deposited ? ' · in the Arena' : ''}`,
        ),
      );
      btn.addEventListener('click', () => {
        if (dirty && !window.confirm('Discard the unsaved changes on this bot?')) return;
        select(b);
      });
      list.append(btn);
    }
    rail.append(list);

    const form = el('div', 'ac-panel');
    form.append(el('h3', '', 'New bot'));
    form.append(
      el(
        'p',
        'ac-lead',
        'A name, a champion, two sigils. It starts as the Laner, the house playbook, and ' +
          'becomes yours from the first edit.',
      ),
    );
    const name = el('input', 'ac-input wide') as HTMLInputElement;
    name.placeholder = 'Name';
    name.maxLength = 24;
    const champ = el('select', 'ac-select wide') as HTMLSelectElement;
    for (const c of CHAMPION_LIST) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = `${c.name.split(',')[0]} (${c.role})`;
      champ.append(o);
    }
    const sigA = sigilSelect('riftstep');
    const sigB = sigilSelect('mend');
    const row = el('div', 'ac-row');
    row.append(sigA, sigB);
    const create = el('button', 'ac-btn primary', 'Create') as HTMLButtonElement;
    create.addEventListener('click', () => {
      create.disabled = true;
      void api<{ bot: BotView }>('/api/bots/create', {
        name: name.value,
        championId: champ.value,
        sigils: [sigA.value, sigB.value],
        skin: 0,
      }).then((r) => {
        create.disabled = false;
        if (!r.ok) {
          say(r.error, true);
          return;
        }
        void load(r.bot.id);
      });
    });
    form.append(name, champ, row, create);
    rail.append(form);
  }

  function sigilSelect(value: string): HTMLSelectElement {
    const s = el('select', 'ac-select') as HTMLSelectElement;
    for (const sig of SIGIL_LIST) {
      const o = document.createElement('option');
      o.value = sig.id;
      o.textContent = sig.name;
      s.append(o);
    }
    s.value = value;
    return s;
  }

  // --- the main: the bot, its plays ---
  function renderMain(): void {
    main.textContent = '';
    if (!current || !working) {
      const p = el('div', 'ac-panel');
      p.append(
        el('h3', '', 'A bot'),
        el(
          'p',
          'ac-lead',
          'A bot plays a seat instead of you: in the live queue while you coach it, or in the ' +
            'Arena while you are away. Its whole brain is the play list you see here: each ' +
            'decision, the first play from the top whose condition holds and that can act is ' +
            'the one that acts. Make a bot on the left to begin.',
        ),
      );
      main.append(p);
      return;
    }
    const bot = current;
    const def = working;

    // Identity and the save row.
    const top = el('div', 'ac-panel');
    const idRow = el('div', 'ac-row');
    const name = el('input', 'ac-input') as HTMLInputElement;
    name.value = bot.name;
    name.maxLength = 24;
    name.addEventListener('input', () => {
      bot.name = name.value;
      dirty = true;
    });
    const champ = CHAMPIONS[bot.championId];
    const sigA = sigilSelect(bot.sigils[0]);
    const sigB = sigilSelect(bot.sigils[1]);
    const onSig = (): void => {
      bot.sigils = [sigA.value, sigB.value];
      dirty = true;
    };
    sigA.addEventListener('change', onSig);
    sigB.addEventListener('change', onSig);
    const skin = el('select', 'ac-select') as HTMLSelectElement;
    for (let i = 0; i < 3; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `Skin ${i + 1}`;
      skin.append(o);
    }
    skin.value = String(bot.skin);
    skin.addEventListener('change', () => {
      bot.skin = Number(skin.value);
      dirty = true;
    });
    idRow.append(
      name,
      el('span', '', `${champ?.name ?? bot.championId}`),
      sigA,
      sigB,
      skin,
      el('span', 'ac-sub', `v${bot.version}`),
    );
    top.append(idRow);
    const actions = el('div', 'ac-row');
    const save = el('button', 'ac-btn primary', dirty ? 'Save' : 'Saved') as HTMLButtonElement;
    save.disabled = !dirty || coaching;
    save.addEventListener('click', () => {
      void api<{ bot: BotView }>('/api/bots/save', {
        id: bot.id,
        name: bot.name,
        sigils: bot.sigils,
        skin: bot.skin,
        playbook: def,
      }).then((r) => {
        if (!r.ok) {
          say(r.error, true);
          return;
        }
        bots = bots.map((b) => (b.id === r.bot.id ? r.bot : b));
        current = r.bot;
        working = structuredClone(r.bot.playbook);
        dirty = false;
        versions = null;
        say(`Saved as v${r.bot.version}.`);
        renderRail();
      });
    });
    const deposit = el('label', 'ac-check');
    const depositBox = el('input', '') as HTMLInputElement;
    depositBox.type = 'checkbox';
    depositBox.checked = bot.deposited;
    depositBox.addEventListener('change', () => {
      void api<{ bot: BotView }>('/api/bots/deposit', { id: bot.id, on: depositBox.checked }).then(
        (r) => {
          if (!r.ok) {
            depositBox.checked = bot.deposited;
            say(r.error, true);
            return;
          }
          bot.deposited = r.bot.deposited;
          bots = bots.map((b) => (b.id === bot.id ? { ...b, deposited: bot.deposited } : b));
          renderRail();
        },
      );
    });
    deposit.append(depositBox, document.createTextNode('In the Arena pool'));
    const history = el('button', 'ac-btn', versions ? 'Hide history' : 'History');
    history.addEventListener('click', () => {
      if (versions) {
        versions = null;
        renderMain();
        return;
      }
      void api<{ versions: { version: number; author: string; at: number }[] }>(
        '/api/bots/versions',
        { id: bot.id },
      ).then((r) => {
        if (!r.ok) {
          say(r.error, true);
          return;
        }
        versions = r.versions;
        renderMain();
      });
    });
    const del = el('button', 'ac-btn danger', confirmDelete ? 'Really delete?' : 'Delete');
    del.addEventListener('click', () => {
      if (!confirmDelete) {
        confirmDelete = true;
        renderMain();
        return;
      }
      void api('/api/bots/delete', { id: bot.id }).then((r) => {
        if (!r.ok) {
          say(r.error, true);
          return;
        }
        void load(null);
      });
    });
    actions.append(save, deposit, history, del);
    top.append(actions);
    const st = el('div', `ac-status${statusBad ? ' bad' : ''}`, status);
    top.append(st);
    if (versions) {
      const table = el('table', 'ac-table');
      const hr = el('tr', '');
      for (const h of ['Version', 'By', 'When', '']) hr.append(el('th', '', h));
      table.append(hr);
      for (const v of [...versions].reverse()) {
        const tr = el('tr', '');
        tr.append(
          el('td', '', `v${v.version}`),
          el('td', '', v.author),
          el('td', '', new Date(v.at).toLocaleString()),
        );
        const cell = el('td', '');
        if (v.version !== bot.version) {
          const revert = el('button', 'ac-btn mini', 'Revert to this');
          revert.addEventListener('click', () => {
            void api<{ bot: BotView }>('/api/bots/revert', { id: bot.id, version: v.version }).then(
              (r) => {
                if (!r.ok) {
                  say(r.error, true);
                  return;
                }
                bots = bots.map((b) => (b.id === r.bot.id ? r.bot : b));
                versions = null;
                select(r.bot);
                say(`Back to v${v.version}, saved as v${r.bot.version}.`);
                renderRail();
              },
            );
          });
          cell.append(revert);
        }
        tr.append(cell);
        table.append(tr);
      }
      top.append(table);
    }
    main.append(top);

    // The play list.
    const list = el('div', 'ac-panel');
    list.append(el('h3', '', 'The playbook'));
    list.append(
      el(
        'p',
        'ac-lead',
        'Top to bottom, the first play whose condition holds and that can act this slot is ' +
          'the one that acts; a play that cannot act (nothing to farm, nothing to buy) passes ' +
          'the turn down. Dodging, skill points and recall discipline are reflexes the engine ' +
          'keeps for every bot.',
      ),
    );
    def.plays.forEach((play, index) => {
      list.append(playRow(play, index));
    });
    const add = el('button', 'ac-btn', '+ Add a play');
    add.disabled = coaching;
    add.addEventListener('click', () => {
      const id = uniqueId('new-play');
      edit((plays) => {
        plays.push({ id, when: { kind: 'always' }, do: { kind: 'hold' } });
      });
      editingId = id;
      renderMain();
    });
    list.append(add);
    main.append(list);
  }

  function playRow(play: PlayDef, index: number): HTMLElement {
    const row = el('div', `ac-play${play.enabled === false ? ' off' : ''}`);
    const headRow = el('div', 'ac-play-head');
    const on = el('input', '') as HTMLInputElement;
    on.type = 'checkbox';
    on.checked = play.enabled !== false;
    on.title = 'Enabled';
    on.disabled = coaching;
    on.addEventListener('change', () =>
      edit((plays) => {
        const p = plays[index]!;
        if (on.checked) delete p.enabled;
        else p.enabled = false;
      }),
    );
    const text = el('span', 'ac-play-text');
    const when = el('b', '', 'when ');
    const doLabel = el('b', '', ' do ');
    text.append(when, describeTrigger(play.when), doLabel, describeBehavior(play.do));
    const tools = el('span', 'ac-play-tools');
    const mk = (label: string, title: string, fn: () => void, disabled = false): void => {
      const b = el('button', 'ac-btn mini', label) as HTMLButtonElement;
      b.title = title;
      b.disabled = disabled || coaching;
      b.addEventListener('click', fn);
      tools.append(b);
    };
    mk(
      'up',
      'Earlier plays win',
      () =>
        edit((plays) => {
          const [p] = plays.splice(index, 1);
          plays.splice(index - 1, 0, p!);
        }),
      index === 0,
    );
    mk(
      'down',
      'Later plays only act when nothing above can',
      () =>
        edit((plays) => {
          const [p] = plays.splice(index, 1);
          plays.splice(index + 1, 0, p!);
        }),
      index === (working?.plays.length ?? 1) - 1,
    );
    mk(editingId === play.id ? 'close' : 'edit', 'Edit this play', () => {
      editingId = editingId === play.id ? null : play.id;
      renderMain();
    });
    mk('x', 'Remove this play', () =>
      edit((plays) => {
        plays.splice(index, 1);
      }),
    );
    headRow.append(on, el('span', 'ac-play-id', play.id), text, tools);
    row.append(headRow);
    if (editingId === play.id) row.append(playEditor(play, index));
    return row;
  }

  function playEditor(play: PlayDef, index: number): HTMLElement {
    const box = el('div', 'ac-editor');
    const idRow = el('div', 'ac-row');
    const id = el('input', 'ac-input') as HTMLInputElement;
    id.value = play.id;
    id.maxLength = 32;
    id.title = 'lowercase letters, digits, hyphens';
    id.addEventListener('change', () => {
      const next = id.value.trim().toLowerCase();
      if (next === play.id) return;
      edit((plays) => {
        plays[index]!.id = next;
      });
      editingId = next;
      renderMain();
    });
    idRow.append(el('span', 'ac-sub', 'name'), id);
    box.append(idRow);
    box.append(el('h4', '', 'When'));
    box.append(
      triggerEditor(
        play.when,
        (t) =>
          edit((plays) => {
            plays[index]!.when = t;
          }),
        1,
      ),
    );
    box.append(el('h4', '', 'Do'));
    box.append(
      behaviorEditor(play.do, (b) =>
        edit((plays) => {
          plays[index]!.do = b;
        }),
      ),
    );
    return box;
  }

  function kindSelect(kinds: readonly string[], forms: Record<string, KindForm>, value: string) {
    const s = el('select', 'ac-select') as HTMLSelectElement;
    for (const k of kinds) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = forms[k]?.label ?? k;
      s.append(o);
    }
    s.value = value;
    return s;
  }

  // The fields of one trigger or behavior, writing into a copy and handing
  // it back whole; the caller validates.
  function fields(
    form: KindForm,
    obj: Record<string, unknown>,
    onChange: (next: Record<string, unknown>) => void,
  ): HTMLElement {
    const wrap = el('div', 'ac-row');
    for (const c of form.choices ?? []) {
      const f = el('label', 'ac-field');
      const s = el('select', 'ac-select') as HTMLSelectElement;
      for (const opt of c.options) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        s.append(o);
      }
      s.value = String(obj[c.key] ?? c.options[0]);
      s.addEventListener('change', () => onChange({ ...obj, [c.key]: s.value }));
      f.append(el('span', '', c.label), s);
      wrap.append(f);
    }
    for (const n of form.nums ?? []) {
      const f = el('label', 'ac-field');
      const input = el('input', 'ac-input ac-num') as HTMLInputElement;
      input.type = 'number';
      input.min = String(n.pct ? 0 : n.min);
      input.max = String(n.pct ? 100 : n.max);
      input.step = String(n.pct ? Math.round(n.step * 100) : n.step);
      const v = obj[n.key];
      input.value = typeof v === 'number' ? String(n.pct ? Math.round(v * 100) : v) : '';
      input.placeholder = 'default';
      input.addEventListener('change', () => {
        const next = { ...obj };
        if (input.value.trim() === '') delete next[n.key];
        else {
          const raw = Number(input.value);
          if (!Number.isFinite(raw)) return;
          next[n.key] = n.pct
            ? clamp(raw / 100, n.min, n.max, n.step)
            : clamp(raw, n.min, n.max, n.step);
        }
        onChange(next);
      });
      f.append(el('span', '', n.pct ? `${n.label} (%)` : n.label), input);
      wrap.append(f);
    }
    return wrap;
  }

  function triggerEditor(t: Trigger, onChange: (t: Trigger) => void, depth: number): HTMLElement {
    const box = el('div', depth > 1 ? 'ac-branch' : '');
    const kinds =
      depth >= 3 ? TRIGGER_KINDS.filter((k) => !['not', 'all', 'any'].includes(k)) : TRIGGER_KINDS;
    const sel = kindSelect(kinds, TRIGGER_FORMS, t.kind);
    sel.disabled = coaching;
    sel.addEventListener('change', () => onChange(freshTrigger(sel.value as Trigger['kind'])));
    box.append(sel);
    if (t.kind === 'not') {
      box.append(triggerEditor(t.of, (of) => onChange({ kind: 'not', of }), depth + 1));
    } else if (t.kind === 'all' || t.kind === 'any') {
      t.of.forEach((sub, i) => {
        const branch = el('div', 'ac-row');
        branch.append(
          triggerEditor(
            sub,
            (next) => {
              const of = [...t.of];
              of[i] = next;
              onChange({ kind: t.kind, of });
            },
            depth + 1,
          ),
        );
        if (t.of.length > 1) {
          const rm = el('button', 'ac-btn mini', 'x');
          rm.title = 'Remove this condition';
          rm.addEventListener('click', () =>
            onChange({ kind: t.kind, of: t.of.filter((_, j) => j !== i) }),
          );
          branch.append(rm);
        }
        box.append(branch);
      });
      if (t.of.length < 8) {
        const add = el('button', 'ac-btn mini', '+ condition');
        add.addEventListener('click', () =>
          onChange({ kind: t.kind, of: [...t.of, { kind: 'enemyVisible' }] }),
        );
        box.append(add);
      }
    } else {
      const form = TRIGGER_FORMS[t.kind];
      if (form.nums || form.choices) {
        box.append(
          fields(form, t as unknown as Record<string, unknown>, (next) =>
            onChange(next as unknown as Trigger),
          ),
        );
      }
    }
    return box;
  }

  function behaviorEditor(b: Behavior, onChange: (b: Behavior) => void): HTMLElement {
    const box = el('div', '');
    const sel = kindSelect(BEHAVIOR_KINDS, BEHAVIOR_FORMS, b.kind);
    sel.disabled = coaching;
    sel.addEventListener('change', () => onChange(freshBehavior(sel.value as Behavior['kind'])));
    box.append(sel);
    const form = BEHAVIOR_FORMS[b.kind];
    if (form.nums || form.choices) {
      box.append(
        fields(form, b as unknown as Record<string, unknown>, (next) =>
          onChange(next as unknown as Behavior),
        ),
      );
    }
    if (b.kind === 'push') {
      const never = el('label', 'ac-check');
      const cb = el('input', '') as HTMLInputElement;
      cb.type = 'checkbox';
      cb.checked = b.regroupAt === null;
      cb.addEventListener('change', () => {
        const next = { ...b } as Record<string, unknown>;
        if (cb.checked) next.regroupAt = null;
        else delete next.regroupAt;
        onChange(next as unknown as Behavior);
      });
      never.append(cb, document.createTextNode('never regroup mid'));
      box.append(never);
    }
    return box;
  }

  // --- the side: the coach, and sparring ---
  function renderSide(): void {
    side.textContent = '';
    if (!current || !working) return;
    const bot = current;
    const def = working;

    const coach = el('div', 'ac-panel');
    coach.style.display = 'flex';
    coach.style.flexDirection = 'column';
    coach.style.flex = '1';
    // The panel yields height to the sparring and Briefing panels below but
    // never less than its own controls: shrunk further it spilled its text
    // under the sparring summary (playtest round 2). Past this the side
    // column scrolls, and the chat log scrolls inside.
    coach.style.minHeight = '360px';
    coach.style.overflow = 'hidden';
    coach.append(el('h3', '', 'The coach'));
    coach.append(
      el(
        'p',
        'ac-lead',
        'Say how the bot should play ("safer under towers", "take every Warden", "farm ' +
          'until level six, then fight"). Each answer edits the play list as it streams; ' +
          'nothing is saved until you press Save. The conversation stays with the bot, ' +
          'session after session.',
      ),
    );
    const log = el('div', 'ac-chatlog');
    if (chat.length === 0 && !coaching) {
      log.append(
        el('div', 'ac-sub', chatLoading ? 'Opening the conversation...' : 'No messages yet.'),
      );
    }
    for (const turn of chat) {
      const bubble = el('div', `ac-bubble ${turn.role === 'user' ? 'user' : 'ai'}`, turn.bubble);
      if (turn.refused && turn.refused.length > 0) {
        bubble.append(el('small', '', `Refused: ${turn.refused.join('; ')}`));
      }
      log.append(bubble);
    }
    if (coaching) {
      const bubble = el(
        'div',
        'ac-bubble ai',
        coachText !== '' ? coachText : `${coachStage || 'Thinking'}...`,
      );
      if (coachRefused.length > 0)
        bubble.append(el('small', '', `Refused: ${coachRefused.join('; ')}`));
      log.append(bubble);
    }
    coach.append(log);
    const row = el('div', 'ac-chatrow');
    const input = el('input', 'ac-input') as HTMLInputElement;
    input.placeholder = 'How should this bot play?';
    input.maxLength = 2000;
    input.value = chatDraft;
    input.addEventListener('input', () => {
      chatDraft = input.value;
    });
    const send = el(
      'button',
      'ac-btn primary',
      coaching ? 'Asking...' : 'Send',
    ) as HTMLButtonElement;
    send.disabled = coaching;
    const submit = (): void => {
      const text = input.value.trim();
      if (text === '' || send.disabled) return;
      chatDraft = '';
      chat.push({ role: 'user', text, bubble: text });
      coaching = true;
      coachText = '';
      coachStage = '';
      coachRefused = [];
      renderSide();
      renderMain();
      void coachStream<{
        ok: boolean;
        comment?: string;
        ops?: PatchOp[];
        refused?: { op: unknown; error: string }[];
        raw?: string;
        error?: string;
      }>(
        {
          id: bot.id,
          text,
          playbook: def,
          depth: deep ? 'deep' : 'quick',
        },
        (line) => {
          if (line.progress === 'stage') coachStage = line.text ?? '';
          else if (line.progress === 'text') coachText += line.text ?? '';
          else if (line.progress === 'op' && line.op && working) {
            const r = applyPatchOp(working, line.op as PatchOp);
            if (r.ok) {
              working = r.def;
              dirty = true;
              renderMain();
            } else coachRefused.push(r.error);
          } else if (line.progress === 'refused') coachRefused.push(line.error ?? 'refused');
          const bubble = log.lastElementChild as HTMLElement | null;
          if (bubble) {
            bubble.textContent = coachText !== '' ? coachText : `${coachStage || 'Thinking'}...`;
            if (coachRefused.length > 0) {
              bubble.append(el('small', '', `Refused: ${coachRefused.join('; ')}`));
            }
          }
        },
      ).then((r) => {
        coaching = false;
        if (!r?.ok || typeof r.raw !== 'string') {
          // The model never saw this message: take it back into the input
          // so the thread matches what was actually answered.
          chat.pop();
          chatDraft = text;
          say(r?.error ?? 'the coach did not answer', true);
          renderSide();
          return;
        }
        chat.push({
          role: 'assistant',
          text: r.raw,
          bubble: r.comment && r.comment !== '' ? r.comment : 'Done.',
          refused: (r.refused ?? []).map((e) => e.error),
        });
        renderSide();
        renderMain();
      });
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    row.append(input, send);
    coach.append(row);
    const opts = el('div', 'ac-row');
    const deepBox = el('label', 'ac-check');
    const deepCb = el('input', '') as HTMLInputElement;
    deepCb.type = 'checkbox';
    deepCb.checked = deep;
    deepCb.addEventListener('change', () => {
      deep = deepCb.checked;
    });
    deepBox.append(deepCb, document.createTextNode('Deep rework (slower, for a rewrite)'));
    opts.append(deepBox);
    if (chat.length > 0 && !coaching) {
      const clear = el('button', 'ac-btn mini', 'Start over');
      clear.title = 'Forget this conversation (the play list stays)';
      clear.addEventListener('click', () => {
        chat.length = 0;
        renderSide();
        void api('/api/bots/chat/clear', { id: bot.id });
      });
      opts.append(clear);
    }
    coach.append(opts);
    side.append(coach);

    const sparBox = el('div', 'ac-panel');
    sparBox.append(el('h3', '', 'Sparring'));
    sparBox.append(
      el(
        'p',
        'ac-lead',
        'A whole match against house bots, played here in seconds, unrated. Then watch the ' +
          'replay with what the bot was thinking on its plate.',
      ),
    );
    const sparBtn = el(
      'button',
      'ac-btn primary',
      sparRunning ? 'Sparring...' : 'Spar vs house bots',
    ) as HTMLButtonElement;
    sparBtn.disabled = sparRunning || coaching;
    sparBtn.addEventListener('click', () => {
      sparRunning = true;
      sparError = null;
      sparResult = null;
      renderSide();
      const seed = Math.floor(Math.random() * 1_000_000_000);
      runSparring(
        {
          name: bot.name,
          championId: bot.championId,
          sigils: bot.sigils,
          skin: bot.skin,
          playbook: def,
        },
        seed,
      )
        .then((r) => {
          sparResult = r;
          lastSpar.set(bot.id, r);
        })
        .catch((e: Error) => {
          sparError = e.message;
        })
        .finally(() => {
          sparRunning = false;
          renderSide();
        });
    });
    sparBox.append(sparBtn);
    // The Arena, now (docs/design/bots.md): one rated match on demand, played
    // by the server in seconds against the deposited bots nearest in rating.
    const arenaBtn = el(
      'button',
      'ac-btn',
      arenaRunning ? 'Playing in the Arena...' : 'Play now in the Arena (rated)',
    ) as HTMLButtonElement;
    arenaBtn.disabled = arenaRunning || coaching || dirty;
    arenaBtn.title = dirty ? 'Save first: the Arena plays the saved playbook' : '';
    arenaBtn.addEventListener('click', () => {
      arenaRunning = true;
      arenaResult = null;
      renderSide();
      void api<{
        winner: 0 | 1 | null;
        ticks: number;
        rated: boolean;
        replayId?: number;
        seats: { accountId: number; botId: string; team: 0 | 1; delta: number; rating: number }[];
      }>('/api/bots/playnow', { id: bot.id }).then((r) => {
        arenaRunning = false;
        if (!r.ok) {
          say(r.error, true);
          renderSide();
          return;
        }
        const mine = r.seats.find((s) => s.botId === bot.id);
        arenaResult = {
          text:
            (r.winner === 0 ? 'Won' : r.winner === 1 ? 'Lost' : 'No winner') +
            ` after ${fmtSeconds(r.ticks)}` +
            (r.rated && mine
              ? `, ${mine.delta >= 0 ? '+' : ''}${mine.delta} Arena rating (now ${mine.rating})`
              : ', unrated'),
          replayId: r.replayId ?? null,
        };
        renderSide();
      });
    });
    sparBox.append(arenaBtn);
    if (arenaResult) {
      sparBox.append(el('div', 'ac-status', arenaResult.text));
      if (arenaResult.replayId !== null) {
        const id = arenaResult.replayId;
        const watch = el('button', 'ac-btn', 'Watch the Arena replay');
        watch.addEventListener('click', () => {
          close();
          window.dispatchEvent(new CustomEvent('loc:replay', { detail: id }));
        });
        sparBox.append(watch);
      }
    }
    if (sparError) sparBox.append(el('div', 'ac-status bad', sparError));
    if (sparResult) {
      const r = sparResult;
      const verdict =
        r.winner === 0
          ? 'Your bot’s team won'
          : r.winner === 1
            ? 'Your bot’s team lost'
            : 'No winner';
      const line = el('div', 'ac-row');
      line.append(el('div', 'ac-status', `${verdict} after ${fmtSeconds(r.ticks)}.`));
      const dismiss = el('button', 'ac-btn mini', 'Dismiss');
      dismiss.title = 'Put the summary away';
      dismiss.addEventListener('click', () => {
        sparResult = null;
        lastSpar.delete(bot.id);
        renderSide();
      });
      line.append(dismiss);
      sparBox.append(line);
      const mine = r.report.units.find((u) => u.unitId === r.botUnitId);
      if (mine) {
        const table = el('table', 'ac-table');
        const hr = el('tr', '');
        for (const h of ['Play', 'Time', 'Deaths']) hr.append(el('th', '', h));
        table.append(hr);
        const rows = Object.entries(mine.plays).sort((a, b) => b[1].ticks - a[1].ticks);
        for (const [id, s] of rows) {
          const tr = el('tr', '');
          tr.append(
            el('td', '', id),
            el('td', 'num', fmtSeconds(s.ticks)),
            el('td', 'num', String(s.deaths)),
          );
          table.append(tr);
        }
        sparBox.append(table);
      }
      const watch = el('button', 'ac-btn', 'Watch the replay');
      watch.addEventListener('click', () => {
        const record: ReplayRecord = r.record;
        close();
        window.dispatchEvent(
          new CustomEvent('loc:replay-record', { detail: { record, botId: bot.id } }),
        );
      });
      sparBox.append(watch);
    }
    side.append(sparBox);

    // The Briefing (docs/design/bots.md): what the Arena did to this bot
    // since yesterday, play by play, and the night coach's proposal with
    // what sparring said about it.
    const brief = el('div', 'ac-panel');
    brief.append(el('h3', '', 'The Briefing'));
    if (!briefing) {
      const load = el(
        'button',
        'ac-btn',
        briefingLoading ? 'Loading...' : 'Read the Briefing',
      ) as HTMLButtonElement;
      load.disabled = briefingLoading;
      load.addEventListener('click', () => {
        briefingLoading = true;
        renderSide();
        void api<BriefingView>('/api/bots/briefing', { id: bot.id }).then((r) => {
          briefingLoading = false;
          if (!r.ok) {
            say(r.error, true);
            renderSide();
            return;
          }
          briefing = r;
          renderSide();
        });
      });
      brief.append(
        el(
          'p',
          'ac-lead',
          'Every night the Arena plays your deposited bots and the coach reads the report. ' +
            'Come back in the morning.',
        ),
        load,
      );
    } else {
      const b = briefing;
      brief.append(
        el(
          'div',
          'ac-status',
          `Last 24 hours in the Arena: ${b.wins} won, ${b.losses} lost, ` +
            `${b.ratingDelta >= 0 ? '+' : ''}${b.ratingDelta} (Arena rating ${b.rating}).`,
        ),
      );
      const rows = Object.entries(b.plays).sort((x, y) => y[1].ticks - x[1].ticks);
      if (rows.length > 0) {
        const table = el('table', 'ac-table');
        const hr = el('tr', '');
        for (const h of ['Play', 'Time', 'Deaths']) hr.append(el('th', '', h));
        table.append(hr);
        for (const [id, s] of rows) {
          const tr = el('tr', '');
          tr.append(
            el('td', '', id),
            el('td', 'num', fmtSeconds(s.ticks)),
            el('td', 'num', String(s.deaths)),
          );
          table.append(tr);
        }
        brief.append(table);
      }
      for (const m of b.matches.slice(-5).reverse()) {
        const line = el('div', 'ac-row');
        line.append(
          el(
            'span',
            '',
            `${new Date(m.at).toLocaleString()}: ${m.win ? 'won' : 'lost'}, ${m.delta >= 0 ? '+' : ''}${m.delta}`,
          ),
        );
        if (m.replayId !== undefined) {
          const id = m.replayId;
          const watch = el('button', 'ac-btn mini', 'Watch');
          watch.addEventListener('click', () => {
            close();
            window.dispatchEvent(new CustomEvent('loc:replay', { detail: id }));
          });
          line.append(watch);
        }
        brief.append(line);
      }
      if (b.proposal) {
        const p = b.proposal;
        const box = el('div', 'ac-play');
        box.append(el('div', 'ac-play-id', 'The coach proposes'));
        box.append(el('div', 'ac-play-text', p.comment));
        for (const op of p.ops) box.append(el('div', 'ac-sub', describeOp(op)));
        box.append(
          el(
            'div',
            'ac-status',
            `Sparring: ${p.candidateWins} wins with it, ${p.currentWins} without, over ${p.matches} matches.`,
          ),
        );
        const answer = (action: 'apply' | 'dismiss'): void => {
          void api<{ version?: number }>('/api/bots/proposal', {
            id: bot.id,
            proposalId: p.id,
            action,
          }).then((r) => {
            if (!r.ok) {
              say(r.error, true);
              return;
            }
            say(action === 'apply' ? `Applied as v${r.version}.` : 'Dismissed.');
            void load(bot.id);
          });
        };
        const apply = el('button', 'ac-btn primary', 'Apply');
        apply.addEventListener('click', () => answer('apply'));
        const dismiss = el('button', 'ac-btn', 'Dismiss');
        dismiss.addEventListener('click', () => answer('dismiss'));
        box.append(apply, dismiss);
        brief.append(box);
      } else {
        brief.append(el('div', 'ac-sub', 'No proposal waiting.'));
      }
      const auto = el('label', 'ac-check');
      const autoBox = el('input', '') as HTMLInputElement;
      autoBox.type = 'checkbox';
      autoBox.checked = b.autoApply;
      autoBox.addEventListener('change', () => {
        void api<{ bot: BotView }>('/api/bots/autoapply', { id: bot.id, on: autoBox.checked }).then(
          (r) => {
            if (!r.ok) {
              autoBox.checked = b.autoApply;
              say(r.error, true);
              return;
            }
            b.autoApply = autoBox.checked;
          },
        );
      });
      auto.append(
        autoBox,
        document.createTextNode("Apply the coach's passing proposals on their own"),
      );
      const refresh = el('button', 'ac-btn mini', 'Refresh');
      refresh.addEventListener('click', () => {
        briefing = null;
        renderSide();
      });
      brief.append(auto, refresh);
    }
    side.append(brief);
  }

  function renderAll(): void {
    renderRail();
    renderMain();
    renderSide();
  }

  renderAll();
  void load(opts.botId ?? null);
}
