// A bot's page (CONTEXT.md: Bot page, Challenge): what anyone signed in
// may read of a bot on the ladder before playing it: who owns it, its
// champion, its tally and its ratings by tier, its rated matches with
// their lines and builds (each with its replay), and its playbook when
// the owner opened it. From the page, a challenge: the reader's own bot
// against this one, now, on the server, unrated. A modal over whatever is
// open; pure DOM, the data from /api/bots/page and /api/bots/challenge.

import type { RecordRow } from '../net/record';
import { tierOf } from '../net/tiers';
import { CHAMPIONS } from '../sim/content/champions';
import type { PlaybookDef } from '../sim/playbook/types';
import { el } from './menu';
import { describeBehavior, describeTrigger } from './playbook_text';
import { fmtClock, fmtWhen, kindLabel, resultOf } from './record_view';
import { buildIcons } from './scoreboard_table';

const CSS = `
.bp-back { position: fixed; inset: 0; z-index: 40; background: rgba(3, 6, 8, 0.78); display: flex; align-items: center; justify-content: center; }
.bp {
  width: min(880px, 94vw); max-height: 90vh; overflow-y: auto; border-radius: 12px;
  background: #0a1319; border: 1px solid #2c4d60; color: #c8d6e0; font-family: system-ui, sans-serif;
  font-size: 12.5px; padding: 16px 20px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
}
.bp h2 { margin: 0; font-size: 18px; color: #8ed6f0; }
.bp h4 { margin: 14px 0 4px; font-size: 11px; color: #6cc3e0; text-transform: uppercase; letter-spacing: 0.5px; }
.bp-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.bp-sub { color: #7f9cae; }
.bp-close { margin-left: auto; padding: 4px 10px; border-radius: 6px; border: 1px solid #2c4d60; background: #0c161d; color: #d8e4ec; cursor: pointer; font-family: inherit; font-size: 12px; }
.bp-line { display: flex; gap: 14px; flex-wrap: wrap; margin: 8px 0; }
.bp-line b { color: #e0c070; }
.bp-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.bp-table th { text-align: left; color: #6cc3e0; font-size: 10.5px; text-transform: uppercase; padding: 4px 6px; border-bottom: 1px solid #1f3644; }
.bp-table td { padding: 4px 6px; border-bottom: 1px solid #132530; vertical-align: middle; }
.bp-table td.num { text-align: right; white-space: nowrap; }
.bp-won { color: #9fe0a8; font-weight: 700; }
.bp-lost { color: #f0a090; font-weight: 700; }
.bp .hud-score-build { display: flex; gap: 2px; }
.bp .hud-score-build img { border-radius: 3px; border: 1px solid #2c4d60; background: #070d12; display: block; }
.bp .hud-score-build .slot { display: block; border-radius: 3px; border: 1px dashed #1f3644; background: #070d12; }
.bp-play { padding: 3px 0; border-bottom: 1px solid #132530; }
.bp-play b { color: #8ed6f0; margin-right: 6px; }
.bp-play i { color: #e0c070; font-style: normal; }
.bp-btn { padding: 5px 10px; border-radius: 6px; border: 1px solid #2c4d60; background: #0c161d; color: #d8e4ec; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 700; margin-right: 6px; }
.bp-btn.primary { background: linear-gradient(180deg, #8ed6f0 0%, #4fa8c8 55%, #2c7590 100%); color: #06141c; border-color: #b8e8f8; }
.bp-btn:disabled { opacity: 0.4; cursor: default; }
.bp-select { padding: 5px 8px; border-radius: 6px; border: 1px solid #1f3644; background: #070d12; color: #d8e4ec; font-size: 12px; margin-right: 6px; }
.bp-status { color: #e0c070; margin: 6px 0; min-height: 16px; }
.bp-status.bad { color: #f09090; }
.bp-empty { color: #5f8299; padding: 6px 0; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface BotPageData {
  bot: {
    id: string;
    name: string;
    championId: string;
    skin: number;
    sigils: [string, string];
    version: number;
    ranked: boolean;
    openPlaybook: boolean;
    owner: string | null;
    accountId: number;
    mine: boolean;
  };
  tally: { wins: number; losses: number };
  ratings: { live: { rating: number; games: number }; arena: { rating: number; games: number } };
  rows: RecordRow[];
  playbook?: PlaybookDef;
}

type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string };

async function post<T>(path: string, body: unknown): Promise<Outcome<T>> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Outcome<T>;
  } catch {
    return { ok: false, error: 'the server did not answer' };
  }
}

function ratingLine(label: string, r: { rating: number; games: number }): HTMLElement {
  const span = el('span', '');
  span.append(
    document.createTextNode(`${label}: `),
    el('b', '', `${tierOf(r.rating).name} ${r.rating}`),
    document.createTextNode(` over ${r.games} rated`),
  );
  return span;
}

function playbookView(def: PlaybookDef): HTMLElement {
  const box = el('div', '');
  for (const p of def.plays) {
    const row = el('div', 'bp-play');
    const name = el('b', '', p.id);
    const when = el('span', '');
    when.append(el('i', '', 'when '), document.createTextNode(describeTrigger(p.when)));
    const does = el('span', '');
    does.append(el('i', '', ' do '), document.createTextNode(describeBehavior(p.do)));
    row.append(name, when, does);
    if (p.enabled === false) row.style.opacity = '0.5';
    box.append(row);
  }
  if (def.kit?.build) {
    const kit = el('div', 'bp-line');
    kit.append(el('span', 'bp-sub', 'Build:'));
    kit.append(buildIcons(def.kit.build.slice(0, 6), 22));
    if (def.kit.build.length > 6) kit.append(el('span', 'bp-sub', `+${def.kit.build.length - 6}`));
    box.append(kit);
  }
  if (def.lanes && def.lanes.length > 0) {
    box.append(
      el('div', 'bp-sub', `Lane preference: ${def.lanes.map((l) => `${l} lane`).join(', then ')}`),
    );
  }
  return box;
}

export interface BotPageOptions {
  // The reader's own bots, for the challenge; none hides it.
  myBots?: { id: string; name: string; championId: string }[];
  // Open a replay, following the given unit (the row's own bot) when the
  // caller can say which seat that is (src/game/replay_seat.ts).
  onWatch?: (replayId: number, follow?: number) => void;
}

export function openBotPage(
  container: HTMLElement,
  botId: string,
  opts: BotPageOptions = {},
): void {
  ensureCss();
  const back = el('div', 'bp-back');
  const box = el('div', 'bp');
  back.append(box);
  const close = (): void => {
    window.removeEventListener('keydown', onKey);
    back.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  box.append(el('div', 'bp-empty', 'Reading the bot...'));
  container.append(back);

  void post<BotPageData>('/api/bots/page', { id: botId }).then((r) => {
    box.textContent = '';
    const head = el('div', 'bp-head');
    const closeBtn = el('button', 'bp-close', 'Close');
    closeBtn.addEventListener('click', close);
    if (!r.ok) {
      head.append(el('h2', '', 'No such bot'), closeBtn);
      box.append(head, el('div', 'bp-empty', r.error));
      return;
    }
    const b = r.bot;
    const champ = CHAMPIONS[b.championId];
    head.append(
      el('h2', '', b.name),
      el(
        'span',
        'bp-sub',
        `${champ?.name.split(',')[0] ?? b.championId}, v${b.version}, ${b.owner ?? 'nobody'}'s` +
          `${b.ranked ? ', ranked' : ', not ranked'}`,
      ),
      closeBtn,
    );
    box.append(head);
    const line = el('div', 'bp-line');
    const tally = el('span', '');
    tally.append(
      document.createTextNode('Rated play: '),
      el('b', '', `${r.tally.wins} won, ${r.tally.losses} lost`),
    );
    line.append(tally, ratingLine('Live', r.ratings.live), ratingLine('Arena', r.ratings.arena));
    box.append(line);

    // The challenge: the reader's bot against this one.
    if (!b.mine && opts.myBots && opts.myBots.length > 0 && b.ranked) {
      const row = el('div', 'bp-line');
      const sel = el('select', 'bp-select') as HTMLSelectElement;
      for (const mine of opts.myBots) {
        const o = document.createElement('option');
        o.value = mine.id;
        o.textContent = `${mine.name} (${CHAMPIONS[mine.championId]?.name.split(',')[0] ?? mine.championId})`;
        sel.append(o);
      }
      const go = el('button', 'bp-btn primary', 'Challenge') as HTMLButtonElement;
      go.title =
        'Your bot against this one, now, on the server, unrated (from the daily allowance)';
      const status = el('div', 'bp-status');
      go.addEventListener('click', () => {
        go.disabled = true;
        status.className = 'bp-status';
        status.textContent = 'Playing...';
        void post<{
          winner: 0 | 1 | null;
          ticks: number;
          replayId?: number;
        }>('/api/bots/challenge', { id: sel.value, target: b.id }).then((c) => {
          go.disabled = false;
          if (!c.ok) {
            status.className = 'bp-status bad';
            status.textContent = c.error;
            return;
          }
          status.textContent =
            (c.winner === 0 ? 'Your bot won' : c.winner === 1 ? 'Your bot lost' : 'No winner') +
            ` after ${fmtClock(c.ticks)}, unrated.`;
          if (c.replayId !== undefined && opts.onWatch) {
            const id = c.replayId;
            const watch = el('button', 'bp-btn', 'Watch');
            watch.addEventListener('click', () => {
              close();
              opts.onWatch?.(id);
            });
            status.append(document.createTextNode(' '), watch);
          }
        });
      });
      row.append(sel, go);
      box.append(el('h4', '', 'Challenge'), row, status);
    }

    box.append(el('h4', '', 'Rated matches'));
    if (r.rows.length === 0) box.append(el('div', 'bp-empty', 'No rated match yet.'));
    else {
      const table = el('table', 'bp-table');
      const hr = el('tr', '');
      for (const h of ['Kind', 'Result', 'K / D / A', 'Build', 'When', ''])
        hr.append(el('th', '', h));
      table.append(hr);
      for (const row of r.rows) {
        const res = resultOf(row);
        const tr = el('tr', '');
        tr.append(
          el('td', '', kindLabel(row)),
          el(
            'td',
            res.cls === 'won' ? 'bp-won' : res.cls === 'lost' ? 'bp-lost' : '',
            `${res.text} ${fmtClock(row.ticks)}`,
          ),
          el(
            'td',
            'num',
            row.line ? `${row.line.kills} / ${row.line.deaths} / ${row.line.assists ?? 0}` : '',
          ),
        );
        const build = el('td', '');
        build.append(buildIcons(row.line?.items, 20));
        tr.append(build, el('td', 'bp-sub', fmtWhen(row.at)));
        const cell = el('td', 'num');
        if (row.replayId !== null && opts.onWatch) {
          const id = row.replayId;
          const watch = el('button', 'bp-btn', 'Watch');
          watch.addEventListener('click', () => {
            close();
            opts.onWatch?.(id, row.botUnitId);
          });
          cell.append(watch);
        }
        tr.append(cell);
        table.append(tr);
      }
      box.append(table);
    }

    box.append(el('h4', '', 'Playbook'));
    if (r.playbook) box.append(playbookView(r.playbook));
    else box.append(el('div', 'bp-empty', 'The owner keeps this playbook closed.'));
  });
}
