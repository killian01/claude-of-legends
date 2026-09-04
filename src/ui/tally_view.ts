// A bot's Record read per kind (server/record_tally.ts), drawn once for
// the two screens that show it: the Academy, where an owner reads their
// own bot, and the Bot page, where anyone reads someone else's.
//
// The rated line comes first and reads loudest, because it is the only
// one earned against other people's bots. Sparring and the series sit
// under it, dimmer, and a kind with nothing in it says so rather than
// showing a row of zeros that looks like a result.

import type { RecordTallies, Tally } from '../net/record';
import { kdaPerMatch } from './kda_text';
import { el } from './menu';

const CSS = `
.tv { display: flex; flex-direction: column; gap: 3px; margin: 6px 0; }
/* The Academy's rail is narrow, so a row wraps its reading under its
   label rather than breaking mid-phrase. */
.tv-row { display: flex; align-items: baseline; gap: 4px 8px; flex-wrap: wrap;
  font-size: 12px; color: #93a87c; }
.tv-row .tv-kind { width: 60px; flex: none; font-weight: 700; letter-spacing: 0.4px; }
.tv-row .tv-score { white-space: nowrap; }
.tv-row .tv-kda { white-space: nowrap; }
.tv-row .tv-score b { color: #c9d8ae; }
.tv-row .tv-kda { color: #8fa77a; font-variant-numeric: tabular-nums; }
.tv-row .tv-none { color: #6f8159; font-style: italic; }
.tv-row.rated { font-size: 13px; color: #c9d8ae; }
.tv-row.rated .tv-kind { color: #e8dfae; }
.tv-row.rated .tv-score b { color: #f0e8c0; }
.tv-row.rated .tv-kda { color: #c9d8ae; }
`;

let cssInstalled = false;
// A Record nobody has written to yet, so a screen can render before the
// server answers without special-casing null.
export function emptyTallies(): RecordTallies {
  const zero = (): Tally => ({ games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0 });
  return { rated: zero(), arena: zero(), live: zero(), sparring: zero(), series: zero() };
}

function ensureCss(): void {
  if (cssInstalled) return;
  cssInstalled = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

// The wins and losses of one kind, and what a game of it looked like.
export function tallyRow(label: string, t: Tally, rated = false): HTMLElement {
  const row = el('div', rated ? 'tv-row rated' : 'tv-row');
  row.append(el('span', 'tv-kind', label));
  if (t.games === 0) {
    row.append(el('span', 'tv-none', 'no match yet'));
    return row;
  }
  const score = el('span', 'tv-score');
  score.append(
    el('b', '', String(t.wins)),
    document.createTextNode(' won, '),
    el('b', '', String(t.losses)),
    document.createTextNode(' lost'),
  );
  row.append(
    score,
    el('span', 'tv-kda', `${kdaPerMatch(t.kills, t.deaths, t.assists, t.games)} a match`),
  );
  return row;
}

// The four kinds. The Arena and the live seats are shown apart under the
// rated line they add up to, since each carries its own rating.
export function buildTallyView(t: RecordTallies): HTMLElement {
  ensureCss();
  const box = el('div', 'tv');
  box.append(
    tallyRow('Rated', t.rated, true),
    tallyRow('Arena', t.arena),
    tallyRow('Live', t.live),
    tallyRow('Sparring', t.sparring),
    tallyRow('Series', t.series),
  );
  return box;
}
