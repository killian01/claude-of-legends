// The ladder on the landing: the names already standing there, shown to a
// visitor before the page asks for theirs. Two short columns, by hand and
// bots, read from one request the server answers without a session
// (server/landing_page.ts); the wire shape is mirrored here and the module
// never imports from server/.
//
// The words and the row text are pure, so a test reads them without a
// browser; mountLandingLadder draws them and hides the whole section when
// the server does not answer, because a landing with an empty box on it
// reads worse than one without.

import { el } from './menu';

export interface LandingLadderRow {
  rank: number;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  owner: string | null;
}

export interface LandingLadder {
  way: 'hand' | 'bot' | 'arena' | 'forge';
  total: number;
  rows: LandingLadderRow[];
}

export interface LandingPage {
  ladder: LandingLadder;
  bots: LandingLadder;
  accounts: number;
}

export const LADDER_HEADING = 'The ladder';
export const JOIN_CALL = 'Take your place';

export function columnTitle(way: LandingLadder['way']): string {
  return way === 'hand' ? 'By hand' : 'Bots';
}

export function recordText(row: Pick<LandingLadderRow, 'wins' | 'losses'>): string {
  return `${row.wins} W / ${row.losses} L`;
}

// What stands behind the rows. A fresh server says so plainly rather than
// counting to zero; otherwise the count of placed names, and of accounts
// when it says more than the placed do.
export function ladderLead(page: Pick<LandingPage, 'ladder' | 'bots' | 'accounts'>): string {
  const placed = page.ladder.total + page.bots.total;
  if (placed === 0) {
    return page.accounts === 0
      ? 'Nobody has placed yet. The first name here could be yours.'
      : `${page.accounts} accounts, none placed yet. The first name here could be yours.`;
  }
  const names = placed === 1 ? '1 name placed' : `${placed} names placed`;
  return `${names}, ${page.accounts} accounts. Yours goes here with a free account.`;
}

const CSS = `
.pg-ladder { width: min(1180px, 100%); box-sizing: border-box; margin: 22px auto 0;
  padding: 18px 22px 20px; border-radius: 14px;
  border: 1px solid #2b3f60; background: rgba(6, 10, 20, 0.72); }
.pg-ladder h2 { font-family: Cinzel, Georgia, serif; font-size: 17px; letter-spacing: 1.6px;
  text-transform: uppercase; margin: 0; color: #e7d9a8; }
.pg-ladder .pg-ladder-lead { margin: 4px 0 0; font-size: 13px; color: #b9cbe4; }
.pg-ladder-cols { display: grid; gap: 18px; margin-top: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pg-ladder h3 { font-family: Cinzel, Georgia, serif; font-size: 12px; letter-spacing: 1.8px;
  text-transform: uppercase; margin: 0 0 6px; color: #8ea4c4; }
.pg-ladder ol { list-style: none; margin: 0; padding: 0; }
.pg-ladder li { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto; gap: 10px;
  align-items: baseline; padding: 6px 0; border-top: 1px solid rgba(140, 168, 208, 0.14);
  font-size: 13.5px; color: #dceaff; }
.pg-ladder li:first-child { border-top: 0; }
.pg-ladder .pg-ladder-rank { color: #8ea4c4; font-variant-numeric: tabular-nums; }
.pg-ladder .pg-ladder-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.pg-ladder .pg-ladder-name small { font-weight: 400; color: #8ea4c4; margin-left: 6px; }
.pg-ladder .pg-ladder-rating { font-variant-numeric: tabular-nums; color: #f0deae; }
.pg-ladder .pg-ladder-record { font-variant-numeric: tabular-nums; color: #9db0c9; font-size: 12px; }
.pg-ladder .pg-ladder-empty { margin: 0; padding: 6px 0; font-size: 12.5px; color: #8ea4c4; }
.pg-ladder .pg-ladder-join { margin-top: 14px; }
.pg-ladder .pg-ladder-join .menu-btn { width: auto; padding: 8px 22px; }
@media (max-width: 720px) {
  .pg-ladder { padding: 14px 16px 16px; }
  .pg-ladder-cols { grid-template-columns: minmax(0, 1fr); }
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

function column(ladder: LandingLadder): HTMLElement {
  const box = el('div', 'pg-ladder-col');
  box.appendChild(el('h3', '', columnTitle(ladder.way)));
  if (ladder.rows.length === 0) {
    box.appendChild(el('p', 'pg-ladder-empty', 'No name placed here yet.'));
    return box;
  }
  const list = el('ol', '');
  for (const row of ladder.rows) {
    const item = el('li', '');
    const name = el('span', 'pg-ladder-name', row.name);
    if (row.owner) name.appendChild(el('small', '', `by ${row.owner}`));
    item.append(
      el('span', 'pg-ladder-rank', `#${row.rank}`),
      name,
      el('span', 'pg-ladder-rating', String(row.rating)),
      el('span', 'pg-ladder-record', recordText(row)),
    );
    list.appendChild(item);
  }
  box.appendChild(list);
  return box;
}

export function renderLandingLadder(
  host: HTMLElement,
  page: LandingPage,
  onJoin: () => void,
): void {
  ensureCss();
  host.textContent = '';
  host.append(el('h2', '', LADDER_HEADING), el('p', 'pg-ladder-lead', ladderLead(page)));
  const cols = el('div', 'pg-ladder-cols');
  cols.append(column(page.ladder), column(page.bots));
  host.appendChild(cols);
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
  fetch('/api/public/landing')
    .then((res) => (res.ok ? (res.json() as Promise<LandingPage>) : null))
    .then((page) => {
      if (!page || !host.isConnected) {
        host.remove();
        return;
      }
      renderLandingLadder(host, page, onJoin);
      host.hidden = false;
    })
    .catch(() => host.remove());
}
