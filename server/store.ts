// The server's disk: tiny JSON files, no database (game definition v1).
// Everything loads once at boot and lives in memory; writes are rare (an
// account registered, renamed or rated, a session opened or revoked, a
// match ended), so sync fs is fine. "Rare" is a live constraint, not a
// description: saveJsonAtomic rewrites a whole file on the thread that
// steps matches at 20 Hz, which is why server/sessions.ts keeps its
// per-request touches in memory instead of writing them.
//
// saveJsonAtomic writes tmp-then-rename so a crash mid-write never leaves
// a corrupt file, and readJsonl skips a torn last line for the same reason.

import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function saveJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
}

export function appendJsonl(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(value)}\n`);
}

// Keep only the `keep` highest-numbered `<n>.json` files in a directory
// (replays are named by match id, so highest means newest), plus every
// number in `hold`: a replay a bot's Record still references lives as
// long as its entry does (docs/design/bots.md). Returns the numbers
// deleted, for the log.
export function pruneNumberedJson(
  dir: string,
  keep: number,
  hold: ReadonlySet<number> = new Set(),
): number[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const numbers = names
    .map((n) => /^(\d+)\.json$/.exec(n)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => b - a);
  const doomed = numbers.slice(keep).filter((n) => !hold.has(n));
  for (const n of doomed) {
    try {
      unlinkSync(path.join(dir, `${n}.json`));
    } catch {
      // Already gone is fine.
    }
  }
  return doomed;
}

export function readJsonl<T>(file: string): T[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // A torn line from a crash mid-append loses one record, not the file.
    }
  }
  return out;
}
