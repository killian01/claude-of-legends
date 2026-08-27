// The career panel on the home screen: identity handle, headline numbers,
// per-champion lines, and recent matches, fetched from /api/me with the
// stored session token. Pure DOM, rebuilt on every open so it is always
// fresh; offline practice is client-only and deliberately absent here.

import { CHAMPIONS } from '../sim/content/champions';

const CSS = `
.prof-panel { margin: 8px 0; font-size: 12px; color: #c9d8ae; text-align: left; }
.prof-handle { font-size: 15px; font-weight: 800; color: #e8dfae; }
.prof-sub { color: #93a87c; margin: 2px 0 8px; }
.prof-line { display: flex; justify-content: space-between; padding: 3px 0; gap: 10px; }
.prof-line span:last-child { color: #93a87c; white-space: nowrap; }
.prof-section { font-size: 11px; color: #93a87c; margin: 10px 0 3px; }
.prof-win { color: #8fd06a; font-weight: 700; }
.prof-loss { color: #d06a6a; font-weight: 700; }
.prof-watch {
  margin-left: 8px; padding: 1px 8px; border-radius: 4px; border: 1px solid #466030;
  background: #1d2a14; color: #c9d8ae; font-size: 10px; font-weight: 700; cursor: pointer;
}
.prof-watch:hover { border-color: #7ca050; }
.prof-mastery {
  color: #c9a84a; font-size: 10px; font-weight: 800; letter-spacing: 0.5px;
  border: 1px solid #6b5a2e; border-radius: 4px; padding: 0 5px; text-transform: uppercase;
}
`;

let cssInstalled = false;
function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export interface ApiProfile {
  handle: string;
  createdAt: number;
  rating: number;
  ratedGames: number;
  profile: {
    games: number;
    wins: number;
    kills: number;
    deaths: number;
    assists: number;
    perChampion: {
      championId: string;
      games: number;
      wins: number;
      kills: number;
      deaths: number;
      assists: number;
      cs: number;
      mastery: number;
      masteryTitle: string;
    }[];
    recent: {
      at: number;
      durationS: number;
      win: boolean;
      championId: string;
      kills: number;
      deaths: number;
      assists: number;
      cs: number;
      ratingDelta?: number;
      replayId?: number;
    }[];
  };
}

function champName(id: string): string {
  return (CHAMPIONS[id]?.name ?? id).split(',')[0] ?? id;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const NO_CAREER = 'Play an online match to start your career.';

// Shared by the own-career panel and the ladder's public profiles.
export function renderProfile(box: HTMLElement, data: ApiProfile): void {
  box.textContent = '';
  box.append(el('div', 'prof-handle', data.handle));
  const rated =
    data.ratedGames > 0
      ? `Rating ${data.rating} over ${data.ratedGames} rated match${data.ratedGames > 1 ? 'es' : ''}.`
      : 'Unrated: a match is rated with a human on each side.';
  box.append(el('div', 'prof-sub', rated));
  const p = data.profile;
  if (p.games === 0) {
    box.append(el('div', 'prof-sub', 'No online matches recorded yet.'));
    return;
  }
  const winPct = Math.round((100 * p.wins) / p.games);
  box.append(
    el(
      'div',
      'prof-sub',
      `${p.games} match${p.games > 1 ? 'es' : ''}, ${winPct}% wins, ` +
        `${p.kills} / ${p.deaths} / ${p.assists} K/D/A overall`,
    ),
  );
  box.append(el('div', 'prof-section', 'Champions'));
  for (const c of p.perChampion.slice(0, 5)) {
    const line = el('div', 'prof-line');
    const left = el('span', '');
    left.append(document.createTextNode(`${champName(c.championId)} (${c.games})`));
    if (c.mastery > 0) {
      left.append(document.createTextNode(' '));
      left.append(el('span', 'prof-mastery', c.masteryTitle));
    }
    line.append(
      left,
      el(
        'span',
        '',
        `${Math.round((100 * c.wins) / c.games)}% wins, ${c.kills}/${c.deaths}/${c.assists}`,
      ),
    );
    box.appendChild(line);
  }
  box.append(el('div', 'prof-section', 'Recent matches'));
  for (const m of p.recent) {
    const line = el('div', 'prof-line');
    const left = el('span', '');
    left.append(
      el('span', m.win ? 'prof-win' : 'prof-loss', m.win ? 'WIN ' : 'LOSS '),
      document.createTextNode(champName(m.championId)),
    );
    if (m.ratingDelta !== undefined) {
      left.append(document.createTextNode(' '));
      left.append(
        el(
          'span',
          m.ratingDelta >= 0 ? 'prof-win' : 'prof-loss',
          `${m.ratingDelta >= 0 ? '+' : ''}${m.ratingDelta}`,
        ),
      );
    }
    if (m.replayId !== undefined) {
      const replayId = m.replayId;
      const watch = document.createElement('button');
      watch.className = 'prof-watch';
      watch.textContent = 'Watch';
      // The home screen listens and routes into the replay viewer.
      watch.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('loc:replay', { detail: replayId }));
      });
      left.append(watch);
    }
    const mins = Math.floor(m.durationS / 60);
    const secs = String(m.durationS % 60).padStart(2, '0');
    line.append(
      left,
      el(
        'span',
        '',
        `${m.kills}/${m.deaths}/${m.assists}, ${m.cs} CS, ${mins}:${secs}, ` +
          new Date(m.at).toLocaleDateString(),
      ),
    );
    box.appendChild(line);
  }
}

export function buildProfilePanel(): HTMLElement {
  ensureCss();
  const box = el('div', 'prof-panel', 'Loading career...');
  let token: string | null = null;
  try {
    token = localStorage.getItem('loc-token');
  } catch {
    // storage may be unavailable
  }
  if (!token) {
    box.textContent = NO_CAREER;
    return box;
  }
  fetch(`/api/me?token=${encodeURIComponent(token)}`)
    .then((r) => (r.ok ? (r.json() as Promise<ApiProfile>) : null))
    .then((data) => {
      if (data) renderProfile(box, data);
      else box.textContent = NO_CAREER;
    })
    .catch(() => {
      box.textContent = 'Career unavailable: the game server is not reachable.';
    });
  return box;
}

// A public player card by id, used by the ladder rows.
export function buildPublicProfilePanel(playerId: number): HTMLElement {
  ensureCss();
  const box = el('div', 'prof-panel', 'Loading player...');
  fetch(`/api/player/${playerId}`)
    .then((r) => (r.ok ? (r.json() as Promise<ApiProfile>) : null))
    .then((data) => {
      if (data) renderProfile(box, data);
      else box.textContent = 'Unknown player.';
    })
    .catch(() => {
      box.textContent = 'Player unavailable: the game server is not reachable.';
    });
  return box;
}
