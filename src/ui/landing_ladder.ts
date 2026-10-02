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

export function pointsText(points: number): string {
  return points === 1 ? '1 point' : `${points.toLocaleString('en-US')} points`;
}

// A row's number. The lead over the rows says they are points, so each row
// says the number alone: "points" twenty times down a list is the word,
// not the ranking, that the eye reads.
export function rowPoints(points: number): string {
  return points.toLocaleString('en-US');
}

// What stands behind the rows. A fresh server says so plainly rather than
// counting to zero. The hero above has already said that one match puts a
// name here, with no account (ui/landing_modes.ts HERO_RANKED_LINE): the
// ladder says it no second time, and neither does it tell Guests from
// accounts, which a visitor reading names has no use for.
export function ladderLead(ladder: Pick<LandingLadder, 'total'>): string {
  if (ladder.total === 0) return 'Nobody is on it yet. The first name here could be yours.';
  const who = ladder.total === 1 ? '1 player' : `${ladder.total} players`;
  return `${who}, ranked by the points their matches earned.`;
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
.pg-ladder .pg-ladder-lead { margin: 6px 0 0; font-size: 12.5px; color: #9db2cf; }
.pg-ladder .pg-ladder-me { margin: 8px 0 0; font-size: 13px; font-weight: 700; color: #f3e6bd; }
/* Every line on the ladder, in a box that scrolls: ten and a half rows
   high, so the half row at the foot says there is more under it. */
.pg-ladder ol { list-style: none; margin: 14px 0 0; padding: 0 10px 0 0; position: relative;
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 26px;
  align-content: start; max-height: 318px; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: #6b5a2e transparent; }
.pg-ladder ol::-webkit-scrollbar { width: 6px; }
.pg-ladder ol::-webkit-scrollbar-thumb { background: #6b5a2e; border-radius: 3px; }
.pg-ladder li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px;
  align-items: baseline; padding: 6px 0; border-top: 1px solid rgba(140, 168, 208, 0.14);
  font-size: 13.5px; color: #dceaff; }
.pg-ladder li.me { color: #f3e6bd; }
.pg-ladder .pg-ladder-rank { color: #c9a84a; font-weight: 800; font-variant-numeric: tabular-nums; }
.pg-ladder .pg-ladder-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.pg-ladder .pg-ladder-points { font-variant-numeric: tabular-nums; color: #f0deae; font-weight: 700; }
.pg-ladder ol.ghost li { color: #6d829f; font-style: italic; }
.pg-ladder ol.ghost .pg-ladder-rank, .pg-ladder ol.ghost .pg-ladder-points { color: #6b5a2e; }
.pg-ladder .pg-ladder-join { margin-top: 14px; }
.pg-ladder .pg-ladder-join .menu-btn { width: auto; padding: 8px 22px; }
@media (max-width: 720px) {
  .pg-ladder { padding: 14px 16px 16px; }
  .pg-ladder ol { grid-template-columns: minmax(0, 1fr); max-height: 348px; }
}
/* A phone held sideways: a box most of the screen high would take the
   thumb's swipes meant for the page. */
@media (max-height: 560px) {
  .pg-ladder ol { max-height: 202px; }
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
  head.append(el('h2', '', LADDER_HEADING));
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
        el('span', 'pg-ladder-points', rowPoints(0)),
      );
      list.appendChild(item);
    }
    host.appendChild(list);
  } else {
    const list = el('ol', '');
    for (const row of ladder.rows) {
      const item = el('li', row.rank === ladder.me?.rank ? 'me' : '');
      item.append(
        el('span', 'pg-ladder-rank', `#${row.rank}`),
        el('span', 'pg-ladder-name', row.name),
        el('span', 'pg-ladder-points', rowPoints(row.points)),
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
      // The box opens on the top of the ladder, whoever reads it: a
      // returning player's own place is the line over the rows, and the
      // box scrolled down to it read as a ladder opened at its foot (the
      // maintainer, 2026-10-02).
      renderLandingLadder(host, page, onJoin);
      host.hidden = false;
    })
    .catch(() => host.remove());
}
