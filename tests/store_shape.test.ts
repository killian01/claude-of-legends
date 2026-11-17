// A stored file that parses but is not the shape its store keeps (a hand
// edit, a `null`, an object where a list belongs) must not stop the server
// at boot: it is set aside like an unparseable one, kept for a hand, and
// the store starts empty instead of throwing on every restart.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountRegistry } from '../server/accounts';
import { TokenStore } from '../server/action_tokens';
import { SessionStore } from '../server/sessions';
import { loadJson } from '../server/store';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'loc-shape-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function asideOf(dir: string, name: string): string[] {
  return readdirSync(dir).filter((f) => f.startsWith(`${name}.corrupt-`));
}

describe('loadJson with a shape check', () => {
  it('sets aside a file that parses but fails the check', () => {
    const dir = tmp();
    const file = path.join(dir, 'sessions.json');
    writeFileSync(file, '{}');
    expect(loadJson(file, [], Array.isArray)).toEqual([]);
    const aside = asideOf(dir, 'sessions.json');
    expect(aside).toHaveLength(1);
    expect(readFileSync(path.join(dir, aside[0] ?? ''), 'utf8')).toBe('{}');
  });

  it('returns a file that passes the check untouched', () => {
    const dir = tmp();
    const file = path.join(dir, 'sessions.json');
    writeFileSync(file, '[{"id":"a"}]');
    expect(loadJson(file, [], Array.isArray)).toEqual([{ id: 'a' }]);
    expect(asideOf(dir, 'sessions.json')).toHaveLength(0);
  });
});

describe('the stores boot past a file of the wrong shape', () => {
  const shapes = ['null', '{}', '[null]', '"x"', '7'];

  for (const text of shapes) {
    it(`sessions: ${text}`, () => {
      const dir = tmp();
      const file = path.join(dir, 'sessions.json');
      writeFileSync(file, text);
      expect(new SessionStore(file).count).toBe(0);
      expect(asideOf(dir, 'sessions.json')).toHaveLength(1);
    });

    it(`action tokens: ${text}`, () => {
      const dir = tmp();
      const file = path.join(dir, 'action_tokens.json');
      writeFileSync(file, text);
      expect(new TokenStore(file).count).toBe(0);
      expect(asideOf(dir, 'action_tokens.json')).toHaveLength(1);
    });
  }

  const accountShapes = [
    'null',
    '[]',
    '{}',
    '{"accounts":null,"names":[]}',
    '{"accounts":[null],"names":[]}',
    '{"accounts":[],"names":{}}',
    '{"accounts":[],"names":[null]}',
  ];
  for (const text of accountShapes) {
    it(`accounts: ${text}`, () => {
      const dir = tmp();
      const file = path.join(dir, 'accounts.json');
      writeFileSync(file, text);
      expect(new AccountRegistry(file).count).toBe(0);
      expect(asideOf(dir, 'accounts.json')).toHaveLength(1);
    });
  }

  it('accounts: a good file still loads and is not set aside', () => {
    const dir = tmp();
    const file = path.join(dir, 'accounts.json');
    const first = new AccountRegistry(file);
    expect(first.register('Brindle', 'hunter2hunter2', '', 1).ok).toBe(true);
    first.flush();
    expect(new AccountRegistry(file).count).toBe(1);
    expect(asideOf(dir, 'accounts.json')).toHaveLength(0);
  });
});
