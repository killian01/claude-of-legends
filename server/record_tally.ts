// A bot's Record added up one kind at a time (CONTEXT.md: Record).
//
// The Academy used to show one won-and-lost count over the whole Record,
// which blended the sparring a bot did against house bots, the series it
// ran against its own previous version, and the rated matches it played
// in the Arena and live. Those three say different things: only the last
// is play against other people's bots, and it is the one a reader wants
// first. So the Record is read per kind, with the rated ones summed.
//
// Pure over the rows the Record hands out, so it needs no store and no
// database to test.

import type { RecordRow, RecordTallies, Tally } from '../src/net/record';

function empty(): Tally {
  return { games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0 };
}

function add(into: Tally, row: RecordRow): void {
  into.games++;
  // A match with no winner is a game that happened and a result nobody
  // took, so it counts in neither column.
  if (row.winner !== null) {
    if (row.winner === row.team) into.wins++;
    else into.losses++;
  }
  into.kills += row.line?.kills ?? 0;
  into.deaths += row.line?.deaths ?? 0;
  into.assists += row.line?.assists ?? 0;
}

export function talliesOf(rows: readonly RecordRow[]): RecordTallies {
  const out: RecordTallies = {
    rated: empty(),
    arena: empty(),
    live: empty(),
    sparring: empty(),
    series: empty(),
  };
  for (const row of rows) {
    add(out[row.kind], row);
    // Rated is the two kinds a rating moved on, counted once more rather
    // than derived by the caller: two screens read it and they must agree.
    if (row.kind === 'arena' || row.kind === 'live') add(out.rated, row);
  }
  return out;
}
