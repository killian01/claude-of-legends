// The ladder panel on the home screen: the top of each ladder (ADR 0013:
// by hand, bots live, bots in the Arena), from /api/ladder, each row
// expandable into that player's public profile. Pure DOM, rebuilt fresh on
// every open like the career panel.

import { buildPublicProfilePanel } from './profile_panel';

const CSS = `
.lad-panel { margin: 8px 0; font-size: 12px; color: #c9d8ae; text-align: left; }
.lad-tabs { display: flex; gap: 6px; margin-bottom: 6px; }
.lad-tab {
  padding: 4px 10px; border-radius: 6px; border: 1px solid #3a4f28; background: #17210f;
  color: #93a87c; cursor: pointer; font-size: 11.5px; font-weight: 700;
}
.lad-tab.on { color: #e8dfae; border-color: #7ca050; background: #22301a; }
.lad-row {
  display: flex; justify-content: space-between; gap: 10px; width: 100%;
  padding: 5px 8px; border: 1px solid #3a4f28; border-radius: 6px; margin-top: 4px;
  background: #17210f; color: #d8e6c0; cursor: pointer; font-size: 12px;
}
.lad-row:hover { border-color: #7ca050; }
.lad-rank { color: #c9a84a; font-weight: 800; width: 26px; flex: none; }
.lad-name { flex: 1; text-align: left; font-weight: 600; }
.lad-rating { color: #e8dfae; font-weight: 700; }
.lad-games { color: #93a87c; }
.lad-sub { color: #93a87c; margin: 4px 0; }
.lad-detail { margin: 2px 0 6px 12px; }
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

interface LadderRow {
  rank: number;
  id: number;
  name: string;
  rating: number;
  ratedGames: number;
}

type Way = 'hand' | 'bot' | 'arena';

const WAYS: readonly { way: Way; label: string; empty: string }[] = [
  {
    way: 'hand',
    label: 'By hand',
    empty:
      'Nobody has placed yet. A match is rated with an owned seat on each side; three ' +
      'rated matches place you.',
  },
  {
    way: 'bot',
    label: 'Bots, live',
    empty: 'No bot has placed yet. Queue with a bot; three rated matches place it.',
  },
  {
    way: 'arena',
    label: 'Arena',
    empty: 'The Arena has not run yet.',
  },
];

function fill(list: HTMLElement, way: Way): void {
  list.textContent = 'Loading ladder...';
  const url = way === 'hand' ? '/api/ladder' : `/api/ladder?way=${way}`;
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<LadderRow[]>) : null))
    .then((rows) => {
      list.textContent = '';
      if (!rows || rows.length === 0) {
        const sub = document.createElement('div');
        sub.className = 'lad-sub';
        sub.textContent = WAYS.find((w) => w.way === way)?.empty ?? '';
        list.appendChild(sub);
        return;
      }
      for (const row of rows) {
        const btn = document.createElement('button');
        btn.className = 'lad-row';
        const mk = (cls: string, text: string): HTMLElement => {
          const s = document.createElement('span');
          s.className = cls;
          s.textContent = text;
          return s;
        };
        btn.append(
          mk('lad-rank', String(row.rank)),
          mk('lad-name', row.name),
          mk('lad-rating', String(row.rating)),
          mk('lad-games', `${row.ratedGames} rated`),
        );
        const detail = document.createElement('div');
        detail.className = 'lad-detail';
        detail.style.display = 'none';
        let built = false;
        btn.addEventListener('click', () => {
          const open = detail.style.display === 'none';
          detail.style.display = open ? 'block' : 'none';
          if (open && !built) {
            built = true;
            detail.appendChild(buildPublicProfilePanel(row.id));
          }
        });
        list.append(btn, detail);
      }
    })
    .catch(() => {
      list.textContent = 'Ladder unavailable: the game server is not reachable.';
    });
}

export function buildLadderPanel(): HTMLElement {
  ensureCss();
  const box = document.createElement('div');
  box.className = 'lad-panel';
  const tabs = document.createElement('div');
  tabs.className = 'lad-tabs';
  const list = document.createElement('div');
  const buttons: HTMLButtonElement[] = [];
  let current: Way = 'hand';
  for (const w of WAYS) {
    const b = document.createElement('button');
    b.className = 'lad-tab';
    b.textContent = w.label;
    b.addEventListener('click', () => {
      current = w.way;
      for (const other of buttons) other.classList.toggle('on', other === b);
      fill(list, current);
    });
    buttons.push(b);
    tabs.appendChild(b);
  }
  buttons[0]?.classList.add('on');
  box.append(tabs, list);
  fill(list, current);
  return box;
}
