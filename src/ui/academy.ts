// The Academy (docs/design/bots.md, plan-bots phase 4): where an account
// writes and tests a bot. Making one is a way through five steps
// (ui/academy_steps.ts): the bot itself, its kit, its playbook with the
// coach beside it, sparring, then play; each a page of the same bot, a
// bar across the top to jump between them and Back and Next at the foot.
// Every bot starts as the Laner on its champion; local sparring plays a
// whole match against house bots at full speed in a worker and opens the
// replay with the active play on every plate. The playbook on screen is
// always one the engine can run: every edit and every coach operation goes
// through the validator before it lands.

import { appNav, type Frame } from '../game/nav';
import { runSeries, runSparring } from '../game/sparring';
import { SERIES_SEEDS, type SparResult } from '../game/sparring_core';
import { type CoachTurn, commentOf } from '../net/coach_chat';
import type { RecordEntry, RecordRow, RecordTallies } from '../net/record';
import { CHAMPION_LIST, CHAMPIONS, homeLane } from '../sim/content/champions';
import { ITEMS } from '../sim/content/items';
import { SIGIL_LIST, SIGILS } from '../sim/content/sigils';
import {
  applyPatchOp,
  type Behavior,
  type KitDef,
  type KitVariant,
  MAX_BUILD,
  MAX_VARIANTS,
  type PatchOp,
  type PlaybookDef,
  type PlayDef,
  roleBuild,
  type SkillKey,
  type Trigger,
  validatePlaybook,
} from '../sim/playbook';
import type { TeamId } from '../sim/types';
import {
  openSteps,
  pickSigil,
  SIGIL_BLURBS,
  STEPS,
  type StepFacts,
  type StepId,
  stepAfter,
  stepBefore,
  stepOf,
  stepStatus,
} from './academy_steps';
import { BALANCE_CSS, balanceTag } from './balances';
import { setPortrait } from './champion_art';
import { loadCollection } from './collection';
import { sigilImageUrl } from './icon_images';
import { buildCounts, buildRow, itemCatalog } from './item_catalog';
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
import { fmtClock, kindLabel, renderRecordView, resultOf } from './record_view';
import { buildIcons } from './scoreboard_table';
import { buildTallyView, emptyTallies } from './tally_view';

