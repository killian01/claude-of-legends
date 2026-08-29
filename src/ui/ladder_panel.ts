// The ladder panel on the home screen: top players by rating from
// /api/ladder, each row expandable into that player's public profile.
// Pure DOM, rebuilt fresh on every open like the career panel.

import { buildPublicProfilePanel } from './profile_panel';

const CSS = `
.lad-panel { margin: 8px 0; font-size: 12px; color: #c9d8ae; text-align: left; }
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

export function buildLadderPanel(): HTMLElement {
  ensureCss();
  const box = document.createElement('div');
  box.className = 'lad-panel';
  box.textContent = 'Loading ladder...';
  fetch('/api/ladder')
    .then((r) => (r.ok ? (r.json() as Promise<LadderRow[]>) : null))
    .then((rows) => {
      box.textContent = '';
      if (!rows || rows.length === 0) {
        const sub = document.createElement('div');
        sub.className = 'lad-sub';
        sub.textContent =
          'Nobody has placed yet. A match is rated with a human on each side; ' +
          'three rated matches place you.';
        box.appendChild(sub);
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
        box.append(btn, detail);
      }
    })
    .catch(() => {
      box.textContent = 'Ladder unavailable: the game server is not reachable.';
    });
  return box;
}
