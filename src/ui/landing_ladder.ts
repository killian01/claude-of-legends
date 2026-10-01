// The ladder on the landing: the ladder of every human (ADR 0027), the
// accounts and the Guests ranked by the points their matches banked, shown
// to a visitor as the reason to press Play: one match puts their name on
// it, with no account. Read from one request the server answers without a
// session (server/landing_page.ts); the wire shape is mirrored here and
// the module never imports from server/. The bot ladders stay inside the
// home and the Academy.
//
// The words and the row text are pure, so a test reads them without a
// browser; mountLandingLadder draws them and hides the whole section when
// the server does not answer, because a landing with an empty box on it
// reads worse than one without.

import { el } from './menu';

export interface LandingLadderRow {
  rank: number;
  name: string;
  points: number;
  guest: boolean;
}

export interface LandingLadderMe {
  rank: number | null;
  points: number;
  name: string;
  guest: boolean;
  named: boolean;
}

export interface LandingLadder {
  total: number;
  rows: LandingLadderRow[];
  me: LandingLadderMe | null;
}

export interface LandingPage {
  ladder: LandingLadder;
}

export const LADDER_HEADING = 'The ladder';
// What an empty ladder shows: its first places, open.
export const GHOST_ROWS = 6;
export const GHOST_NAME = 'Open: your name here';
export const JOIN_CALL = 'Take your place';
// The promise the section makes, in one line.
export const LADDER_PROMISE = 'Play one match and your name is on it. No account needed.';

export function pointsText(points: number): string {
  return points === 1 ? '1 point' : `${points.toLocaleString('en-US')} points`;
}

// What stands behind the rows. A fresh server says so plainly rather than
// counting to zero.
export function ladderLead(ladder: Pick<LandingLadder, 'total'>): string {
  if (ladder.total === 0) return 'Nobody is on it yet. The first name here could be yours.';
  const who = ladder.total === 1 ? '1 player' : `${ladder.total} players`;
  return `${who} on it, Guests and accounts alike, ranked by the points their matches earned.`;
}

// A returning visitor's own place, when the cookie said who they are.
export function meLine(me: LandingLadderMe | null): string | null {
  if (!me) return null;
  if (me.rank === null) return null;
  return `You are #${me.rank} with ${pointsText(me.points)}. Play to climb.`;
}

const CSS = `
.pg-ladder { width: min(1180px, 100%); box-sizing: border-box; margin: 22px auto 0;
  padding: 18px 22px 20px; border-radius: 14px;
  border: 1px solid #6b5a2e; background: rgba(6, 10, 20, 0.78);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.5), 0 0 34px rgba(232, 196, 108, 0.08); }
.pg-ladder-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.pg-ladder h2 { font-family: Cinzel, Georgia, serif; font-size: 22px; letter-spacing: 1.8px;
  text-transform: uppercase; margin: 0; color: #f0dca0; }
.pg-ladder .pg-ladder-promise { margin: 0; font-size: 14px; font-weight: 600; color: #e8f0d4; }
.pg-ladder .pg-ladder-lead { margin: 6px 0 0; font-size: 12.5px; color: #9db2cf; }
.pg-ladder .pg-ladder-me { margin: 8px 0 0; font-size: 13px; font-weight: 700; color: #f3e6bd; }
.pg-ladder ol { list-style: none; margin: 14px 0 0; padding: 0;
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 26px; }
.pg-ladder li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px;
  align-items: baseline; padding: 6px 0; border-top: 1px solid rgba(140, 168, 208, 0.14);
  font-size: 13.5px; color: #dceaff; }
.pg-ladder li.me { color: #f3e6bd; }
.pg-ladder .pg-ladder-rank { color: #c9a84a; font-weight: 800; font-variant-numeric: tabular-nums; }
.pg-ladder .pg-ladder-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.pg-ladder .pg-ladder-name small { font-weight: 400; color: #8ea4c4; margin-left: 6px; font-size: 11.5px; }
.pg-ladder .pg-ladder-points { font-variant-numeric: tabular-nums; color: #f0deae; font-weight: 700; }
.pg-ladder ol.ghost li { color: #6d829f; font-style: italic; }
.pg-ladder ol.ghost .pg-ladder-rank, .pg-ladder ol.ghost .pg-ladder-points { color: #6b5a2e; }
.pg-ladder .pg-ladder-join { margin-top: 14px; }
.pg-ladder .pg-ladder-join .menu-btn { width: auto; padding: 8px 22px; }
@media (max-width: 720px) {
  .pg-ladder { padding: 14px 16px 16px; }
  .pg-ladder ol { grid-template-columns: minmax(0, 1fr); }
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

export function renderLandingLadder(
  host: HTMLElement,
  page: LandingPage,
  onJoin: () => void,
): void {
  ensureCss();
  host.textContent = '';
  const ladder = page.ladder;
  const head = el('div', 'pg-ladder-head');
  head.append(el('h2', '', LADDER_HEADING), el('p', 'pg-ladder-promise', LADDER_PROMISE));
  host.append(head, el('p', 'pg-ladder-lead', ladderLead(ladder)));
  const mine = meLine(ladder.me);
  if (mine) host.appendChild(el('p', 'pg-ladder-me', mine));
  if (ladder.rows.length === 0) {
    // An empty ladder still reads as a ladder: its first places stand open,
    // waiting for names, rather than a second line saying it is empty.
    const list = el('ol', 'ghost');
    for (let rank = 1; rank <= GHOST_ROWS; rank++) {
      const item = el('li', '');
      item.append(
        el('span', 'pg-ladder-rank', `#${rank}`),
        el('span', 'pg-ladder-name', GHOST_NAME),
        el('span', 'pg-ladder-points', pointsText(0)),
      );
      list.appendChild(item);
    }
    host.appendChild(list);
  } else {
    const list = el('ol', '');
    for (const row of ladder.rows) {
      const item = el('li', row.rank === ladder.me?.rank ? 'me' : '');
      const name = el('span', 'pg-ladder-name', row.name);
      if (row.guest) name.appendChild(el('small', '', 'Guest'));
      item.append(
        el('span', 'pg-ladder-rank', `#${row.rank}`),
        name,
        el('span', 'pg-ladder-points', pointsText(row.points)),
      );
      list.appendChild(item);
    }
    host.appendChild(list);
  }
  const join = el('div', 'pg-ladder-join');
  const btn = el('button', 'menu-btn primary', JOIN_CALL);
  btn.type = 'button';
  btn.addEventListener('click', onJoin);
  join.appendChild(btn);
  host.appendChild(join);
}

// Fills the host from the server, or removes it: a section that could not
// be read is not shown half-drawn.
export function mountLandingLadder(host: HTMLElement, onJoin: () => void): void {
  host.hidden = true;
  fetch('/api/public/landing', { credentials: 'same-origin' })
    .then((res) => (res.ok ? (res.json() as Promise<LandingPage>) : null))
    .then((page) => {
      if (!page?.ladder || !host.isConnected) {
        host.remove();
        return;
      }
      renderLandingLadder(host, page, onJoin);
      host.hidden = false;
    })
    .catch(() => host.remove());
}
