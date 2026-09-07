// The counters, rendered for a person. The JSON is the honest format and
// the one a script wants, but the reader here is usually the maintainer on
// a phone an hour into an announcement, and a row of integers a day only
// answers the question once something divides them.
//
// So the page leads with the two ratios that decide what to do next. Of
// the people who arrived, how many made an account: that is the front
// door, and a bad number there means the landing page is losing them, not
// that nobody came. Of the matches that started, how many reached an end:
// that is the game itself, and a bad number there means they arrived,
// signed up, queued, and left anyway.
//
// No chart and no library: a table of numbers is the right resolution for
// one row a day, and the page has to work on a phone with nothing loaded
// from anywhere else, which is what PRIVACY.md promises of every page here.

import { VISIT_SOURCES, type VisitSource } from '../src/net/pulse_source';
import { emptySources, type PulseDay } from './pulse';

// Nothing here is attacker-controlled today (the day strings are validated
// on read and the rest are numbers), but the page is rendered from a file
// on disk and that is exactly the assumption that stops being true later.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

// A percentage, or a dash when the denominator is zero: a launch's first
// hour divides by zero constantly and "0%" would read as a failure rather
// than as nothing having happened yet.
export function rate(part: number, whole: number): string {
  if (whole <= 0) return '-';
  return `${Math.round((part / whole) * 100)}%`;
}

export interface PulseTotals {
  loads: number;
  strays: number;
  visitors: number;
  newcomers: number;
  sources: Record<VisitSource, number>;
  stayed: number;
  played: number;
  accounts: number;
  matches: number;
  finished: number;
  restarts: number;
}

export function total(days: readonly PulseDay[]): PulseTotals {
  const t: PulseTotals = {
    loads: 0,
    strays: 0,
    visitors: 0,
    newcomers: 0,
    sources: emptySources(),
    stayed: 0,
    played: 0,
    accounts: 0,
    matches: 0,
    finished: 0,
    restarts: 0,
  };
  for (const d of days) {
    t.loads += d.loads;
    t.strays += d.strays;
    t.visitors += d.visitors;
    t.newcomers += d.newcomers;
    for (const source of VISIT_SOURCES) t.sources[source] += d.sources[source];
    t.stayed += d.stayed;
    t.played += d.played;
    t.accounts += d.accounts;
    t.matches += d.matches;
    t.finished += d.finished;
    t.restarts += d.restarts;
  }
  return t;
}

// Where the week's visitors came from, biggest first, and only the
// buckets that happened: nine rows of which seven are zero is a shape that
// hides the two that are not. A week with nobody in it says so in words,
// because an empty strip reads as a broken page rather than a quiet week.
export function sourceStrip(t: PulseTotals): string {
  const seen = VISIT_SOURCES.filter((s) => t.sources[s] > 0).sort(
    (a, b) => t.sources[b] - t.sources[a],
  );
  if (seen.length === 0) return '<p class="from">No visitor counted in the last 7 days.</p>';
  const parts = seen.map((s) => `<span><b>${t.sources[s]}</b> ${esc(s)}</span>`);
  return `<p class="from">Came from, 7d: ${parts.join(' ')}</p>`;
}

// How far the week's visitors actually got. Two rates rather than two
// more integers, because the integers are already in the table and what a
// reader wants here is the shape of the drop: arriving, staying, playing.
// Silent on a week with nobody in it, since the strip above already says
// so and a row of dashes says it twice.
export function funnelStrip(t: PulseTotals): string {
  if (t.visitors <= 0) return '';
  return `<p class="from">Of those visitors: <span><b>${rate(t.stayed, t.visitors)}</b> stayed</span> <span><b>${rate(t.played, t.visitors)}</b> played a match</span></p>`;
}

function row(d: PulseDay | (PulseTotals & { day: string }), klass = ''): string {
  return `<tr${klass ? ` class="${klass}"` : ''}>
  <td class="d">${esc(d.day)}</td>
  <td>${d.visitors}</td>
  <td class="r">${d.newcomers}</td>
  <td>${d.stayed}</td>
  <td>${d.played}</td>
  <td class="dim">${d.loads - d.strays}</td>
  <td class="dim">${d.strays}</td>
  <td>${d.accounts}</td>
  <td class="r">${rate(d.accounts, d.visitors)}</td>
  <td>${d.matches}</td>
  <td>${d.finished}</td>
  <td class="r">${rate(d.finished, d.matches)}</td>
  <td class="dim">${d.restarts}</td>
</tr>`;
}

