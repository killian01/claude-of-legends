// The ladder of every human (CONTEXT.md: Ladder, Points; ADR 0027): the
// accounts and the Guests together, ranked by the points they banked in
// public queue matches. A line takes its place with its first points, so
// one match puts a name on it. Names and numbers only: whether a line is a
// Guest's or an account's, and never an id, so the answer can go to
// anyone. The reader's own place rides along when the request carries an
// account or a Guest. Pure over the lines, so every rank is pinned by
// tests.

export const POINTS_LADDER_CAP = 50;

// One human's line, as the server holds it.
export interface PointsEntry {
  // Who it is (an account id, or a Guest's negative id), for the reader
  // to be found by. Never serialised.
  key: number;
  name: string;
  points: number;
  guest: boolean;
  // When the account or the Guest was made: equal points rank the older
  // line first.
  since: number;
}

export interface PointsRow {
  rank: number;
  name: string;
  points: number;
  guest: boolean;
}

// The reader, as the request's cookie names them.
export interface PointsReader {
  key: number;
  name: string;
  guest: boolean;
  // A Guest wearing a name it chose; false while it wears the one handed
  // out. Always true for an account, whose name is its account's.
  named: boolean;
}

export interface PointsMe {
  // Null until the first points.
  rank: number | null;
  points: number;
  name: string;
  guest: boolean;
  named: boolean;
}

export interface PointsLadder {
  // Lines on the ladder: everyone with points.
  total: number;
  rows: PointsRow[];
  me: PointsMe | null;
}

function byPoints(a: PointsEntry, b: PointsEntry): number {
  return b.points - a.points || a.since - b.since || a.name.localeCompare(b.name) || a.key - b.key;
}

export function buildPointsLadder(
  entries: readonly PointsEntry[],
  reader: PointsReader | null,
  cap = POINTS_LADDER_CAP,
): PointsLadder {
  const placed = entries.filter((e) => e.points > 0).sort(byPoints);
  const rows = placed.slice(0, cap).map((e, i) => ({
    rank: i + 1,
    name: e.name,
    points: e.points,
    guest: e.guest,
  }));
  let me: PointsMe | null = null;
  if (reader) {
    const i = placed.findIndex((e) => e.key === reader.key);
    me = {
      rank: i === -1 ? null : i + 1,
      points: i === -1 ? 0 : (placed[i]?.points ?? 0),
      name: reader.name,
      guest: reader.guest,
      named: reader.named,
    };
  }
  return { total: placed.length, rows, me };
}
