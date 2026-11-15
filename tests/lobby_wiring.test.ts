// The server's glue that makes a private lobby outlive its match (ADR 0036),
// pinned where it lives, in server/main.ts: the Matchmaker's own behavior is
// tested in tests/matchmaker.test.ts, and these are the calls that reach it.
// Removing one leaves the Matchmaker green and the lobby stuck.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(path.join(ROOT, 'server/main.ts'), 'utf8');

// The text from the first occurrence of `start` for `length` characters.
function after(start: string, length: number): string {
  const i = MAIN.indexOf(start);
  expect(i, start).toBeGreaterThanOrEqual(0);
  return MAIN.slice(i, i + length);
}

// The text from `start` up to the next occurrence of `end` after it.
function between(start: string, end: string): string {
  const i = MAIN.indexOf(start);
  expect(i, start).toBeGreaterThanOrEqual(0);
  const j = MAIN.indexOf(end, i + start.length);
  expect(j, end).toBeGreaterThan(i);
  return MAIN.slice(i, j);
}

describe("the lobby's wiring in server/main.ts", () => {
  it('reopens the lobby the moment its match has a winner', () => {
    expect(after('entry.endedAt = now;', 400)).toMatch(
      /^entry\.endedAt = now;(\s*\/\/[^\n]*)*\s*for \(const mm of matchmakers\) mm\.matchOver\(matchId, now\);/,
    );
  });

  it('reopens it however else the match closes', () => {
    const closing = between('const closing = {', '\n};');
    expect(closing).toMatch(
      /over: \(matchId: number\) => \{\s*for \(const mm of matchmakers\) mm\.matchOver\(matchId, Date\.now\(\)\);/,
    );
  });

  it('plays a held seat on the socket whose hello took it back', () => {
    const hello = between("if (msg.t === 'hello') {", 'send(id, {');
    expect(hello).toContain('rejoinClassic(');
    expect(hello).toContain('matchmaker.enteredMatch(id, client.accountId, seat.matchId, now);');
  });

  it('gives the seat up on a walk-out, by the walking socket', () => {
    const walk = between('function walkOutOfMatch(', '\n}\n');
    expect(walk).toContain(
      'matchmaker.leftMatch(client.id, client.accountId, matchId, Date.now());',
    );
  });

  it('follows a Guest retired into an account, at both places one retires', () => {
    const retires = [...MAIN.matchAll(/guests\.retire\(guest\.id\);/g)];
    expect(retires).toHaveLength(2);
    for (const r of retires) {
      const near = MAIN.slice(r.index, r.index + 400);
      expect(near).toContain('matchmaker.renameMember(guest.id, created.value.id, now);');
    }
  });

  it("renames a Guest in its lobbies, within the connection's rename budget", () => {
    const route = between("if (url === '/api/ladder/name') {", "if (url === '");
    const charged = route.indexOf('codeGuard.tryRename(key, now)');
    const body = route.indexOf('await readJsonBody(req)');
    expect(charged).toBeGreaterThan(0);
    // Charged before anything is awaited, and given back when no rename.
    expect(charged).toBeLessThan(body);
    expect(route.slice(charged)).toMatch(/sendJson\(res, 429, \{ error: NAME_LIMIT_MESSAGE \}\)/);
    expect(route).toContain('codeGuard.refundRename(key, now);');
    expect(route).toContain('matchmaker.renameLive(named.value.id, named.value.name, now);');
  });

  it('holds a closed socket through the drop grace, never as a leave', () => {
    const close = between("ws.on('close', () => {", 'clients.delete(id);');
    expect(close).toContain(
      "for (const mm of matchmakers) mm.removeEverywhere(id, Date.now(), 'drop');",
    );
  });
});