export function renderPulsePage(days: readonly PulseDay[]): string {
  // Newest first: the day being lived is the one being read.
  const recent = [...days].reverse();
  const week = total(recent.slice(0, 7));
  const all = total(recent);
  const rows = recent.map((d) => row(d)).join('\n');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Pulse</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 20px 14px 48px; background: #0a1120; color: #dfe7f5;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size: 15px; letter-spacing: 2px; text-transform: uppercase;
    color: #e6d7a8; margin: 0 0 4px; font-weight: 700; }
  .sub { color: #7f8ea8; margin: 0 0 22px; font-size: 12.5px; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 22px; }
  .card { flex: 1 1 120px; background: #101a2e; border: 1px solid #1e2c47;
    border-radius: 8px; padding: 12px 14px; }
  .card b { display: block; font-size: 24px; font-weight: 700; color: #fff; }
  .card span { color: #7f8ea8; font-size: 11.5px; letter-spacing: 0.6px;
    text-transform: uppercase; }
  .from { color: #7f8ea8; font-size: 12.5px; margin: -8px 0 22px; }
  .from span { display: inline-block; margin-right: 14px; white-space: nowrap; }
  .from b { color: #dfe7f5; font-weight: 700; }
  .wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; min-width: 780px; font-variant-numeric: tabular-nums; }
  th, td { padding: 7px 10px; text-align: right; border-bottom: 1px solid #182440; }
  th { color: #7f8ea8; font-size: 11px; letter-spacing: 0.8px; text-transform: uppercase;
    font-weight: 600; text-align: right; white-space: nowrap; }
  td.d, th.d { text-align: left; color: #c8d4ea; white-space: nowrap; }
  td.dim { color: #5d6b85; }
  td.r { color: #e6d7a8; }
  tr.sum td { border-top: 2px solid #2a3a5c; border-bottom: none; font-weight: 700; }
  .foot { color: #5d6b85; font-size: 12px; margin-top: 26px; max-width: 60ch; }
  .foot code { white-space: nowrap; }
</style>
</head><body>
<h1>Pulse</h1>
<p class="sub">One row per UTC day. Nothing here is per person; see PRIVACY.md.</p>
<div class="cards">
  <div class="card"><b>${week.visitors}</b><span>visitors, 7d</span></div>
  <div class="card"><b>${week.newcomers}</b><span>first time, 7d</span></div>
  <div class="card"><b>${week.accounts}</b><span>accounts, 7d</span></div>
  <div class="card"><b>${rate(week.accounts, week.visitors)}</b><span>sign-up rate</span></div>
  <div class="card"><b>${week.finished}</b><span>matches finished, 7d</span></div>
</div>
${sourceStrip(week)}
${funnelStrip(week)}
<div class="wrap">
<table>
<thead><tr>
  <th class="d">Day</th><th>Visitors</th><th>New</th><th>Stayed</th><th>Played</th>
  <th>Pages</th><th>Stray</th>
  <th>Accounts</th><th>Signed up</th>
  <th>Matches</th><th>Finished</th><th>Completed</th><th>Restarts</th>
</tr></thead>
<tbody>
${rows}
${row({ ...all, day: 'All' }, 'sum')}
</tbody>
</table>
</div>
<p class="foot">Visitors counts a browser once a day, and only a browser that
ran the game, so it is a floor made of people; New is the ones that had never
been counted here before. Pages counts every shell served for a path this site
has, reloads included, and Stray the ones served for a path it does not, which
is where the scanners land; the two together are <code>loads</code> in the JSON.
Came from is the bucket each visitor's browser put its own referrer in,
never a link. Stayed is a visitor still here 30 seconds later, and Played
one who started a match in the browser, practice or live; each is counted
once per browser per day, so both divide by Visitors. Add <code>?format=json</code> for the raw numbers, and open the
site once with <code>?pulse=off</code> to keep your own browser out of the
count.</p>
</body></html>
`;
}