const CSS = `${BALANCE_CSS}
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
.ac-record { flex: 1; min-width: 0; min-height: 0; display: none; flex-direction: column; }
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
.ac-embers { color: #e8cc74; font-size: 11.5px; font-weight: 700; margin: 4px 0 6px; }
.ac-chatrow { display: flex; gap: 6px; align-items: center; }
.ac-chatrow .ac-input { flex: 1; }
.ac-check { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: #7f9cae; }
.ac-table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 6px; }
.ac-table td, .ac-table th { padding: 3px 4px; border-bottom: 1px solid #1f3644; text-align: left; }
.ac-table th { color: #6cc3e0; font-size: 10.5px; text-transform: uppercase; }
.ac-table td.num { text-align: right; }
.ac-form { display: flex; flex-direction: column; gap: 4px; }
.ac-panel h4 { margin: 6px 8px 4px 0; font-size: 11px; color: #6cc3e0; text-transform: uppercase; letter-spacing: 0.5px; }
.ac-kit-item { flex: 1; color: #c8d6e0; }
.ac-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 6px 0 2px; }
.ac-line .verdict { font-weight: 800; font-size: 13px; color: #e0ecf3; }
.ac-line .verdict.won { color: #9fe0a8; }
.ac-line .verdict.lost { color: #f0a090; }
.ac-line .kda { font-weight: 800; font-size: 14px; color: #e0c070; letter-spacing: 0.5px; }
.ac-line .dim { color: #7f9cae; }
.ac .hud-score-build { display: flex; gap: 3px; margin: 2px 0 6px; }
.ac .hud-score-build img { border-radius: 4px; border: 1px solid #2c4d60; background: #070d12; display: block; }
.ac .hud-score-build .slot { display: block; border-radius: 4px; border: 1px dashed #1f3644; background: #070d12; }

/* The steps (ui/academy_steps.ts): one bar across the top of the bot, a
   number, a name and a line each; the open one lit, the ones behind it
   ticked, the ones a bot not made yet cannot have, dimmed. */
.ac-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
.ac-step {
  display: flex; align-items: flex-start; gap: 9px; min-width: 0; text-align: left;
  padding: 8px 10px; border-radius: 8px; border: 1px solid #1f3644;
  background: rgba(6, 12, 16, 0.86); color: #c8d6e0; font: inherit; cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ac-step:hover:not(:disabled) { border-color: #3d7a94; }
.ac-step.on { border-color: #8ed6f0; background: #122431; }
.ac-step:disabled { opacity: 0.45; cursor: default; }
.ac-step-n {
  flex: none; width: 22px; height: 22px; border-radius: 50%; border: 1px solid #2c4d60;
  display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800;
  color: #8ed6f0; background: #070d12;
}
.ac-step.on .ac-step-n { background: #8ed6f0; color: #06141c; border-color: #b8e8f8; }
.ac-step.done .ac-step-n { border-color: #4fa8c8; }
.ac-step-t { min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
.ac-step-t b { font-size: 12px; color: #e0ecf3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ac-step-t small { font-size: 10.5px; color: #7f9cae; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ac-step.on .ac-step-t small { color: #a9c2d2; }
/* Under the bar: the step's own title and line, and the save at the right,
   in view on every step so an edit is never far from Save. */
.ac-stephead { display: flex; align-items: center; gap: 12px; margin: 0 0 10px; flex-wrap: wrap; }
.ac-stephead h2 { margin: 0; font-size: 16px; font-weight: 800; color: #8ed6f0; letter-spacing: 0.4px; }
.ac-stephead .ac-lead { margin: 0; flex: 1; min-width: 200px; }
.ac-stephead .ac-btn { margin: 0; }
.ac-stephead .ac-status { margin: 0; flex-basis: 100%; }
/* The foot: the way back and the way on, under whatever the step showed. */
.ac-stepnav { display: flex; justify-content: space-between; gap: 10px; margin: 4px 0 14px; }
.ac-stepnav .ac-btn { margin: 0; }
/* The bot step: the champion as cards with their portraits, one lit; the
   sigils as two picks that say what they do. */
.ac-champs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 4px 0 10px; }
.ac-champ {
  display: flex; align-items: center; gap: 9px; padding: 7px 9px; min-width: 0; text-align: left;
  border-radius: 8px; border: 1px solid #1f3644; background: #0b141a; color: #c8d6e0; font: inherit;
  cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease;
}
.ac-champ:hover:not(:disabled) { border-color: #3d7a94; }
.ac-champ.on { border-color: #8ed6f0; background: #122431; }
.ac-champ:disabled { cursor: default; }
.ac-champ img { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; object-position: top;
  border: 1px solid #2c4d60; background: #070d12; flex: none; display: block; }
.ac-champ-t { min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
.ac-champ-t b { font-size: 12.5px; color: #e0ecf3; }
.ac-champ-t small { font-size: 10.5px; color: #7f9cae; }
.ac-champ-blurb { color: #8fa6b6; font-size: 12px; line-height: 1.45; margin: 0 0 10px; }
/* The sigils as a grid of all four, two of them lit and numbered in the
   order they were picked; a click on another swaps the older one out. */
.ac-sigils { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px;
  margin: 4px 0 10px; }
.ac-sigil {
  position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 9px 10px;
  min-width: 0; text-align: left; border-radius: 8px; border: 1px solid #1f3644;
  background: #0b141a; color: #c8d6e0; font: inherit; cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ac-sigil:hover { border-color: #3d7a94; }
.ac-sigil.on { border-color: #8ed6f0; background: #122431; }
.ac-sigil img { width: 40px; height: 40px; border-radius: 6px; border: 1px solid #2c4d60;
  background: #070d12; flex: none; display: block; object-fit: cover; }
.ac-sigil-t { min-width: 0; display: flex; flex-direction: column; gap: 3px; line-height: 1.25; }
.ac-sigil-t b { font-size: 12.5px; color: #e0ecf3; }
.ac-sigil-t small { color: #7f9cae; font-size: 11px; line-height: 1.35; }
.ac-sigil.on .ac-sigil-t small { color: #a9c2d2; }
.ac-sigil-n {
  position: absolute; top: 6px; right: 6px; width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800;
  background: #8ed6f0; color: #06141c; border: 1px solid #b8e8f8;
}
.ac-fieldlabel { font-size: 10.5px; color: #6cc3e0; text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 0 4px; }
.ac-name { font-size: 15px; padding: 8px 10px; }
/* The play step: one switch, said in full. */
.ac-switch { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid #1f3644; background: #0b141a; margin-bottom: 8px; cursor: pointer; }
.ac-switch input { margin-top: 3px; }
.ac-switch b { color: #e0ecf3; font-size: 13px; display: block; }
.ac-switch span { color: #8fa6b6; font-size: 12px; line-height: 1.45; }
.ac-rail .ac-btn.wide { display: block; width: 100%; margin: 0 0 6px; text-align: center; }
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
  openPlaybook?: boolean;
  // Won and lost over the rated part of its Record (server/bots.ts).
  tally?: { wins: number; losses: number };
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

// The owner's collection (ADR 0018), fetched once and kept for the tab's
// lifetime: it only grows, and it grows in the roster browser rather than
// here. Null means the account has not answered, which draws no wall.
let botCollection: string[] | null = null;

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

export interface AcademyOptions {
  // The bot to open on, and the step to open it at (the way back from a
  // replay lands on Sparring, where the Record is).
  botId?: string;
  step?: StepId;
  // The live queue, from the Play step: the Academy closes and the home
  // queues; the bot is picked at champion select.
  onPlay?: () => void;
}

export function openAcademy(container: HTMLElement, opts: AcademyOptions = {}): () => void {
  ensureCss();
  const root = el('div', 'ac');
  const stopBackdrop = startMenuBackdrop(root);
  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    stopBackdrop();
    root.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (recordOpen) closeRecord();
    else close();
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
  // The Record's view takes the center and the side; the rail stays.
  const recordBox = el('div', 'ac-record');
  body.append(rail, main, side, recordBox);
  root.append(head, body);
  container.appendChild(root);

  // --- state ---
  let bots: BotView[] = [];
  // The account's embers and what a coach turn costs (ADR 0017): the
  // Academy is a spending surface, so it shows both. -1 is "not asked".
  let embers = -1;
  let coachPrice = 1;
  const loadEmbers = async (): Promise<void> => {
    const r = await api<{ embers: number; prices: Record<string, number> }>('/api/forge/drafts');
    if (!r.ok) return;
    embers = r.embers;
    if (typeof r.prices?.coachTurn === 'number') coachPrice = r.prices.coachTurn;
    // The balance lands after the first paint, so the paint is redone:
    // a price the creator only sees on their second visit is not shown.
    renderAll();
  };
  let current: BotView | null = null;
  // The step open on the current bot (ui/academy_steps.ts); kept across
  // bots, so two kits can be compared with two clicks on the rail.
  let step: StepId = opts.step ?? 'bot';
  // The new-bot form is open in the main column, no bot picked.
  let creating = false;
  // The editable copy of the current bot's playbook; saved on demand.
  let working: PlaybookDef | null = null;
  let dirty = false;
  let editingId: string | null = null;
  let editingVariant: number | null = null;
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
  // The chat log follows the conversation to its end unless the reader has
  // scrolled up to re-read something (playtest round 3: every answer had to
  // be scrolled to by hand).
  let chatStick = true;
  let deep = false;
  let sparRunning = false;
  let sparError: string | null = null;
  let seriesRunning = false;
  let seriesDone = 0;
  let seriesError: string | null = null;
  // The bot's Record (CONTEXT.md), newest first, read from the server on
  // every select and after every sparring; and the view over it when open.
  let record: RecordRow[] | null = null;
  let recordTally: RecordTallies = emptyTallies();
  let recordOpen = false;
  let recordOpenId: number | null = null;
  // The record over the bot's page is a layer of its own (src/game/nav.ts):
  // Back closes the record first and the Academy after, like Escape does.
  let recordFrame: Frame | null = null;
  let arenaRunning = false;
  // The Arena as it stands: matches left today, the pool, the next round.
  let arena: { left: number | null; cap: number; pool: number; nextRoundInMs: number } | null =
    null;
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
    creating = false;
    working = bot ? structuredClone(bot.playbook) : null;
    dirty = false;
    editingId = null;
    confirmDelete = false;
    versions = null;
    chat.length = 0;
    chatDraft = '';
    coachText = '';
    coachRefused = [];
    record = null;
    recordTally = emptyTallies();
    recordOpen = false;
    recordOpenId = null;
    const openFrame = recordFrame;
    recordFrame = null;
    openFrame?.closed();
    if (bot) {
      void loadRecord(bot.id);
      void loadArena();
    }
    seriesError = null;
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

  async function loadArena(): Promise<void> {
    const r = await api<{ left: number | null; cap: number; pool: number; nextRoundInMs: number }>(
      '/api/bots/arena',
    );
    if (r.ok) {
      arena = { left: r.left, cap: r.cap, pool: r.pool, nextRoundInMs: r.nextRoundInMs };
      renderMain();
    }
  }

  async function loadRecord(botId: string): Promise<void> {
    const r = await api<{ rows: RecordRow[]; tally: RecordTallies }>('/api/bots/record/list', {
      id: botId,
    });
    if (current?.id !== botId) return;
    if (r.ok) {
      record = r.rows;
      recordTally = r.tally;
      // The rail's chip is the rated part, the same number the server
      // sends with the list of bots.
      const b = bots.find((x) => x.id === botId);
      if (b) b.tally = { wins: r.tally.rated.wins, losses: r.tally.rated.losses };
    } else {
      record = [];
      say(r.error, true);
    }
    renderRail();
    renderMain();
    if (recordOpen) renderRecord();
  }

  // A sparring's result onto the bot's Record (server/bot_records.ts): the
  // ten rows, the report and the replay record; the server keeps the entry
  // and saves the replay beside the others.
  async function postEntry(
    bot: BotView,
    r: SparResult,
    team: TeamId,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const res = await api<{ row: RecordRow | null }>('/api/bots/record/add', {
      id: bot.id,
      seed: r.record.seed,
      team,
      winner: r.winner,
      ticks: r.ticks,
      version: bot.version,
      edited: dirty,
      botUnitId: r.botUnitId,
      score: r.score,
      report: r.report,
      record: r.record,
      ...extra,
    });
    if (!res.ok) throw new Error(`the result was not recorded: ${res.error}`);
  }

  function openRecord(entryId: number | null): void {
    recordOpen = true;
    recordOpenId = entryId;
    recordFrame ??= appNav().push('record', () => {
      recordFrame = null;
      closeRecord();
    });
    renderRecord();
  }

  function closeRecord(): void {
    recordOpen = false;
    const openFrame = recordFrame;
    recordFrame = null;
    renderRecord();
    openFrame?.closed();
  }

  // The replay viewer, then back here on the same bot; at a tick when the
  // sheet asked for one (a death, a few seconds before).
  function watchReplay(botId: string, replayId: number, tick?: number, follow?: number): void {
    close();
    window.dispatchEvent(
      new CustomEvent('loc:replay', {
        detail: {
          id: replayId,
          botId,
          ...(tick !== undefined ? { tick } : {}),
          ...(follow !== undefined ? { follow } : {}),
        },
      }),
    );
  }

  async function load(keepId: string | null): Promise<void> {
    void loadEmbers();
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
    const v = validatePlaybook({
      version: working.version,
      plays,
      ...(working.kit ? { kit: working.kit } : {}),
      ...(working.lanes ? { lanes: working.lanes } : {}),
    });
    if (!v.ok) {
      say(v.errors[0] ?? 'invalid playbook', true);
      return;
    }
    working = v.def;
    dirty = true;
    status = '';
    renderMain();
  };

  // The same door for the kit (ADR 0014): empty parts drop away so a kit
  // that says nothing is no kit at all, and a kit lifts the format to 2.
  const editKit = (mutate: (kit: KitDef) => void): void => {
    if (!working) return;
    const kit: KitDef = structuredClone(working.kit ?? {});
    mutate(kit);
    const cleaned: KitDef = {};
    if (kit.build && kit.build.length > 0) cleaned.build = kit.build;
    if (kit.skills) cleaned.skills = kit.skills;
    if (kit.variants && kit.variants.length > 0) cleaned.variants = kit.variants;
    const v = validatePlaybook({
      version: Math.max(working.version, 2),
      plays: working.plays,
      ...(Object.keys(cleaned).length > 0 ? { kit: cleaned } : {}),
      ...(working.lanes ? { lanes: working.lanes } : {}),
    });
    if (!v.ok) {
      say(v.errors[0] ?? 'invalid kit', true);
      return;
    }
    working = v.def;
    dirty = true;
    status = '';
    renderMain();
  };

  // The lane preference (phase 12): the lanes asked for, in order; none
  // means the champion's home lane. Lifts the format to 3.
  const editLanes = (lanes: ('top' | 'mid' | 'bot')[] | null): void => {
    if (!working) return;
    const v = validatePlaybook({
      version: Math.max(working.version, 3),
      plays: working.plays,
      ...(working.kit ? { kit: working.kit } : {}),
      ...(lanes && lanes.length > 0 ? { lanes } : {}),
    });
    if (!v.ok) {
      say(v.errors[0] ?? 'invalid lane preference', true);
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

  // --- the rail: your bots, and the way to a new one ---
  function renderRail(): void {
    rail.textContent = '';
    const list = el('div', 'ac-panel');
    list.append(el('h3', '', 'Your bots'));
    if (bots.length === 0) list.append(el('p', 'ac-lead', 'No bots yet. Make your first one.'));
    for (const b of bots) {
      const btn = el('button', `ac-bot${!creating && current?.id === b.id ? ' picked' : ''}`);
      const champ = CHAMPIONS[b.championId];
      btn.append(
        document.createTextNode(b.name),
        el(
          'small',
          '',
          `${champ?.name.split(',')[0] ?? b.championId} · v${b.version}` +
            (b.tally && b.tally.wins + b.tally.losses > 0
              ? ` · ${b.tally.wins}-${b.tally.losses}`
              : '') +
            (b.deposited ? ' · ranked' : ''),
        ),
      );
      btn.addEventListener('click', () => {
        if (dirty && !window.confirm('Discard the unsaved changes on this bot?')) return;
        select(b);
      });
      list.append(btn);
    }
    // The form itself stands in the main column, where it has the room
    // for the champions as cards; the rail only opens it.
    const make = el('button', `ac-btn wide${creating || bots.length === 0 ? ' primary' : ''}`);
    make.textContent = 'New bot';
    make.addEventListener('click', () => {
      if (dirty && !window.confirm('Discard the unsaved changes on this bot?')) return;
      startNew();
    });
    list.append(make);
    rail.append(list);
  }

  // The draft of a bot being made, kept across redraws (the collection
  // lands after the first paint and the form is drawn again).
  const draft: { name: string; championId: string | null; sigils: [string, string] } = {
    name: '',
    championId: null,
    sigils: ['riftstep', 'mend'],
  };
  const startNew = (): void => {
    current = null;
    working = null;
    dirty = false;
    creating = true;
    step = 'bot';
    status = '';
    renderAll();
  };

  // --- the main: the step bar, then the step of the bot ---
  function renderMain(): void {
    main.textContent = '';
    const making = creating || (!current && bots.length === 0);
    if (making) {
      main.append(stepBar(null, null), newBotForm());
      syncSide();
      return;
    }
    if (!current || !working) {
      const p = el('div', 'ac-panel');
      p.append(
        el('h3', '', 'A bot'),
        el('p', 'ac-lead', 'Pick one of your bots on the left, or make a new one.'),
      );
      main.append(p);
      syncSide();
      return;
    }
    const bot = current;
    const def = working;
    main.append(stepBar(bot, def), stepHead(bot, def));
    switch (step) {
      case 'bot':
        main.append(botStep(bot));
        break;
      case 'kit':
        main.append(kitPanel(bot, def));
        break;
      case 'playbook':
        main.append(playbookPanel(def));
        break;
      case 'spar':
        main.append(sparPanel(bot, def));
        break;
      case 'play':
        main.append(playPanel(bot), arenaPanel(bot), briefPanel(bot));
        break;
    }
    main.append(stepNav());
    syncSide();
  }

  // The coach stands beside the kit, the playbook and the sparring: its
  // operations reach the kit and the lanes as well as the plays, and the
  // sparring is what an answer is judged on. The bot and play steps take
  // the whole width.
  const sideWanted = (): boolean =>
    current !== null && !creating && (step === 'kit' || step === 'playbook' || step === 'spar');
  function syncSide(): void {
    side.style.display = sideWanted() && !recordOpen ? '' : 'none';
  }

  const go = (next: StepId): void => {
    step = next;
    status = '';
    renderMain();
    main.scrollTop = 0;
  };

  function stepFacts(bot: BotView | null, def: PlaybookDef | null): StepFacts {
    const champ = bot ? CHAMPIONS[bot.championId] : undefined;
    const kit = def?.kit ?? {};
    const build = kit.build ?? (bot ? roleBuild(bot.championId) : []);
    const sparred = recordTally.sparring.games + recordTally.series.games;
    return {
      bot: bot
        ? {
            championName: champ?.name.split(',')[0] ?? bot.championId,
            sigilNames: bot.sigils.map((id) => SIGILS[id]?.name ?? id),
            version: bot.version,
            deposited: bot.deposited,
            ...(bot.tally ? { tally: bot.tally } : {}),
          }
        : null,
      kit: { items: build.length, roleBuild: !kit.build, variants: kit.variants?.length ?? 0 },
      plays: {
        total: def?.plays.length ?? 0,
        off: def?.plays.filter((p) => p.enabled === false).length ?? 0,
      },
      record:
        record === null
          ? null
          : { games: sparred, wins: recordTally.sparring.wins + recordTally.series.wins },
      dirty,
    };
  }

  // The bar: every step, the open one lit, the ones with something behind
  // them ticked, the ones a bot not made yet cannot have, dimmed.
  function stepBar(bot: BotView | null, def: PlaybookDef | null): HTMLElement {
    const bar = el('div', 'ac-steps');
    const facts = stepFacts(bot, def);
    const open = new Set(openSteps(bot !== null));
    const done: Record<StepId, boolean> = {
      bot: bot !== null,
      kit: bot !== null,
      playbook: bot !== null,
      spar: (facts.record?.games ?? 0) > 0,
      play: bot?.deposited === true,
    };
    STEPS.forEach((st, i) => {
      const b = el('button', `ac-step${st.id === step ? ' on' : ''}${done[st.id] ? ' done' : ''}`);
      b.type = 'button';
      b.dataset.step = st.id;
      b.disabled = !open.has(st.id);
      if (b.disabled) b.title = 'After the bot is made';
      const text = el('span', 'ac-step-t');
      text.append(el('b', '', st.label), el('small', '', stepStatus(st.id, facts)));
      b.append(el('span', 'ac-step-n', String(i + 1)), text);
      b.addEventListener('click', () => go(st.id));
      bar.append(b);
    });
    return bar;
  }

  // Under the bar: the step's name and line, Save, and the status line.
  function stepHead(bot: BotView, def: PlaybookDef): HTMLElement {
    const head = el('div', 'ac-stephead');
    const st = stepOf(step);
    head.append(el('h2', '', st.label), el('p', 'ac-lead', st.lead));
    const save = el('button', 'ac-btn primary', dirty ? 'Save' : 'Saved') as HTMLButtonElement;
    save.disabled = !dirty || coaching;
    save.title = dirty ? 'Save this bot as its next version' : 'Nothing to save';
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
    head.append(save);
    if (status !== '') head.append(el('div', `ac-status${statusBad ? ' bad' : ''}`, status));
    return head;
  }

  // The foot: the way back and the way on.
  function stepNav(): HTMLElement {
    const nav = el('div', 'ac-stepnav');
    const prev = stepBefore(step);
    const next = stepAfter(step);
    const lower = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1);
    const left = el('span', '');
    if (prev) {
      const b = el('button', 'ac-btn', `Back: ${lower(prev.label)}`);
      b.addEventListener('click', () => go(prev.id));
      left.append(b);
    }
    const right = el('span', '');
    if (next) {
      const b = el('button', 'ac-btn primary', `Next: ${lower(next.label)}`);
      b.addEventListener('click', () => go(next.id));
      right.append(b);
    } else {
      const b = el('button', 'ac-btn', 'Make another bot');
      b.addEventListener('click', () => {
        if (dirty && !window.confirm('Discard the unsaved changes on this bot?')) return;
        startNew();
      });
      right.append(b);
    }
    nav.append(left, right);
    return nav;
  }

  // A champion as a card: its portrait, its name, its role.
  function champCard(id: string, on: boolean, onPick: (() => void) | null): HTMLElement {
    const c = CHAMPIONS[id];
    const card = el('button', `ac-champ${on ? ' on' : ''}`) as HTMLButtonElement;
    card.type = 'button';
    card.dataset.champion = id;
    card.disabled = onPick === null;
    const img = document.createElement('img');
    img.alt = '';
    img.addEventListener(
      'error',
      () => {
        try {
          setPortrait(img, id, 0x8ed6f0);
        } catch {
          img.remove();
        }
      },
      { once: true },
    );
    img.src = `/portraits/${id}.webp`;
    const text = el('span', 'ac-champ-t');
    text.append(el('b', '', c?.name.split(',')[0] ?? id), el('small', '', c?.role ?? ''));
    card.append(img, text);
    if (onPick) card.addEventListener('click', onPick);
    return card;
  }

  // The sigils as a grid, all four with what each does, two of them lit
  // and numbered in the order they were picked (ui/academy_steps.ts,
  // pickSigil): a bot always holds exactly two.
  function sigilGrid(
    held: readonly [string, string],
    onChange: (next: [string, string]) => void,
  ): HTMLElement {
    const grid = el('div', 'ac-sigils');
    for (const sig of SIGIL_LIST) {
      const at = held.indexOf(sig.id);
      const card = el('button', `ac-sigil${at >= 0 ? ' on' : ''}`);
      card.type = 'button';
      card.dataset.sigil = sig.id;
      card.setAttribute('aria-pressed', at >= 0 ? 'true' : 'false');
      const url = sigilImageUrl(sig.id);
      if (url) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = url;
        img.addEventListener('error', () => img.remove(), { once: true });
        card.append(img);
      }
      const text = el('span', 'ac-sigil-t');
      text.append(el('b', '', sig.name), el('small', '', SIGIL_BLURBS[sig.id] ?? ''));
      card.append(text);
      if (at >= 0) card.append(el('span', 'ac-sigil-n', String(at + 1)));
      card.title =
        at >= 0
          ? 'Held; picking another swaps the older one out'
          : 'Pick it, in place of the older one';
      card.addEventListener('click', () => onChange(pickSigil(held, sig.id)));
      grid.append(card);
    }
    return grid;
  }

  // The first step of a bot not made yet: the form, with the room the
  // rail never had, and the way a bot works said once above it.
  function newBotForm(): HTMLElement {
    const panel = el('div', 'ac-panel');
    panel.append(el('h3', '', 'A new bot'));
    panel.append(
      el(
        'p',
        'ac-lead',
        'A bot plays a seat instead of you: in the live queue while you coach it, or in the ' +
          'Arena while you are away. Its whole brain is a play list, and it starts as the ' +
          'Laner, the default playbook, on the champion you pick here; it becomes yours from ' +
          'the first edit. Name it, pick its champion and its two sigils, and the next steps ' +
          'open.',
      ),
    );
    if (botCollection === null) {
      void loadCollection().then((state) => {
        botCollection = state?.collection ?? null;
        if (creating || (!current && bots.length === 0)) renderMain();
      });
    }
    panel.append(el('div', 'ac-fieldlabel', 'Name'));
    const name = el('input', 'ac-input ac-name wide') as HTMLInputElement;
    name.placeholder = 'Name';
    name.maxLength = 24;
    name.value = draft.name;
    name.addEventListener('input', () => {
      draft.name = name.value;
    });
    panel.append(name);

    // A bot fields its owner's collection alone (ADR 0018), and the
    // rotation is deliberately not offered: a bot outlives the week it was
    // made in, and one written on a borrowed champion would stop being
    // fieldable on the turn of the week. The list is unwalled until the
    // account answers, and the server refuses either way.
    panel.append(el('div', 'ac-fieldlabel', 'Champion'));
    const owned = CHAMPION_LIST.filter((c) => !botCollection || botCollection.includes(c.id));
    if (draft.championId === null || !owned.some((c) => c.id === draft.championId)) {
      draft.championId = owned[0]?.id ?? null;
    }
    const grid = el('div', 'ac-champs');
    for (const c of owned) {
      grid.append(
        champCard(c.id, c.id === draft.championId, () => {
          draft.championId = c.id;
          renderMain();
        }),
      );
    }
    panel.append(grid);
    const picked = draft.championId ? CHAMPIONS[draft.championId] : undefined;
    panel.append(
      el(
        'p',
        'ac-champ-blurb',
        (picked ? `${picked.name}: ${picked.blurb} ` : '') +
          'A bot plays a champion from your collection; the Champions section holds the rest.',
      ),
    );

    panel.append(el('div', 'ac-fieldlabel', 'Sigils, pick two'));
    panel.append(
      sigilGrid(draft.sigils, (next) => {
        draft.sigils = next;
        renderMain();
      }),
    );

    const create = el('button', 'ac-btn primary', 'Create') as HTMLButtonElement;
    create.addEventListener('click', () => {
      const championId = draft.championId;
      if (!championId) return;
      create.disabled = true;
      void api<{ bot: BotView }>('/api/bots/create', {
        name: draft.name,
        championId,
        sigils: draft.sigils,
        skin: 0,
      }).then((r) => {
        create.disabled = false;
        if (!r.ok) {
          say(r.error, true);
          return;
        }
        const made = r.bot;
        draft.name = '';
        step = 'kit';
        void load(made.id).then(() => {
          say(
            `${made.name} is made: it starts as the Laner on ` +
              `${CHAMPIONS[made.championId]?.name.split(',')[0] ?? made.championId}. Now its kit.`,
          );
        });
      });
    });
    if (status !== '') panel.append(el('div', `ac-status${statusBad ? ' bad' : ''}`, status));
    panel.append(create);
    return panel;
  }

  // The first step of a bot that exists: what it is, and its own settings.
  function botStep(bot: BotView): HTMLElement {
    const box = el('div', '');
    const who = el('div', 'ac-panel');
    who.append(el('h3', '', 'Who it is'));
    who.append(el('div', 'ac-fieldlabel', 'Name'));
    const name = el('input', 'ac-input ac-name wide') as HTMLInputElement;
    name.value = bot.name;
    name.maxLength = 24;
    name.addEventListener('input', () => {
      bot.name = name.value;
      dirty = true;
    });
    who.append(name);
    who.append(el('div', 'ac-fieldlabel', 'Champion'));
    const champ = CHAMPIONS[bot.championId];
    const one = el('div', 'ac-champs');
    one.append(champCard(bot.championId, true, null));
    who.append(one);
    who.append(
      el(
        'p',
        'ac-champ-blurb',
        (champ ? `${champ.name}: ${champ.blurb} ` : '') +
          'A bot keeps its champion; make another bot for another one.',
      ),
    );
    who.append(el('div', 'ac-fieldlabel', 'Sigils, two of the four'));
    who.append(
      sigilGrid(bot.sigils, (next) => {
        bot.sigils = next;
        dirty = true;
        renderMain();
      }),
    );
    who.append(el('div', 'ac-fieldlabel', 'Skin'));
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
    who.append(skin);
    box.append(who);

    const own = el('div', 'ac-panel');
    own.append(el('h3', '', 'Its own settings'));
    // The playbook readable by anyone on the bot's page (CONTEXT.md).
    const open = el('label', 'ac-switch');
    const openBox = el('input', '') as HTMLInputElement;
    openBox.type = 'checkbox';
    openBox.checked = bot.openPlaybook === true;
    openBox.addEventListener('change', () => {
      void api<{ bot: BotView }>('/api/bots/open', { id: bot.id, on: openBox.checked }).then(
        (r) => {
          if (!r.ok) {
            openBox.checked = bot.openPlaybook === true;
            say(r.error, true);
            return;
          }
          bots = bots.map((b) =>
            b.id === r.bot.id ? { ...b, openPlaybook: r.bot.openPlaybook } : b,
          );
          if (current?.id === r.bot.id) current = { ...current, openPlaybook: r.bot.openPlaybook };
        },
      );
    });
    const openText = el('span', '');
    openText.append(
      el('b', '', 'Open playbook'),
      document.createTextNode("Anyone may read this playbook on the bot's page, from the ladder."),
    );
    open.append(openBox, openText);
    own.append(open);
    const row = el('div', 'ac-row');
    const history = el('button', 'ac-btn', versions ? 'Hide history' : 'History');
    history.title = 'Every saved version, and the way back to one';
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
    row.append(history, del);
    own.append(row);
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
      own.append(table);
    }
    box.append(own);
    return box;
  }

  // The playbook step: the play list, the coach beside it.
  function playbookPanel(def: PlaybookDef): HTMLElement {
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
    return list;
  }

  // The play step: the one switch that sends a bot to rated play, and the
  // live queue beside the Arena it feeds.
  function playPanel(bot: BotView): HTMLElement {
    const panel = el('div', 'ac-panel');
    panel.append(el('h3', '', 'Ranked'));
    const sw = el('label', 'ac-switch');
    const box = el('input', '') as HTMLInputElement;
    box.type = 'checkbox';
    box.checked = bot.deposited;
    box.addEventListener('change', () => {
      void api<{ bot: BotView }>('/api/bots/deposit', { id: bot.id, on: box.checked }).then((r) => {
        if (!r.ok) {
          box.checked = bot.deposited;
          say(r.error, true);
          return;
        }
        bot.deposited = r.bot.deposited;
        bots = bots.map((b) => (b.id === bot.id ? { ...b, deposited: bot.deposited } : b));
        say(bot.deposited ? `${bot.name} is ranked.` : `${bot.name} only spars now.`);
        renderRail();
        void loadArena();
      });
    });
    const text = el('span', '');
    text.append(
      el('b', '', bot.deposited ? 'Ranked: available for rated play' : 'Not ranked: it only spars'),
      document.createTextNode(
        'Ranked, the Arena plays it on the hour and whenever someone presses Play now, and ' +
          'the live queue seats it in place of a house bot. Its rating on both ladders moves ' +
          'from there. Off, it spars and nothing else.',
      ),
    );
    sw.append(box, text);
    panel.append(sw);
    const live = el('div', 'ac-row');
    if (opts.onPlay) {
      const queue = el('button', 'ac-btn', 'Queue with this bot');
      queue.title = 'The live queue: pick this bot at champion select, then coach it from the bar';
      queue.addEventListener('click', () => {
        if (dirty && !window.confirm('Discard the unsaved changes on this bot?')) return;
        close();
        opts.onPlay?.();
      });
      live.append(queue);
    }
    live.append(
      el(
        'span',
        'ac-sub',
        'In the live queue you pick the bot at champion select; it plays the seat and you ' +
          'coach it from the bar.',
      ),
    );
    panel.append(live);
    return panel;
  }

  // --- the kit: what the bot works toward (ADR 0014) ---
  const itemNames = (ids: readonly string[]): string =>
    ids.map((id) => ITEMS[id]?.name ?? id).join(', ');

  function miniTools(): {
    tools: HTMLElement;
    mk: (label: string, title: string, fn: () => void, disabled?: boolean) => void;
  } {
    const tools = el('span', 'ac-play-tools');
    const mk = (label: string, title: string, fn: () => void, disabled = false): void => {
      const b = el('button', 'ac-btn mini', label) as HTMLButtonElement;
      b.title = title;
      b.disabled = disabled || coaching;
      b.addEventListener('click', fn);
      tools.append(b);
    };
    return { tools, mk };
  }

  // A build edited by sight (playtest round 3): the items as icon slots in
  // buying order, and the shop's catalog under them, a click adding the
  // card to the build; the same item twice is two copies. The main build
  // keeps its catalog open; a variant's opens on demand.
  const catalogOpen = new Set<string>();
  function buildEditor(
    items: readonly string[],
    onChange: (next: string[]) => void,
    key = 'main',
  ): HTMLElement {
    const box = el('div', '');
    box.append(buildRow(items, { onChange, disabled: coaching }));
    const full = items.length >= MAX_BUILD;
    const open = key === 'main' || catalogOpen.has(key);
    if (!open) {
      const show = el('button', 'ac-btn mini', '+ add from the catalog');
      show.disabled = coaching || full;
      show.addEventListener('click', () => {
        catalogOpen.add(key);
        renderMain();
      });
      box.append(show);
      return box;
    }
    if (full) box.append(el('div', 'ac-sub', `A build lists at most ${MAX_BUILD} items.`));
    box.append(
      itemCatalog({
        onPick: (id) => onChange([...items, id]),
        counts: buildCounts(items),
        disabled: coaching || full,
      }),
    );
    return box;
  }

  const SKILL_ORDERS: readonly (readonly [SkillKey, SkillKey, SkillKey])[] = [
    ['Q', 'W', 'E'],
    ['Q', 'E', 'W'],
    ['W', 'Q', 'E'],
    ['W', 'E', 'Q'],
    ['E', 'Q', 'W'],
    ['E', 'W', 'Q'],
  ];
  function skillsSelect(
    current: readonly SkillKey[] | undefined,
    onChange: (next: SkillKey[] | undefined) => void,
  ): HTMLSelectElement {
    const s = el('select', 'ac-select') as HTMLSelectElement;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'as the default (Q then W then E)';
    s.append(none);
    for (const order of SKILL_ORDERS) {
      const o = document.createElement('option');
      o.value = order.join('');
      o.textContent = order.join(' then ');
      s.append(o);
    }
    s.value = current ? current.join('') : '';
    s.disabled = coaching;
    s.addEventListener('change', () =>
      onChange(s.value === '' ? undefined : (s.value.split('') as SkillKey[])),
    );
    return s;
  }

  function kitPanel(bot: BotView, def: PlaybookDef): HTMLElement {
    const panel = el('div', 'ac-panel');
    panel.append(el('h3', '', 'The kit'));
    panel.append(
      el(
        'p',
        'ac-lead',
        'What the bot works toward: its build, items in the order it buys them (the engine ' +
          'buys the pieces, sells what the build no longer wants, and past a full bag ' +
          'replaces the cheapest item; an item listed twice is bought twice), and which ' +
          'spell it maxes first. A variant swaps them while its condition holds; the first ' +
          'that holds wins, checked at every purchase.',
      ),
    );
    const kit = def.kit ?? {};
    const champ = CHAMPIONS[bot.championId];
    const role = roleBuild(bot.championId);
    // The lane the bot asks for, ahead of its home lane.
    const laneRow = el('div', 'ac-row');
    laneRow.append(el('h4', '', 'Lane'));
    const laneSel = document.createElement('select');
    // Lanes are always said in full: a bare "bot" is the owned bot
    // (CONTEXT.md, Bot lane).
    const home = homeLane(champ?.role);
    for (const [value, label] of [
      ['home', home ? `home lane (${home} lane)` : 'home lane (any)'],
      ['top', 'top lane'],
      ['mid', 'mid lane'],
      ['bot', 'bot lane'],
    ] as const) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      laneSel.append(o);
    }
    laneSel.value = def.lanes?.[0] ?? 'home';
    laneSel.disabled = coaching;
    laneSel.addEventListener('change', () => {
      const v = laneSel.value;
      editLanes(v === 'top' || v === 'mid' || v === 'bot' ? [v] : null);
    });
    laneRow.append(laneSel);
    panel.append(laneRow);
    const buildHead = el('div', 'ac-row');
    buildHead.append(el('h4', '', 'Build'));
    if (kit.build) {
      const back = el('button', 'ac-btn mini', `Back to the ${champ?.role ?? 'role'} build`);
      back.disabled = coaching;
      back.addEventListener('click', () =>
        editKit((k) => {
          delete k.build;
        }),
      );
      buildHead.append(back);
      panel.append(buildHead);
      panel.append(
        buildEditor(kit.build, (next) =>
          editKit((k) => {
            if (next.length === 0) delete k.build;
            else k.build = next;
          }),
        ),
      );
    } else {
      // The role build, shown as it will be bought; picking a card starts
      // the owner's build from it, as Write my own does.
      buildHead.append(el('span', 'ac-sub', `The ${champ?.role ?? 'role'} build`));
      const own = el('button', 'ac-btn mini', 'Write my own');
      own.disabled = coaching;
      own.addEventListener('click', () =>
        editKit((k) => {
          k.build = [...role];
        }),
      );
      buildHead.append(own);
      panel.append(buildHead);
      panel.append(buildRow(role));
      panel.append(
        itemCatalog({
          onPick: (id) =>
            editKit((k) => {
              k.build = [...role, id];
            }),
          counts: buildCounts(role),
          disabled: coaching,
        }),
      );
    }
    const skillRow = el('div', 'ac-row');
    skillRow.append(
      el('h4', '', 'Max order'),
      skillsSelect(kit.skills, (next) =>
        editKit((k) => {
          if (next) k.skills = next;
          else delete k.skills;
        }),
      ),
      el('span', 'ac-sub', 'R at levels 6, 11 and 16'),
    );
    panel.append(skillRow);
    const vHead = el('div', 'ac-row');
    vHead.append(
      el('h4', '', 'Variants'),
      el('span', 'ac-sub', 'the first whose condition holds wins'),
    );
    panel.append(vHead);
    for (const [i, v] of (kit.variants ?? []).entries()) panel.append(variantRow(v, i));
    if ((kit.variants?.length ?? 0) < MAX_VARIANTS) {
      const add = el('button', 'ac-btn mini', '+ Add a variant');
      add.disabled = coaching;
      add.addEventListener('click', () => {
        const n = kit.variants?.length ?? 0;
        editKit((k) => {
          k.variants = [
            ...(k.variants ?? []),
            { when: { kind: 'time', atLeast: 600 }, build: [...(k.build ?? role)] },
          ];
        });
        editingVariant = n;
        renderMain();
      });
      panel.append(add);
    }
    return panel;
  }

  function variantRow(v: KitVariant, i: number): HTMLElement {
    const row = el('div', 'ac-play');
    const head = el('div', 'ac-play-head');
    const text = el('span', 'ac-play-text');
    const parts: string[] = [];
    if (v.build) parts.push(`build ${itemNames(v.build)}`);
    if (v.skills) parts.push(`max ${v.skills.join(' then ')}`);
    text.append(
      el('b', '', 'when '),
      describeTrigger(v.when),
      el('b', '', ' then '),
      parts.join('; '),
    );
    const { tools, mk } = miniTools();
    mk(editingVariant === i ? 'close' : 'edit', 'Edit this variant', () => {
      editingVariant = editingVariant === i ? null : i;
      renderMain();
    });
    mk('x', 'Remove this variant', () => {
      editingVariant = null;
      editKit((k) => {
        k.variants = (k.variants ?? []).filter((_, j) => j !== i);
      });
    });
    head.append(el('span', 'ac-play-id', `variant ${i + 1}`), text, tools);
    row.append(head);
    if (editingVariant !== i) return row;
    const box = el('div', 'ac-editor');
    box.append(el('h4', '', 'When'));
    box.append(
      triggerEditor(
        v.when,
        (t) =>
          editKit((k) => {
            k.variants![i]!.when = t;
          }),
        1,
      ),
    );
    const buildHead = el('div', 'ac-row');
    buildHead.append(el('h4', '', 'Build'));
    const own = el('label', 'ac-check');
    const cb = el('input', '') as HTMLInputElement;
    cb.type = 'checkbox';
    cb.checked = v.build !== undefined;
    cb.disabled = coaching;
    cb.addEventListener('change', () =>
      editKit((k) => {
        const vv = k.variants![i]!;
        if (cb.checked) vv.build = [...(k.build ?? roleBuild(current?.championId ?? null))];
        else {
          delete vv.build;
          if (!vv.skills) vv.skills = ['Q', 'W', 'E'];
        }
      }),
    );
    own.append(cb, document.createTextNode('its own build'));
    buildHead.append(own);
    box.append(buildHead);
    if (v.build) {
      box.append(
        buildEditor(
          v.build,
          (next) =>
            editKit((k) => {
              const vv = k.variants![i]!;
              if (next.length === 0) delete vv.build;
              else vv.build = next;
            }),
          `variant-${i}`,
        ),
      );
    }
    const skillRow = el('div', 'ac-row');
    skillRow.append(
      el('h4', '', 'Max order'),
      skillsSelect(v.skills, (next) =>
        editKit((k) => {
          const vv = k.variants![i]!;
          if (next) vv.skills = next;
          else delete vv.skills;
        }),
      ),
    );
    box.append(skillRow);
    row.append(box);
    return row;
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
      c.options.forEach((opt, i) => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = c.labels?.[i] ?? opt;
        s.append(o);
      });
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
    // The column is rebuilt whole; its scroll position is not part of what
    // changed, so it comes back where it was.
    const keepScroll = side.scrollTop;
    side.textContent = '';
    if (!current || !working) return;
    const bot = current;
    const def = working;
    const stickLog = (log: HTMLElement): void => {
      if (chatStick) log.scrollTop = log.scrollHeight;
    };

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
          'until level six, then fight", "a tankier build, and max W first"). Each answer ' +
          'edits the plays, the kit and the lane as it streams; nothing is saved until you ' +
          'press Save. The conversation stays with the bot, session after session.',
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
    // Scroll events arrive a frame late, after the streamed text grew
    // again, so "at the bottom" alone would read false during a stream:
    // only a scroll UP (the reader's, never the follow's) lets go.
    let lastTop = log.scrollTop;
    log.addEventListener('scroll', () => {
      if (log.scrollTop + log.clientHeight >= log.scrollHeight - 12) chatStick = true;
      else if (log.scrollTop < lastTop - 1) chatStick = false;
      lastTop = log.scrollTop;
    });
    coach.append(log);
    // The price and the balance, both wearing the mark rather than the
    // noun (ui/balances.ts). The sentence used to say "ember" twice and
    // pluralise it by hand.
    const cost = el('div', 'ac-embers', '');
    cost.append(document.createTextNode('A turn with the coach costs '));
    cost.appendChild(balanceTag('embers', coachPrice, 12));
    if (embers >= 0) {
      cost.append(document.createTextNode('. You have '));
      cost.appendChild(balanceTag('embers', embers, 12));
    }
    cost.append(document.createTextNode('.'));
    coach.append(cost);
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
    // The Academy spends the same embers as the Forge (ADR 0017), so it
    // says the price and the balance in plain sight, next to the control
    // that spends them. A tooltip would be a number nobody reads.
    send.title = 'The coach reads the playbook and proposes changes you apply or discard';
    const submit = (): void => {
      const text = input.value.trim();
      if (text === '' || send.disabled) return;
      chatDraft = '';
      chat.push({ role: 'user', text, bubble: text });
      coaching = true;
      coachText = '';
      coachStage = '';
      coachRefused = [];
      // Sending is reading the answer: the log follows it whatever was
      // scrolled before.
      chatStick = true;
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
          // The bubble grows in place while the answer streams; `log` here is
          // whichever log the latest render built.
          const live = side.querySelector('.ac-chatlog') as HTMLElement | null;
          const bubble = live?.lastElementChild as HTMLElement | null;
          if (live && bubble) {
            bubble.textContent = coachText !== '' ? coachText : `${coachStage || 'Thinking'}...`;
            if (coachRefused.length > 0) {
              bubble.append(el('small', '', `Refused: ${coachRefused.join('; ')}`));
            }
            stickLog(live);
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

    side.scrollTop = keepScroll;
    // Last, once every panel below has taken its share and the log has its
    // final height: stuck earlier it would have been tall enough to hold
    // everything and never scrolled.
    stickLog(log);
  }

  // The sparring step (CONTEXT.md: Sparring, Record): a match against
  // house bots here, the series, the newest entry's line, the Record.
  function sparPanel(bot: BotView, def: PlaybookDef): HTMLElement {
    const sparBox = el('div', 'ac-panel ac-spar');
    sparBox.append(el('h3', '', 'Sparring'));
    sparBox.append(
      el(
        'p',
        'ac-lead',
        'A whole match against house bots, played here at full speed and unrated; or five ' +
          "seeds at once against the bot's previous version. Every match lands on the Record, " +
          'with its sheet and its replay.',
      ),
    );
    const sparBtn = el(
      'button',
      'ac-btn',
      sparRunning ? 'Sparring...' : 'Spar vs house bots',
    ) as HTMLButtonElement;
    sparBtn.disabled = sparRunning || coaching;
    sparBtn.addEventListener('click', () => {
      sparRunning = true;
      sparError = null;
      renderMain();
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
        .then((r) => postEntry(bot, r, 0, { kind: 'sparring' }))
        .then(() => loadRecord(bot.id))
        .catch((e: Error) => {
          sparError = e.message;
        })
        .finally(() => {
          sparRunning = false;
          renderMain();
        });
    });
    sparBox.append(sparBtn);
    // The series (docs/design/bots.md, the bar): five seeds, the current
    // playbook against the previous version of the same bot on the other
    // side (the saved one while an edit is unsaved, the version before
    // otherwise), house bots around both, sides alternating; against house
    // bots alone when there is no previous version yet.
    const seriesBtn = el(
      'button',
      'ac-btn',
      seriesRunning
        ? `Series: ${seriesDone} of ${SERIES_SEEDS} played...`
        : 'Spar a series (5 seeds)',
    ) as HTMLButtonElement;
    seriesBtn.disabled = seriesRunning || coaching;
    // Nothing else on this screen says who the series is against; the
    // Record's "versus" only tells you afterwards (playtest, 2026-09-03).
    seriesBtn.title = dirty
      ? `Five matches of your edit against v${bot.version} (your last save), sides alternating, house bots around both`
      : bot.version > 1
        ? `Five matches of v${bot.version} against v${bot.version - 1} (its previous version), sides alternating, house bots around both`
        : 'Five matches against house bots (no previous version to face yet)';
    seriesBtn.addEventListener('click', () => {
      seriesRunning = true;
      seriesDone = 0;
      seriesError = null;
      renderMain();
      const sparBot = {
        name: bot.name,
        championId: bot.championId,
        sigils: bot.sigils,
        skin: bot.skin,
        playbook: def,
      };
      const base = Math.floor(Math.random() * 1_000_000_000);
      const seeds = Array.from({ length: SERIES_SEEDS }, (_, i) => base + i);
      const previous: Promise<{ playbook: PlaybookDef | null; versus: string }> = dirty
        ? Promise.resolve({ playbook: bot.playbook, versus: `your edit against v${bot.version}` })
        : bot.version > 1
          ? api<{ version: { playbook: PlaybookDef } }>('/api/bots/version', {
              id: bot.id,
              version: bot.version - 1,
            }).then((r) =>
              r.ok
                ? {
                    playbook: r.version.playbook,
                    versus: `v${bot.version} against v${bot.version - 1}`,
                  }
                : { playbook: null, versus: `v${bot.version} against house bots` },
            )
          : Promise.resolve({ playbook: null, versus: `v${bot.version} against house bots` });
      void previous
        .then(({ playbook, versus }) =>
          runSeries(sparBot, playbook, seeds, (done) => {
            seriesDone = done;
            renderMain();
          }).then((matches) => {
            // Five entries sharing one series id, posted in seed order.
            const seriesId = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
            return matches
              .reduce(
                (chain, m, i) =>
                  chain.then(() =>
                    postEntry(bot, m.result, m.team, {
                      kind: 'series',
                      seriesId,
                      seriesIndex: i + 1,
                      seriesOf: matches.length,
                      versus,
                    }),
                  ),
                Promise.resolve(),
              )
              .then(() => loadRecord(bot.id));
          }),
        )
        .catch((e: Error) => {
          seriesError = e.message;
        })
        .finally(() => {
          seriesRunning = false;
          renderMain();
        });
    });
    sparBox.append(seriesBtn);
    if (seriesError) sparBox.append(el('div', 'ac-status bad', seriesError));
    if (sparError) sparBox.append(el('div', 'ac-status bad', sparError));
    // The Record's head (CONTEXT.md): the newest entry, its line and its
    // build, the way into its sheet and its replay; the whole Record is the
    // big view. Nothing to dismiss: an entry stays on the Record.
    const latest = record?.[0] ?? null;
    if (record === null) sparBox.append(el('div', 'ac-sub', 'Reading the Record...'));
    else if (latest) {
      if (latest.kind === 'series' && latest.seriesId !== undefined) {
        // The series the newest entry belongs to, summed.
        const seeds = record.filter((r) => r.seriesId === latest.seriesId);
        let wins = 0;
        let losses = 0;
        let k = 0;
        let d = 0;
        let a = 0;
        for (const r of seeds) {
          const res = resultOf(r);
          if (res.cls === 'won') wins++;
          else if (res.cls === 'lost') losses++;
          k += r.line?.kills ?? 0;
          d += r.line?.deaths ?? 0;
          a += r.line?.assists ?? 0;
        }
        const sum = el('div', 'ac-line');
        sum.append(
          el(
            'span',
            `verdict ${wins > losses ? 'won' : losses > wins ? 'lost' : ''}`,
            `${latest.versus ?? 'The series'}: ${wins} won, ${losses} lost`,
          ),
          el('span', 'kda', `${k} / ${d} / ${a}`),
          el('span', 'dim', `over ${seeds.length} seeds`),
        );
        sparBox.append(sum);
      }
      const res = resultOf(latest);
      const line = el('div', 'ac-line');
      line.append(
        el('span', 'dim', kindLabel(latest)),
        el('span', `verdict ${res.cls}`, `${res.text} after ${fmtClock(latest.ticks)}`),
      );
      if (latest.line) {
        line.append(
          el(
            'span',
            'kda',
            `${latest.line.kills} / ${latest.line.deaths} / ${latest.line.assists ?? 0}`,
          ),
          el('span', 'dim', `${latest.line.cs ?? 0} cs`),
        );
      }
      sparBox.append(line);
      if (latest.line) sparBox.append(buildIcons(latest.line.items, 26));
      const tools = el('div', 'ac-row');
      const sheetBtn = el('button', 'ac-btn mini', 'Sheet');
      sheetBtn.title = 'The match sheet: both teams, the plays, the deaths';
      sheetBtn.addEventListener('click', () => openRecord(latest.id));
      tools.append(sheetBtn);
      if (latest.replayId !== null) {
        const id = latest.replayId;
        const watch = el('button', 'ac-btn mini', 'Watch');
        watch.addEventListener('click', () => watchReplay(bot.id, id));
        tools.append(watch);
      }
      sparBox.append(tools);
    }
    // The Record read per kind rather than as one blended count: the
    // sparring a bot did against house bots said nothing about how it
    // plays, and it used to be summed with the rated matches that do.
    if (record && record.length > 0) sparBox.append(buildTallyView(recordTally));
    const recordBtn = el(
      'button',
      'ac-btn',
      record && record.length > 0
        ? `The Record (${record.length} match${record.length === 1 ? '' : 'es'})`
        : 'The Record',
    ) as HTMLButtonElement;
    recordBtn.disabled = !record || record.length === 0;
    recordBtn.addEventListener('click', () => openRecord(null));
    sparBox.append(recordBtn);
    return sparBox;
  }

  // The Arena, now: one rated match on demand for a ranked bot.
  function arenaPanel(bot: BotView): HTMLElement {
    const box = el('div', 'ac-panel');
    box.append(el('h3', '', 'The Arena'));
    box.append(
      el(
        'p',
        'ac-lead',
        'Ranked bots against each other, played by the server in seconds: a round on the ' +
          'hour, and one now from the daily allowance. Every match moves the Arena rating ' +
          'and lands on the Record.',
      ),
    );
    if (arena) {
      box.append(
        el(
          'div',
          'ac-sub',
          `${arena.pool} ranked bot${arena.pool === 1 ? '' : 's'} in the pool; the next round ` +
            `in ${Math.ceil(arena.nextRoundInMs / 60000)} min.`,
        ),
      );
    }
    const arenaBtn = el(
      'button',
      'ac-btn primary',
      arenaRunning
        ? 'Playing in the Arena...'
        : `Play now, ranked${arena && arena.left !== null ? ` (${arena.left} left today)` : ''}`,
    ) as HTMLButtonElement;
    arenaBtn.disabled =
      arenaRunning || coaching || dirty || !bot.deposited || (arena !== null && arena.left === 0);
    arenaBtn.title = dirty
      ? 'Save first: the Arena plays the saved playbook'
      : arena
        ? `${arena.pool} ranked bot(s) in the pool; next round in ${Math.ceil(arena.nextRoundInMs / 60000)} min`
        : '';
    arenaBtn.addEventListener('click', () => {
      arenaRunning = true;
      arenaResult = null;
      renderMain();
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
          renderMain();
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
        renderMain();
        void loadRecord(bot.id);
        void loadArena();
      });
    });
    box.append(arenaBtn);
    if (arenaResult) {
      box.append(el('div', 'ac-status', arenaResult.text));
      if (arenaResult.replayId !== null) {
        const id = arenaResult.replayId;
        const watch = el('button', 'ac-btn', 'Watch the Arena replay');
        watch.addEventListener('click', () => {
          close();
          window.dispatchEvent(new CustomEvent('loc:replay', { detail: id }));
        });
        box.append(watch);
      }
    }
    if (!bot.deposited) {
      box.append(el('div', 'ac-sub', 'Rank the bot above to enter it.'));
    }
    return box;
  }

  // The Briefing (docs/design/bots.md): what the Arena did to this bot
  // since yesterday, play by play, and the night coach's proposal with
  // what sparring said about it.
  function briefPanel(bot: BotView): HTMLElement {
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
        renderMain();
        void api<BriefingView>('/api/bots/briefing', { id: bot.id }).then((r) => {
          briefingLoading = false;
          if (!r.ok) {
            say(r.error, true);
            renderMain();
            return;
          }
          briefing = r;
          renderMain();
        });
      });
      brief.append(
        el(
          'p',
          'ac-lead',
          'The Arena plays ranked bots on the hour and whenever someone presses Play now; the coach reads the last day. ' +
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
        renderMain();
      });
      brief.append(auto, refresh);
    }
    return brief;
  }

  function renderRecord(): void {
    const open = recordOpen && current !== null;
    main.style.display = open ? 'none' : '';
    side.style.display = open || !sideWanted() ? 'none' : '';
    recordBox.style.display = open ? 'flex' : 'none';
    if (!open || !current) return;
    const bot = current;
    renderRecordView(recordBox, {
      bot: { id: bot.id, name: bot.name },
      rows: record ?? [],
      tally: recordTally,
      openId: recordOpenId,
      fetchEntry: (id) =>
        api<{ entry: RecordEntry }>('/api/bots/record/entry', { id: bot.id, entryId: id }).then(
          (r) => (r.ok ? r.entry : null),
        ),
      onWatch: (replayId, tick, follow) => watchReplay(bot.id, replayId, tick, follow),
      onBack: closeRecord,
    });
  }

  function renderAll(): void {
    renderRail();
    renderMain();
    renderSide();
    renderRecord();
  }

  renderAll();
  void load(opts.botId ?? null);
  return close;
}
