// The Record and the Match sheet (CONTEXT.md, playtest round 3): a bot's
// matches as a list, newest first, filtered by kind, beside the sheet of
// the selected one: both teams' scoreboard with their builds, time and
// deaths per play, and the bot's deaths with their minute and the play
// that held, each a link into the replay a few seconds before. A view of
// one bot, drawn into the space the Academy hands it; the data comes from
// the server (server/bot_records.ts) through the callbacks.

import type { RecordEntry, RecordKind, RecordRow, RecordTallies } from '../net/record';
import { CHAMPIONS } from '../sim/content/champions';
import { type DeathScene, SCENE_RADIUS } from '../sim/playbook/death_context';
import type { ScoreRow, TeamId } from '../sim/types';
import { el } from './menu';
import { buildIcons } from './scoreboard_table';

const CSS = `
.rv { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.rv-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
.rv-head h2 { margin: 0; font-size: 16px; color: #8ed6f0; font-weight: 800; }
.rv-tally { color: #e0c070; font-weight: 800; font-size: 14px; }
.rv-filters { display: flex; gap: 4px; margin-left: auto; }
.rv-filters button, .rv-back {
  padding: 4px 10px; border-radius: 6px; border: 1px solid #2c4d60; background: #0c161d;
  color: #d8e4ec; font-size: 11.5px; font-weight: 700; cursor: pointer; font-family: inherit;
}
.rv-filters button.on { border-color: #8ed6f0; background: #122431; color: #8ed6f0; }
.rv-body { display: flex; gap: 14px; flex: 1; min-height: 0; }
.rv-list { flex: 1.1; min-width: 0; overflow-y: auto; }
.rv-sheet { flex: 1; min-width: 0; overflow-y: auto; }
.rv-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.rv-table th { text-align: left; color: #6cc3e0; font-size: 10.5px; text-transform: uppercase; padding: 4px 6px; border-bottom: 1px solid #1f3644; }
.rv-table td { padding: 5px 6px; border-bottom: 1px solid #132530; vertical-align: middle; }
.rv-table tr.row { cursor: pointer; }
.rv-table tr.row:hover td { background: #0e1a21; }
.rv-table tr.row.sel td { background: #122431; }
.rv-table td.num { text-align: right; white-space: nowrap; }
.rv-kind { color: #7f9cae; white-space: nowrap; }
.rv-res { font-weight: 800; white-space: nowrap; }
.rv-res.won { color: #9fe0a8; }
.rv-res.lost { color: #f0a090; }
.rv-kda { font-weight: 800; color: #e0c070; white-space: nowrap; }
.rv-when { color: #5f8299; white-space: nowrap; font-size: 10.5px; }
.rv .hud-score-build { display: flex; gap: 2px; }
.rv .hud-score-build img { border-radius: 3px; border: 1px solid #2c4d60; background: #070d12; display: block; }
.rv .hud-score-build .slot { display: block; border-radius: 3px; border: 1px dashed #1f3644; background: #070d12; }
.rv-line { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 4px 0 8px; }
.rv-line .big { font-size: 15px; font-weight: 800; color: #e0ecf3; }
.rv-line .dim { color: #7f9cae; }
.rv-sheet h4 { margin: 12px 0 4px; font-size: 11px; color: #6cc3e0; text-transform: uppercase; letter-spacing: 0.5px; }
.rv-team { color: #8fa6b6; font-size: 10.5px; margin: 6px 0 2px; }
.rv-team.blue { color: #7fb8ff; }
.rv-team.red { color: #ff9a8a; }
.rv-table tr.self td { background: #0f2029; }
.rv-empty { color: #5f8299; padding: 12px 0; font-size: 12px; }
.rv-btn {
  display: inline-block; margin: 2px 6px 2px 0; padding: 5px 10px; border-radius: 6px;
  border: 1px solid #2c4d60; background: #0c161d; color: #d8e4ec; font-size: 11.5px;
  font-weight: 700; cursor: pointer; font-family: inherit;
}
.rv-btn:hover:not(:disabled) { border-color: #8ed6f0; }
.rv-btn:disabled { opacity: 0.4; cursor: default; }
.rv-btn.mini { padding: 1px 7px; font-size: 10.5px; }
.rv-card { display: flex; align-items: center; gap: 6px; }
.rv-card-map { width: 56px; height: 56px; border-radius: 4px; flex: none; }
.rv-card-words { color: #8fa6b6; font-size: 11px; line-height: 1.3; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const KIND_LABEL: Record<RecordKind, string> = {
  sparring: 'Sparring',
  series: 'Series',
  arena: 'Arena',
  live: 'Live',
};

const FILTERS: readonly (readonly [RecordKind | 'all', string])[] = [
  ['all', 'All'],
  ['sparring', 'Sparring'],
  ['series', 'Series'],
  ['arena', 'Arena'],
  ['live', 'Live'],
];

export function fmtClock(ticks: number): string {
  const s = Math.max(0, Math.round(ticks / 20));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtWhen(at: number, now = Date.now()): string {
  const d = now - at;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function kindLabel(r: {
  kind: RecordKind;
  seriesIndex?: number;
  seriesOf?: number;
}): string {
  if (r.kind === 'series' && r.seriesIndex !== undefined && r.seriesOf !== undefined) {
    return `Series ${r.seriesIndex}/${r.seriesOf}`;
  }
  return KIND_LABEL[r.kind];
}

export function resultOf(r: { team: TeamId; winner: TeamId | null }): {
  cls: 'won' | 'lost' | '';
  text: string;
} {
  if (r.winner === null) return { cls: '', text: 'No winner' };
  return r.winner === r.team ? { cls: 'won', text: 'Won' } : { cls: 'lost', text: 'Lost' };
}

// The result and the line in one row of words: "Won 18:32, 7 / 3 / 5".
function kda(line: ScoreRow | null): string {
  return line ? `${line.kills} / ${line.deaths} / ${line.assists ?? 0}` : '';
}

export interface RecordViewOptions {
  bot: { id: string; name: string };
  rows: readonly RecordRow[];
  tally: RecordTallies;
  // The entry to open first; the newest otherwise.
  openId?: number | null;
  fetchEntry: (id: number) => Promise<RecordEntry | null>;
  // Open the replay, at a tick when one is given (a death, a few seconds
  // before it), following the entry's own unit (both versions of one bot
  // can be in a series match; the picks alone cannot say which is which).
  onWatch: (replayId: number, tick?: number, follow?: number) => void;
  onBack: () => void;
}

// The Death card (CONTEXT.md): the scene of a death in words ("alone,
// three enemies within twenty, under their tower") and as a thumbnail of
// the map around the spot, allies blue, enemies red, structures square.
export function sceneWords(s: DeathScene): string {
  const parts: string[] = [];
  parts.push(s.allies === 0 ? 'alone' : `${s.allies} ${s.allies === 1 ? 'ally' : 'allies'} near`);
  parts.push(
    s.enemies === 0 ? 'no enemy near' : `${s.enemies} ${s.enemies === 1 ? 'enemy' : 'enemies'}`,
  );
  if (s.underTower) parts.push('under their tower');
  return parts.join(', ');
}

export function deathCard(s: DeathScene, ownTeam: TeamId): HTMLElement {
  const card = el('div', 'rv-card');
  const canvas = document.createElement('canvas');
  const size = 56;
  canvas.width = size;
  canvas.height = size;
  canvas.className = 'rv-card-map';
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Forty units of map across the card, the death at its center; +z up
    // on screen, as the camera shows the map.
    const span = SCENE_RADIUS * 2;
    const px = (x: number): number => ((x - s.x) / span + 0.5) * size;
    const pz = (z: number): number => (0.5 - (z - s.z) / span) * size;
    ctx.fillStyle = '#0b141a';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#1f3644';
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    for (const u of s.around) {
      const ally = u.team === ownTeam;
      ctx.fillStyle = ally ? '#4f8fd6' : '#d65c4f';
      const x = px(u.x);
      const z = pz(u.z);
      if (u.kind === 'champion') {
        ctx.beginPath();
        ctx.arc(x, z, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x - 3, z - 3, 6, 6);
      }
    }
    // The dead champion: a hollow ring at the center.
    ctx.strokeStyle = '#ffd94a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  canvas.title = `at ${s.x}, ${s.z}: ${sceneWords(s)}`;
  card.append(canvas, el('span', 'rv-card-words', sceneWords(s)));
  return card;
}

// One team's rows of a sheet: player, champion, level, K/D/A, CS, the build.
function teamTable(rows: readonly ScoreRow[], team: TeamId, selfId: number): HTMLElement {
  const table = el('table', 'rv-table');
  const head = el('tr', '');
  for (const h of ['Seat', 'Champion', 'Lv', 'K / D / A', 'CS', 'Build']) {
    head.append(el('th', '', h));
  }
  table.append(head);
  for (const r of rows.filter((x) => x.team === team)) {
    const tr = el('tr', r.unitId === selfId ? 'self' : '');
    tr.append(
      el('td', '', r.player ?? r.name),
      el('td', '', CHAMPIONS[r.championId]?.name.split(',')[0] ?? r.name),
      el('td', 'num', String(r.level)),
      el('td', 'num rv-kda', kda(r)),
      el('td', 'num', String(r.cs ?? 0)),
    );
    const cell = el('td', '');
    cell.append(buildIcons(r.items, 22));
    tr.append(cell);
    table.append(tr);
  }
  return table;
}

export function sheet(entry: RecordEntry, opts: RecordViewOptions): HTMLElement {
  const box = el('div', '');
  const res = resultOf(entry);
  const line = entry.score.find((r) => r.unitId === entry.botUnitId) ?? null;
  const head = el('div', 'rv-line');
  head.append(
    el('span', `big rv-res ${res.cls}`, `${res.text} after ${fmtClock(entry.ticks)}`),
    el('span', 'rv-kda big', kda(line)),
    el('span', 'dim', `${line?.cs ?? 0} cs`),
    el(
      'span',
      'dim',
      `${kindLabel(entry)}${entry.versus ? `, ${entry.versus}` : ''}, v${entry.version}${entry.edited ? ' (unsaved edit)' : ''}` +
        (entry.ratingDelta !== undefined
          ? `, ${entry.ratingDelta >= 0 ? '+' : ''}${entry.ratingDelta} rating`
          : ''),
    ),
  );
  box.append(head);
  if (line) box.append(buildIcons(line.items, 28));
  const tools = el('div', '');
  const watch = el('button', 'rv-btn', 'Watch the replay') as HTMLButtonElement;
  if (entry.replayId === null) {
    watch.disabled = true;
    watch.title = 'No replay was kept for this match';
  } else {
    const id = entry.replayId;
    watch.addEventListener('click', () => opts.onWatch(id, undefined, entry.botUnitId));
  }
  tools.append(watch);
  box.append(tools);

  box.append(el('h4', '', 'Scoreboard'));
  for (const team of [0, 1] as const) {
    box.append(
      el(
        'div',
        `rv-team ${team === 0 ? 'blue' : 'red'}`,
        `${team === 0 ? 'Blue' : 'Red'} side${team === entry.team ? ' (the bot)' : ''}`,
      ),
    );
    box.append(teamTable(entry.score, team, entry.botUnitId));
  }

  const mine = entry.report.units.find((u) => u.unitId === entry.botUnitId);
  box.append(el('h4', '', 'Plays'));
  if (mine && Object.keys(mine.plays).length > 0) {
    const table = el('table', 'rv-table');
    const hr = el('tr', '');
    for (const h of ['Play', 'Time', 'Deaths']) hr.append(el('th', '', h));
    table.append(hr);
    for (const [id, st] of Object.entries(mine.plays).sort((a, b) => b[1].ticks - a[1].ticks)) {
      const tr = el('tr', '');
      tr.append(
        el('td', '', id),
        el('td', 'num', fmtClock(st.ticks)),
        el('td', 'num', String(st.deaths)),
      );
      table.append(tr);
    }
    box.append(table);
  } else box.append(el('div', 'rv-empty', 'No plays were recorded for this seat.'));

  box.append(el('h4', '', 'Deaths'));
  const deaths = mine?.deathsAt ?? [];
  if (deaths.length === 0) {
    box.append(
      el('div', 'rv-empty', mine ? 'No deaths.' : 'The deaths of this match were not dated.'),
    );
  } else {
    const table = el('table', 'rv-table');
    const hr = el('tr', '');
    for (const h of ['At', 'Play', 'Killed by', 'Scene', '']) hr.append(el('th', '', h));
    table.append(hr);
    const nameOf = (unitId: number): string => {
      const r = entry.score.find((x) => x.unitId === unitId);
      return r ? (r.player ?? r.name) : unitId === 0 ? 'the map' : `unit ${unitId}`;
    };
    for (const d of deaths) {
      const tr = el('tr', '');
      tr.append(
        el('td', 'num', fmtClock(d.tick)),
        el('td', '', d.play ?? 'no play'),
        el('td', '', nameOf(d.killerId)),
      );
      // The Death card: the scene in words and as a thumbnail of the map.
      const scene = el('td', 'rv-scene');
      if (d.scene) {
        scene.append(deathCard(d.scene, entry.team));
      } else scene.append(el('span', 'dim', 'not recorded'));
      tr.append(scene);
      const cell = el('td', 'num');
      if (entry.replayId !== null) {
        const id = entry.replayId;
        const go = el('button', 'rv-btn mini', 'Watch');
        go.title = 'Open the replay a few seconds before';
        // Five seconds before the death: the fight is on screen.
        go.addEventListener('click', () =>
          opts.onWatch(id, Math.max(0, d.tick - 100), entry.botUnitId),
        );
        cell.append(go);
      }
      tr.append(cell);
      table.append(tr);
    }
    box.append(table);
  }
  return box;
}

// The whole view, drawn into `into` (cleared). Returns a handle to redraw
// with fresh rows.
export function renderRecordView(into: HTMLElement, opts: RecordViewOptions): void {
  ensureCss();
  into.textContent = '';
  const root = el('div', 'rv');
  let filter: RecordKind | 'all' = 'all';
  let selected: number | null =
    opts.openId ?? (opts.rows.length > 0 ? (opts.rows[0]?.id ?? null) : null);
  const cache = new Map<number, RecordEntry | null>();

  // The head counts what the filter is showing, so switching to Sparring
  // never leaves the rated number standing over a list of sparring.
  const tallyText = el('span', 'rv-tally', '');
  const drawTally = (): void => {
    const t = filter === 'all' ? opts.tally.rated : opts.tally[filter];
    const label = filter === 'all' ? 'rated' : KIND_LABEL[filter].toLowerCase();
    tallyText.textContent =
      t.games === 0 ? `no ${label} match yet` : `${t.wins} won, ${t.losses} lost, ${label}`;
  };
  drawTally();

  const head = el('div', 'rv-head');
  head.append(el('h2', '', `The Record of ${opts.bot.name}`), tallyText);
  const filters = el('div', 'rv-filters');
  // The Record opens from the sparring step, and closes back onto it.
  const back = el('button', 'rv-back', 'Back to sparring');
  back.addEventListener('click', opts.onBack);
  head.append(filters, back);
  const body = el('div', 'rv-body');
  const list = el('div', 'rv-list');
  const sheetBox = el('div', 'rv-sheet');
  body.append(list, sheetBox);
  root.append(head, body);
  into.append(root);

  const drawFilters = (): void => {
    filters.textContent = '';
    for (const [kind, label] of FILTERS) {
      const b = el('button', kind === filter ? 'on' : '', label);
      b.addEventListener('click', () => {
        filter = kind;
        drawTally();
        drawFilters();
        drawList();
      });
      filters.append(b);
    }
  };

  const drawSheet = (): void => {
    sheetBox.textContent = '';
    if (selected === null) {
      sheetBox.append(el('div', 'rv-empty', 'Pick a match on the left to read its sheet.'));
      return;
    }
    const id = selected;
    const cached = cache.get(id);
    if (cached) {
      sheetBox.append(sheet(cached, opts));
      return;
    }
    if (cached === null) {
      sheetBox.append(el('div', 'rv-empty', 'This entry could not be read.'));
      return;
    }
    sheetBox.append(el('div', 'rv-empty', 'Reading the sheet...'));
    void opts.fetchEntry(id).then((entry) => {
      cache.set(id, entry);
      if (selected === id) drawSheet();
    });
  };

  const drawList = (): void => {
    list.textContent = '';
    const rows = opts.rows.filter((r) => filter === 'all' || r.kind === filter);
    if (rows.length === 0) {
      list.append(
        el(
          'div',
          'rv-empty',
          opts.rows.length === 0
            ? 'Nothing played yet. Spar the bot, or send it to the Arena.'
            : 'No match of that kind yet.',
        ),
      );
      return;
    }
    const table = el('table', 'rv-table');
    const hr = el('tr', '');
    for (const h of ['Kind', 'Result', 'K / D / A', 'Build', 'Version', 'When']) {
      hr.append(el('th', '', h));
    }
    table.append(hr);
    for (const r of rows) {
      const res = resultOf(r);
      const tr = el('tr', `row${r.id === selected ? ' sel' : ''}`);
      tr.dataset.entry = String(r.id);
      tr.append(
        el('td', 'rv-kind', kindLabel(r)),
        el('td', `rv-res ${res.cls}`, `${res.text} ${fmtClock(r.ticks)}`),
        el('td', 'rv-kda num', kda(r.line)),
      );
      const build = el('td', '');
      build.append(buildIcons(r.line?.items, 20));
      tr.append(
        build,
        el('td', 'num', `v${r.version}${r.edited ? '*' : ''}`),
        el('td', 'rv-when', fmtWhen(r.at)),
      );
      tr.addEventListener('click', () => {
        selected = r.id;
        drawList();
        drawSheet();
      });
      table.append(tr);
    }
    list.append(table);
  };

  drawFilters();
  drawList();
  drawSheet();
}
